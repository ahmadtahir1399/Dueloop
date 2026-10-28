// Worker loop against the real local database with a fake channel and a fake clock.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reconcileMessage } from '../src/process.ts';
import { eventsOf, expireVisibility, invoice, messagesOf, pool, q, quietCron, world } from './harness.ts';

beforeAll(quietCron);
afterAll(() => pool.end());

describe('send protocol basics', () => {
  it('one send per key, however often the job runs', async () => {
    const w = await world();
    await w.run();
    await w.run();
    w.clock.advanceMinutes(30);
    await w.run();
    expect(w.email.keys()).toEqual([`${w.invoiceIds[0]}:s1:email`]);
    const [m] = await messagesOf(w.tenantId);
    expect(m).toMatchObject({ send_state: 'sent', attempt: 1 });
    expect(m?.rfc_message_id).toMatch(/^<.+\.s1\.email\.dueloop@test-co\.example>$/);
    expect((await eventsOf(w.tenantId)).map((e) => e.type)).toEqual(['InvoiceOverdue', 'ReminderSent']);
  });

  it('quiet hours: nothing is sent, the invoice waits for 09:00 local', async () => {
    const w = await world({ clock: '2026-06-10T20:30:00Z' }); // 21:30 London
    await w.run();
    expect(w.email.calls).toHaveLength(0);
    expect((await invoice(w.invoiceIds[0] ?? ''))?.next_action_at.toISOString()).toBe('2026-06-11T08:00:00.000Z');
  });

  it('tenant holiday: nothing is sent', async () => {
    const w = await world({ holidays: ['2026-06-10'] });
    await w.run();
    expect(w.email.calls).toHaveLength(0);
  });

  it('paused tenant: nothing is enqueued, and a job already queued is released at the send gate', async () => {
    const w = await world();
    await q('update public.tenants set outbound_paused = true where id = $1', [w.tenantId]);
    expect(await w.run()).toMatchObject({ claimed: 0 });
    // Queued before the pause:
    await q('update public.tenants set outbound_paused = false where id = $1', [w.tenantId]);
    await w.deps().db.enqueue(1000, w.clock.now());
    await q('update public.tenants set outbound_paused = true where id = $1', [w.tenantId]);
    const r = await w.run();
    expect(r.outcomes).toEqual({ released: 1 });
    expect(w.email.calls).toHaveLength(0);
  });

  it('opted-out customer: never contacted', async () => {
    const w = await world({ customer: { optedOut: true } });
    await w.run();
    w.clock.advanceMinutes(24 * 60);
    await expireVisibility(w.tenantId);
    await w.run();
    expect(w.email.calls).toHaveLength(0);
  });

  it('issue C: the weekly cap is per CUSTOMER (two invoices, one customer, cap 1)', async () => {
    const w = await world({ maxPerWeek: 1, invoices: [{ dueOn: '2026-06-01' }, { dueOn: '2026-06-02' }] });
    await w.run();
    expect(w.email.calls).toHaveLength(1);
    w.clock.set('2026-06-12T09:00:00Z');
    await expireVisibility(w.tenantId);
    await w.run();
    expect(w.email.calls).toHaveLength(1); // the other invoice waits: the customer already had 1 this week
  });

  it('issue D: a late import gets at most one reminder per local day', async () => {
    const w = await world({ invoices: [{ dueOn: '2026-05-01' }] }); // 40 days overdue: s1, s2, s3 all "due"
    for (let i = 0; i < 3; i++) {
      w.clock.advanceMinutes(60);
      await expireVisibility(w.tenantId);
      await w.run();
    }
    expect(w.email.keys().map((k) => k.split(':')[1])).toEqual(['s1']);
    const next = (await invoice(w.invoiceIds[0] ?? ''))?.next_action_at;
    expect(next?.toISOString()).toBe('2026-06-11T08:00:00.000Z'); // next local day's window (09:00 BST)
    w.clock.set('2026-06-11T08:00:00Z');
    await w.run();
    w.clock.set('2026-06-12T08:00:00Z');
    await w.run();
    expect(w.email.keys().map((k) => k.split(':')[1])).toEqual(['s1', 's2', 's3']);
  });
});

describe('approvals (issue E, rule 16)', () => {
  const approve = (id: string, decision: 'approve' | 'reject', at: Date) =>
    q<{ r: string }>('select private.decide_approval_impl($1, $2, null, $3, $4) as r', [id, decision, 'test', at]).then((x) => x[0]?.r);

  it('creates one approval per key, sends once after approval, never twice', async () => {
    const w = await world({ approvalMode: 'always' });
    expect((await w.run()).outcomes).toEqual({ approval_requested: 1 });
    await w.run(); // parked at infinity: not enqueued again, no duplicate approval
    const approvals = await q<{ id: string; status: string }>('select id, status from public.approvals where tenant_id = $1', [w.tenantId]);
    expect(approvals).toHaveLength(1);
    expect(w.email.calls).toHaveLength(0);
    expect(await approve(approvals[0]?.id ?? '', 'approve', w.clock.now())).toBe('approved');
    await w.run();
    await w.run();
    expect(w.email.calls).toHaveLength(1);
  });

  // Prompt 3 treated low_confidence as 'always'; prompt 4 (issue N) defines it: approval only while a reply is in
  // doubt. The doubt cases are in gates.test.ts.
  it('low_confidence without any unresolved reply doubt sends without approval (prompt 4, issue N)', async () => {
    const w = await world({ approvalMode: 'low_confidence' });
    expect((await w.run()).outcomes).toEqual({ sent: 1 });
  });

  it('a rejected step is skipped and never proposed again', async () => {
    const w = await world({ approvalMode: 'always', invoices: [{ dueOn: '2026-06-08' }] }); // only s1 due
    await w.run();
    const [a] = await q<{ id: string }>('select id from public.approvals where tenant_id = $1', [w.tenantId]);
    expect(await approve(a?.id ?? '', 'reject', w.clock.now())).toBe('rejected');
    await w.run();
    expect(w.email.calls).toHaveLength(0);
    expect(await q('select 1 from public.approvals where tenant_id = $1', [w.tenantId])).toHaveLength(1);
    expect((await messagesOf(w.tenantId))[0]?.send_state).toBe('skipped');
  });

  it('approving after the invoice was paid supersedes the approval and sends nothing', async () => {
    const w = await world({ approvalMode: 'always' });
    await w.run();
    await q(`insert into public.payments (tenant_id, invoice_id, amount, currency, method, provider_ref, paid_at)
             values ($1, $2, 125050, 'GBP', 'bank_transfer', 'P1', now())`, [w.tenantId, w.invoiceIds[0]]);
    await q(`update public.invoices set status = 'paid' where id = $1`, [w.invoiceIds[0]]);
    const [a] = await q<{ id: string }>('select id from public.approvals where tenant_id = $1', [w.tenantId]);
    expect(await approve(a?.id ?? '', 'approve', w.clock.now())).toBe('superseded');
    await w.run();
    expect(w.email.calls).toHaveLength(0);
  });

  it('an approved key that decide() no longer proposes is superseded (opt-out after approval)', async () => {
    const w = await world({ approvalMode: 'always' });
    await w.run();
    const [a] = await q<{ id: string }>('select id from public.approvals where tenant_id = $1', [w.tenantId]);
    await approve(a?.id ?? '', 'approve', w.clock.now());
    await q('update public.customers set opted_out = true where id = $1', [w.customerId]);
    await w.run();
    expect(w.email.calls).toHaveLength(0);
    expect((await q<{ status: string }>('select status from public.approvals where id = $1', [a?.id]))[0]?.status).toBe('superseded');
  });

  it('a pending approval expires and the invoice re-enters decide() (new version)', async () => {
    const w = await world({ approvalMode: 'always' });
    await w.run();
    w.clock.advanceMinutes(8 * 24 * 60);
    expect((await w.sweep()).expired).toBeGreaterThanOrEqual(1); // the sweep is global (all tenants)
    await w.run();
    const rows = await q<{ status: string; version: number }>('select status, version from public.approvals where tenant_id = $1', [w.tenantId]);
    expect(rows).toEqual([{ status: 'pending', version: 2 }]);
  });
});

describe('gates park with ONE alert', () => {
  it('missing template parks and alerts once; un-parking without a fix alerts no more', async () => {
    const w = await world({ templates: false });
    expect((await w.run()).outcomes).toEqual({ parked: 1 });
    expect((await invoice(w.invoiceIds[0] ?? ''))?.parked_reason).toBe('template_missing');
    await q('select private.unpark_invoice($1, $2)', [w.invoiceIds[0], w.clock.now()]);
    await w.run();
    expect(w.notifier.alerts.filter((a) => a.kind === 'parked')).toHaveLength(1);
  });

  it('missing email account parks', async () => {
    const w = await world({ emailAccount: false });
    expect((await w.run()).outcomes).toEqual({ parked: 1 });
    expect((await invoice(w.invoiceIds[0] ?? ''))?.parked_reason).toBe('account_missing');
  });

  it('issue H: WhatsApp with budget 0 parks (paid channel blocked); email is never budgeted', async () => {
    const steps = [{ id: 's1', daysAfterDue: 1, channel: 'whatsapp' as const, templateKey: 'wa' }];
    const w = await world({ steps, budgetMinor: 0, whatsappConsent: true });
    await w.run();
    expect((await invoice(w.invoiceIds[0] ?? ''))?.parked_reason).toBe('budget_exhausted');
    const w2 = await world({ steps, budgetMinor: 100, whatsappConsent: true });
    await w2.run();
    expect(w2.whatsapp.calls).toHaveLength(1);
    expect(w2.whatsapp.calls[0]?.content).toMatchObject({ kind: 'whatsapp_template', templateName: 'payment_reminder', languageCode: 'en_US' });
  });

  it('issue I: WhatsApp without consent skips the step (no fallback to email)', async () => {
    const steps = [{ id: 's1', daysAfterDue: 1, channel: 'whatsapp' as const, templateKey: 'wa' }];
    const w = await world({ steps, budgetMinor: 100 });
    expect((await w.run()).outcomes).toEqual({ skipped: 1 });
    expect(w.whatsapp.calls).toHaveLength(0);
    expect(w.email.calls).toHaveLength(0);
  });
});

describe('outcomes', () => {
  it('retryable failure: retry with backoff, same key, then sent', async () => {
    const w = await world();
    w.email.next = [{ kind: 'not_sent_retryable', reason: 'ECONNREFUSED' }];
    expect((await w.run()).outcomes).toEqual({ retry_scheduled: 1 });
    expect((await messagesOf(w.tenantId))[0]).toMatchObject({ send_state: 'retry', attempt: 1 });
    await expireVisibility(w.tenantId);
    await w.run();
    expect(w.email.keys()).toEqual([`${w.invoiceIds[0]}:s1:email`, `${w.invoiceIds[0]}:s1:email`]);
    expect((await messagesOf(w.tenantId))[0]).toMatchObject({ send_state: 'sent', attempt: 2 });
  });

  it('after maxAttempts retryable failures the job is dead-lettered and the owner alerted', async () => {
    const w = await world();
    w.email.fallback = { kind: 'not_sent_retryable', reason: 'ECONNREFUSED' };
    for (let i = 0; i < 3; i++) {
      await expireVisibility(w.tenantId);
      await w.run({ config: { maxAttempts: 3 } });
    }
    expect(w.email.calls).toHaveLength(3);
    expect(await q('select 1 from public.dead_letters where tenant_id = $1', [w.tenantId])).toHaveLength(1);
    expect(w.notifier.alerts.some((a) => a.kind === 'dead_letter')).toBe(true);
    expect((await invoice(w.invoiceIds[0] ?? ''))?.parked_reason).toBe('dead_letter');
  });

  it('permanent failure: failed_permanent, step counts as skipped, next step later', async () => {
    const w = await world({ invoices: [{ dueOn: '2026-06-08' }] });
    w.email.next = [{ kind: 'permanent', reason: 'mailbox_does_not_exist' }];
    expect((await w.run()).outcomes).toEqual({ failed_permanent: 1 });
    expect((await eventsOf(w.tenantId)).map((e) => e.type)).toContain('ReminderFailed');
    await w.run();
    expect(w.email.calls).toHaveLength(1); // s1 is not proposed again; s2 not due until day 7
  });

  it('issue K: a timeout is AMBIGUOUS -> unknown after the sweep, never resent; reconcile works', async () => {
    const w = await world();
    w.email.next = ['hang'];
    expect((await w.run()).outcomes).toEqual({ ambiguous: 1 });
    w.clock.advanceMinutes(20);
    expect((await w.sweep()).unknown).toBe(1);
    await w.run();
    w.clock.advanceMinutes(24 * 60);
    await w.run();
    expect(w.email.calls).toHaveLength(1);
    const [m] = await messagesOf(w.tenantId);
    expect(m?.send_state).toBe('unknown');
    expect(w.notifier.alerts.filter((a) => a.kind === 'message_unknown')).toHaveLength(1);
    // A human checked the mail log: not sent -> the step re-opens and goes out once.
    expect(await reconcileMessage(w.deps(), m?.id ?? '', 'not_sent')).toBe(true);
    await w.run();
    expect(w.email.calls).toHaveLength(2);
    expect((await messagesOf(w.tenantId))[0]?.send_state).toBe('sent');
  });

  it('reconcile as sent appends ReminderSent and moves on without a send', async () => {
    const w = await world();
    w.email.next = ['hang'];
    await w.run();
    w.clock.advanceMinutes(20);
    await w.sweep();
    const [m] = await messagesOf(w.tenantId);
    await reconcileMessage(w.deps(), m?.id ?? '', 'sent');
    await w.run();
    expect(w.email.calls).toHaveLength(1); // rule D: the reconciled send counts; s2 waits for the next local day
    expect((await eventsOf(w.tenantId)).filter((e) => e.type === 'ReminderSent')).toHaveLength(1);
  });
});

describe('rendering', () => {
  it('amounts, dates and the footer follow the template actually used, not the customer language', async () => {
    // Only English templates exist; an Arabic-speaking customer gets the English text, formatted as English.
    const w = await world({ customer: { language: 'ar' } });
    await w.run();
    const env = w.email.calls[0]?.content;
    expect(env?.kind).toBe('email');
    const text = env?.kind === 'email' ? env.text : '';
    expect(text).toContain('£1,250.50');
    expect(text).toContain('Jun 1, 2026');
    expect(text).toContain('reply STOP');
  });
});

describe('logging (rules 19, 20)', () => {
  it('captured logs contain no emails, phone numbers, names or message text', async () => {
    const w = await world();
    await w.run();
    w.email.next = [{ kind: 'permanent', reason: 'rejected ada@customer.example +447700900123' }];
    const w2 = await world({ invoices: [{ dueOn: '2026-06-08' }] });
    w2.email.next = [{ kind: 'permanent', reason: 'rejected ada@customer.example +447700900123' }];
    await w2.run();
    const all = [...w.logs, ...w2.logs].join('\n');
    expect(all.length).toBeGreaterThan(50);
    expect(all).not.toMatch(/@|\+44\d{6,}|Ada Customer|Hi Ada|IBAN/);
  });
});
