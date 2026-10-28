// Prompt 5 step 7: the payment loop against the REAL local database with the FakeGateway: webhook ingest ->
// pipeline -> ledger -> receipts -> the worker's next reminder.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventsOf, pool, q, quietCron } from './harness.ts';
import { balanceOf, creditsOf, integrityOf, outboxOf, payWorld, receiptsOf, statusOf, tasksOf, tenantEventsOf } from './payments-harness.ts';

beforeAll(quietCron);
afterAll(() => pool.end());

const types = async (tenantId: string) => (await eventsOf(tenantId)).map((e) => e.type);

describe('gateway payments', () => {
  it('full payment: paid, balance 0, one receipt (sent once), link switched off, no more reminders', async () => {
    const w = await payWorld();
    const inv = w.invoiceIds[0] ?? '';
    const link = await w.link();
    w.gw.pay(link.objectId);
    expect(await w.deliver()).toEqual([{ status: 200, stored: 1, duplicates: 0, ignored: 0 }]);
    expect(await w.process()).toEqual({ applied: 1 });
    expect(await statusOf(inv)).toBe('paid');
    expect(await balanceOf(inv)).toBe(0);
    expect(await receiptsOf(w.tenantId)).toHaveLength(1);
    expect(await types(w.tenantId)).toContain('PaymentConfirmed');
    expect((await q<{ status: string }>('select status from public.payment_requests where id = $1', [link.id]))[0]?.status).toBe('paid');
    expect(w.notifier.alerts.map((a) => a.kind)).toContain('payment_invoice_paid');

    expect(await w.receipts()).toEqual({ sent: 1 });
    expect(await w.receipts()).toEqual({});
    expect(w.email.keys()).toEqual([`receipt:${(await receiptsOf(w.tenantId))[0]?.id}`]);
    const body = w.email.calls[0]?.content.kind === 'email' ? w.email.calls[0].content.text : '';
    expect(body).toContain('£1,250.50');
    expect(body).toContain('Remaining balance: £0.00');

    // The paid link was switched off at the provider right after the ledger commit; the sweep finds nothing left.
    expect(w.gw.link(link.objectId)?.active).toBe(false);
    expect(await w.sweepRequests()).toEqual({ retired: 0, synced: 0, failed: 0 });
    await w.run();
    expect((await outboxOf(w.tenantId)).filter((m) => m.purpose === 'reminder')).toEqual([]);
    expect(await integrityOf(w.tenantId)).toEqual([]);
  });

  it('duplicate delivery and a webhook + poll for the same payment apply the money once', async () => {
    const w = await payWorld();
    const link = await w.link();
    w.gw.pay(link.objectId);
    const r = await w.deliver({ duplicate: true });
    expect(r.map((x) => (x.status === 200 ? [x.stored, x.duplicates] : x.status))).toEqual([
      [1, 0],
      [0, 1],
    ]);
    // The poll stores a second event (another provider event id), but the receipt key is the same money.
    w.clock.advanceMinutes(120);
    await q(`update public.payment_requests set created_at = created_at - interval '2 hours' where tenant_id = $1`, [w.tenantId]);
    await w.process();
    expect(await w.poll()).toMatchObject({ checked: 0 }); // already paid: not pending any more
    expect(await receiptsOf(w.tenantId)).toHaveLength(1);
  });

  it('polling finds a payment whose webhook never arrived (source poll), through the same pipeline', async () => {
    const w = await payWorld();
    const link = await w.link();
    w.gw.pay(link.objectId);
    w.gw.drain(); // the webhook is lost
    expect(await w.poll()).toMatchObject({ checked: 0 }); // too young to poll
    w.clock.advanceMinutes(61);
    expect(await w.poll()).toMatchObject({ checked: 1, stored: 1 });
    expect(await w.process()).toEqual({ applied: 1 });
    expect((await receiptsOf(w.tenantId))[0]?.source).toBe('poll');
    expect(await statusOf(w.invoiceIds[0] ?? '')).toBe('paid');
  });

  it('async method: processing is not paid; failed-then-success; reversed delivery order', async () => {
    const w = await payWorld();
    const inv = w.invoiceIds[0] ?? '';
    const link = await w.link();
    const p1 = w.gw.pay(link.objectId, { async: true });
    w.gw.settle(p1, 'failed');
    await w.deliver();
    expect(await w.process()).toEqual({ processing: 1, failed_recorded: 1 });
    expect(await statusOf(inv)).toBe('open');
    expect(await types(w.tenantId)).toContain('PaymentFailed');
    expect((await q<{ status: string }>('select status from public.payment_requests where id = $1', [link.id]))[0]?.status).toBe('active');

    const p2 = w.gw.pay(link.objectId, { async: true });
    w.gw.settle(p2, 'succeeded');
    await w.deliver({ reverse: true }); // confirmation before processing
    expect(await w.process()).toEqual({ applied: 1, processing: 1 });
    expect(await statusOf(inv)).toBe('paid');
  });

  it('success-then-failed and refunds become urgent reversal tasks; the invoice is never reopened (E)', async () => {
    const w = await payWorld();
    const inv = w.invoiceIds[0] ?? '';
    const link = await w.link();
    const p = w.gw.pay(link.objectId);
    await w.deliver();
    await w.process();
    w.gw.failAfterSuccess(link.objectId, p);
    w.gw.refund(p, 125050, 'GBP');
    await w.deliver();
    expect(await w.process()).toEqual({ reversal_recorded: 2 });
    expect(await statusOf(inv)).toBe('paid');
    expect(await balanceOf(inv)).toBe(0);
    expect((await tasksOf(w.tenantId)).filter((t) => t.type === 'payment_reversal')).toEqual([
      { type: 'payment_reversal', urgent: true, status: 'open', invoice_id: inv },
      { type: 'payment_reversal', urgent: true, status: 'open', invoice_id: inv },
    ]);
    expect((await types(w.tenantId)).filter((t) => t === 'PaymentReversed')).toHaveLength(2);
    expect(w.notifier.alerts.filter((a) => a.kind === 'payment_payment_reversal')).toHaveLength(2);
  });

  it('money for a cancelled or already-paid invoice is all credit, with an urgent task', async () => {
    const w = await payWorld({ count: 2 });
    const [a = '', b = ''] = w.invoiceIds;
    const la = await w.link(0);
    const lb = await w.link(1);
    await q(`update public.invoices set status = 'cancelled' where id = $1`, [a]);
    w.gw.pay(la.objectId, { race: true });
    w.gw.pay(lb.objectId);
    await w.deliver();
    await w.process();
    w.gw.pay(lb.objectId, { race: true }); // paid twice (the provider switch-off lagged)
    await w.deliver();
    expect(await w.process()).toEqual({ applied: 1 });
    expect(await statusOf(a)).toBe('cancelled');
    expect(await statusOf(b)).toBe('paid');
    expect((await creditsOf(w.tenantId)).sort()).toEqual([125050, 125050]);
    expect((await tasksOf(w.tenantId)).filter((t) => t.type === 'payment_on_final_invoice').map((t) => t.urgent)).toEqual([true, true]);
    expect(await integrityOf(w.tenantId)).toEqual([]);
  });

  it('unknown request -> urgent unmatched task; amount/currency mismatch -> task, nothing applied; mode mismatch -> rejected', async () => {
    const w = await payWorld();
    const inv = w.invoiceIds[0] ?? '';
    const link = await w.link();
    w.gw.forge({ type: 'link.paid', data: { link: 'plink_not_ours', payment: 'fpay_x', amount: 125050, currency: 'GBP' } });
    w.gw.pay(link.objectId, { amount: 100 });
    w.gw.pay(link.objectId, { currency: 'EUR' });
    await w.deliver();
    expect(await w.process()).toEqual({ unmatched: 1, mismatch: 2 });
    expect(await receiptsOf(w.tenantId)).toEqual([]);
    expect(await balanceOf(inv)).toBe(125050);
    const tasks = await tasksOf(w.tenantId);
    expect(tasks.filter((t) => t.type === 'unmatched_payment')).toEqual([{ type: 'unmatched_payment', urgent: true, status: 'open', invoice_id: null }]);
    expect(tasks.filter((t) => t.type === 'payment_amount_mismatch')).toHaveLength(2);
    expect(await tenantEventsOf(w.tenantId)).toContain('PaymentUnmatched');

    const live = await payWorld({ gatewayLive: true });
    const l2 = await live.link();
    live.gw.pay(l2.objectId);
    expect(await live.deliver()).toEqual([{ status: 400, reason: 'mode_mismatch' }]);
    expect(await q('select 1 from public.payment_events where tenant_id = $1', [live.tenantId])).toEqual([]);
  });
});

describe('manual payments, partial payments and the next reminder', () => {
  it('partial: balance reduced, status unchanged, receipt, and the NEXT reminder shows the new balance and a new link', async () => {
    const w = await payWorld();
    const inv = w.invoiceIds[0] ?? '';
    await q(`update public.templates set body = 'Hi {{customer_name}}, {{invoice_number}}.' || chr(10) || '{{payment_block}}' where tenant_id = $1 and template_key = 'nudge'`, [w.tenantId]);
    await w.run(); // s1 (friendly) with a link for the full amount
    const first = (await outboxOf(w.tenantId))[0];
    expect(first?.body).toContain('£1,250.50');
    expect(first?.body).toMatch(/https:\/\/pay\.fake\.test\/plink_[0-9a-f]+_\d+/);
    const firstLink = /plink_[0-9a-f]+_\d+/.exec(first?.body ?? '')?.[0] ?? 'none';

    expect(await w.manual(0, 50000, 'BANK-PART-1')).toMatchObject({ outcome: 'applied' });
    expect(await balanceOf(inv)).toBe(75050);
    expect(await statusOf(inv)).toBe('overdue');
    expect(await types(w.tenantId)).toContain('PartialPaymentConfirmed');
    expect(await w.receipts()).toEqual({ sent: 1 });

    w.clock.set('2026-06-17T09:00:00Z');
    await w.run();
    const reminders = (await outboxOf(w.tenantId)).filter((m) => m.purpose === 'reminder');
    expect(reminders.map((m) => m.idempotency_key.split(':')[1])).toEqual(['s1', 's2']);
    const next = reminders[1]?.body ?? '';
    expect(next).toContain('To pay £750.50 by bank transfer, please quote REF');
    expect(next).toContain('Pay £750.50 online: https://pay.fake.test/plink_');
    expect(next).not.toContain(firstLink);
    expect(w.gw.activeLinks()).toHaveLength(1); // the old fixed-amount link was switched off when replaced
    expect(await integrityOf(w.tenantId)).toEqual([]);
  });

  it('overpayment: paid + credit + overpayment_credit task; the same bank ref never counts twice', async () => {
    const w = await payWorld();
    const inv = w.invoiceIds[0] ?? '';
    expect(await w.manual(0, 200000, 'BANK-OVER')).toMatchObject({ outcome: 'applied' });
    expect(await statusOf(inv)).toBe('paid');
    expect(await creditsOf(w.tenantId)).toEqual([74950]);
    expect((await tasksOf(w.tenantId)).map((t) => t.type)).toContain('overpayment_credit');
    expect(await w.manual(0, 200000, 'BANK-OVER')).toMatchObject({ outcome: 'duplicate' });
    expect(await receiptsOf(w.tenantId)).toHaveLength(1);
  });

  it('a reminder sent after the money arrived is recorded (ReminderAfterPayment)', async () => {
    const w = await payWorld();
    await w.run();
    await w.manual(0, 125050, 'BANK-LATE', new Date('2026-06-09T12:00:00Z')); // paid the day before the reminder
    expect(await types(w.tenantId)).toContain('ReminderAfterPayment');
  });
});

describe('promises, disputes, approvals', () => {
  async function promised(promisedOn: string) {
    const w = await payWorld();
    const inv = w.invoiceIds[0] ?? '';
    await q(`update public.invoices set status = 'overdue' where id = $1`, [inv]);
    await q(`update public.invoices set status = 'promised', promised_on = $2 where id = $1`, [inv, promisedOn]);
    await q(`insert into public.promises (tenant_id, invoice_id, customer_id, promised_on, reference_at) values ($1, $2, $3, $4, now())`, [w.tenantId, inv, w.customerId, promisedOn]);
    return { w, inv };
  }
  const promiseStatus = (inv: string) => q<{ status: string }>('select status from public.promises where invoice_id = $1', [inv]).then((r) => r[0]?.status);

  it('paid within the promise (+grace) => kept', async () => {
    const { w, inv } = await promised('2026-06-15');
    await w.manual(0, 125050, 'BANK-P1', new Date('2026-06-17T20:00:00Z')); // 21:00 London on the last grace day
    expect(await promiseStatus(inv)).toBe('kept');
    expect(await types(w.tenantId)).toContain('PromiseKept');
  });

  it('paid after the deadline => not kept (PromiseBroken), still paid', async () => {
    const { w, inv } = await promised('2026-06-15');
    await w.manual(0, 125050, 'BANK-P2', new Date('2026-06-17T23:30:00Z')); // 00:30 London on 18 June
    expect(await promiseStatus(inv)).toBe('broken');
    expect(await statusOf(inv)).toBe('paid');
    expect(await types(w.tenantId)).toContain('PromiseBroken');
  });

  it('partial within the promise => promise stays active', async () => {
    const { w, inv } = await promised('2026-06-15');
    await w.manual(0, 1000, 'BANK-P3', new Date('2026-06-12T12:00:00Z'));
    expect(await promiseStatus(inv)).toBe('active');
  });

  it('payment while disputed: paid, alert, the dispute task stays open (DECISIONS)', async () => {
    const w = await payWorld();
    const inv = w.invoiceIds[0] ?? '';
    await q(`update public.invoices set status = 'disputed' where id = $1`, [inv]);
    await q(`insert into public.tasks (tenant_id, type, invoice_id, dedupe_key, created_at) values ($1, 'dispute', $2, 'd1', now())`, [w.tenantId, inv]);
    await w.manual(0, 125050, 'BANK-D');
    expect(await statusOf(inv)).toBe('paid');
    expect((await tasksOf(w.tenantId)).find((t) => t.type === 'dispute')?.status).toBe('open');
    expect(w.notifier.alerts.map((a) => a.kind)).toContain('payment_payment_while_disputed');
  });

  it('payment supersedes pending approvals; nothing is sent afterwards', async () => {
    const w = await payWorld({ approvalMode: 'always' });
    expect((await w.run()).outcomes).toEqual({ approval_requested: 1 });
    await w.manual(0, 125050, 'BANK-A');
    expect((await q<{ status: string }>('select status from public.approvals where tenant_id = $1', [w.tenantId])).map((a) => a.status)).toEqual(['superseded']);
    await q(`update public.invoices set next_action_at = '2000-01-01' where tenant_id = $1`, [w.tenantId]);
    await w.run();
    expect(w.email.keys().filter((k) => !k.startsWith('receipt:'))).toEqual([]);
  });

  it('the paid check runs right before the send (issue L): money landing mid-job stops the reminder', async () => {
    const w = await payWorld();
    w.email.onSend = null;
    let paidDuringJob = false;
    const r = await w.run({
      failpoints: {
        hit: async (name) => {
          if (name === 'after_pending_insert' && !paidDuringJob) {
            paidDuringJob = true;
            await w.manual(0, 125050, 'BANK-RACE');
          }
        },
      },
    });
    expect(r.outcomes).toEqual({ no_action: 1 });
    expect(w.email.calls).toEqual([]);
    expect((await outboxOf(w.tenantId)).filter((m) => m.purpose === 'reminder').map((m) => m.failed_reason)).toEqual(['gate_paid']);
  });
});

describe('receipts', () => {
  it('none to an opted-out customer (ReceiptSkipped); held while the kill switch is on, sent once after', async () => {
    const w = await payWorld({ count: 2, separateCustomers: true });
    await q(`update public.customers set opted_out = true where id = $1`, [w.customerId]);
    await w.manual(0, 125050, 'BANK-R1');
    expect(await w.receipts()).toEqual({ skipped: 1 });
    expect(await types(w.tenantId)).toContain('ReceiptSkipped');

    await q(`update public.tenants set outbound_paused = true where id = $1`, [w.tenantId]);
    await w.manual(1, 125050, 'BANK-R2');
    expect(await w.receipts()).toEqual({ released: 1 });
    expect(w.email.calls).toEqual([]);
    await q(`update public.tenants set outbound_paused = false where id = $1`, [w.tenantId]);
    await q(`update pgmq.q_transactional_sends set vt = now() - interval '1 second' where message ->> 'tenant_id' = $1`, [w.tenantId]);
    expect(await w.receipts()).toEqual({ sent: 1 });
    expect(await w.receipts()).toEqual({});
    expect(w.email.calls).toHaveLength(1);
  });

  it('an ambiguous receipt send is never retried automatically (rule 17) and does not park reminders', async () => {
    const w = await payWorld();
    await w.manual(0, 1000, 'BANK-AMB');
    w.email.next = [{ kind: 'ambiguous', reason: 'timeout' }];
    expect(await w.receipts()).toEqual({ ambiguous: 1 });
    w.clock.advanceMinutes(30);
    await w.sweep();
    const m = (await outboxOf(w.tenantId)).find((x) => x.purpose === 'receipt');
    expect(m?.send_state).toBe('unknown');
    expect((await q<{ parked_reason: string | null }>('select parked_reason from public.invoices where id = $1', [w.invoiceIds[0]]))[0]?.parked_reason).toBeNull();
    expect(await w.receipts()).toEqual({});
    expect(w.email.calls).toHaveLength(1);
  });
});

describe('reconcile (read-only)', () => {
  it('reports provider payments missing from the ledger and ledger entries the provider does not know; writes nothing', async () => {
    const { reconcile } = await import('@dueloop/payments');
    const w = await payWorld({ count: 2 });
    const a = await w.link(0);
    await w.link(1);
    const ref = w.gw.pay(a.objectId);
    w.gw.drain(); // webhook lost, not polled yet
    const from = new Date('2000-01-01T00:00:00Z');
    const to = new Date('2100-01-01T00:00:00Z');
    const snap = async () => JSON.stringify(await q(`select (select count(*) from public.receipts where tenant_id = $1) r, (select count(*) from public.payment_events where tenant_id = $1) e, (select count(*) from public.tasks where tenant_id = $1) t`, [w.tenantId]));
    const before = await snap();
    const r1 = await reconcile(w.pdeps(), w.tenantId, from, to);
    expect(r1.checkedRequests).toBe(2);
    expect(r1.findings).toEqual([{ finding: 'missing_in_ledger', invoiceId: w.invoiceIds[0], providerRef: ref, amountMinor: 125050 }]);
    expect(await snap()).toBe(before);
    // A gateway receipt for invoice 2 that the provider never reported (inserted raw, triggers off, then removed).
    const c = await pool.connect();
    try {
      await c.query('set session_replication_role = replica');
      await c.query(
        `insert into public.receipts (tenant_id, invoice_id, customer_id, method, source, provider_ref, amount, currency, received_at) values ($1, $2, $3, 'fake', 'gateway', 'fpay_ghost', 10, 'GBP', now())`,
        [w.tenantId, w.invoiceIds[1], w.customerId],
      );
      const r = await reconcile(w.pdeps(), w.tenantId, from, to);
      expect(r.findings.filter((f) => f.finding === 'unknown_to_provider')).toEqual([{ finding: 'unknown_to_provider', invoiceId: w.invoiceIds[1], providerRef: 'fpay_ghost', amountMinor: 10 }]);
      await c.query(`delete from public.receipts where tenant_id = $1 and provider_ref = 'fpay_ghost'`, [w.tenantId]);
    } finally {
      await c.query('set session_replication_role = origin');
      c.release();
    }
    w.clock.advanceMinutes(61);
    await w.poll();
    await w.process();
    const r2 = await reconcile(w.pdeps(), w.tenantId, from, to);
    expect(r2.findings.filter((f) => f.finding === 'missing_in_ledger')).toEqual([]);
  });
});
