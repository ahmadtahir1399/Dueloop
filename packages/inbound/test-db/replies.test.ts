// Inbound pipeline against the real local database (prompt 4 step 5): the outcome table, matching (F),
// promise lifecycle (G), duplicates and order (I), spoofing (J), evidence for unknown messages (M).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analysis, eventsOf, expireInboundVisibility, invoiceRow, mail, pool, promisesOf, q, quietCron, replyWorld, tasksOf } from './harness.ts';

beforeAll(quietCron);
afterAll(() => pool.end());

const ada = 'Ada Customer <ada@customer.example>';

describe('the outcome table (demo steps)', () => {
  it('clear promise on a threaded reply => promised, promise row, promised_on, one instant alert', async () => {
    const w = await replyWorld();
    const [inv] = w.invoices;
    w.script.push(["Can't pay until the 15th", analysis('promise_to_pay', { promisedDate: '2026-11-15', promisedDateText: 'the 15th' })]);
    await w.email(mail({ from: ada, messageId: '<r1@customer.example>', inReplyTo: inv?.rfcId, body: "Can't pay until the 15th, sorry." }));
    expect((await w.run()).outcomes).toEqual({ processed: 1 });
    expect(await invoiceRow(inv?.id ?? '')).toMatchObject({ status: 'promised', promised_on: '2026-11-15' });
    expect(await promisesOf(w.tenantId)).toEqual([{ invoice_id: inv?.id, status: 'active', promised_on: '2026-11-15' }]);
    expect(await eventsOf(w.tenantId, inv?.id ?? '')).toEqual(['PromiseRecorded', 'ReplyReceived']);
    expect(w.alerts.map((a) => a.kind)).toEqual(['reply_promise_recorded']);
    expect(await tasksOf(w.tenantId)).toEqual([]);
  });

  it('vague date => review task, status unchanged', async () => {
    const w = await replyWorld();
    w.script.push(['soon', analysis('promise_to_pay', { dateIsVague: true, promisedDateText: 'soon' })]);
    await w.email(mail({ from: ada, messageId: '<r2@c>', inReplyTo: w.invoices[0]?.rfcId, body: 'Will pay soon, promise.' }));
    await w.run();
    expect((await invoiceRow(w.invoices[0]?.id ?? ''))?.status).toBe('overdue');
    expect(await tasksOf(w.tenantId)).toMatchObject([{ type: 'review_promise', reason: 'vague_date' }]);
  });

  it('"already paid" => verification task that pauses reminders 3 days; status unchanged, never paid', async () => {
    const w = await replyWorld();
    w.script.push(['already paid', analysis('already_paid')]);
    await w.email(mail({ from: ada, messageId: '<r3@c>', inReplyTo: w.invoices[0]?.rfcId, body: 'I already paid, sent the transfer yesterday.' }));
    await w.run();
    const inv = await invoiceRow(w.invoices[0]?.id ?? '');
    expect(inv?.status).toBe('overdue');
    const [t] = await tasksOf(w.tenantId);
    expect(t).toMatchObject({ type: 'verify_payment_claim', reason: null });
    expect(t?.blocks_reminders_until?.toISOString()).toBe('2026-10-23T10:00:00.000Z');
    expect(inv?.next_action_at.getTime()).toBeGreaterThanOrEqual(t?.blocks_reminders_until?.getTime() ?? 0);
    expect((await q('select 1 from public.payments where invoice_id = $1', [w.invoices[0]?.id])).length).toBe(0);
    expect(w.alerts.map((a) => a.kind)).toEqual(['reply_payment_claim']);
  });

  it('dispute => disputed + dispute task + instant alert', async () => {
    const w = await replyWorld();
    w.script.push(['never ordered', analysis('dispute')]);
    await w.email(mail({ from: ada, messageId: '<r4@c>', inReplyTo: w.invoices[0]?.rfcId, body: 'We never ordered this work.' }));
    await w.run();
    expect((await invoiceRow(w.invoices[0]?.id ?? ''))?.status).toBe('disputed');
    expect(await tasksOf(w.tenantId)).toMatchObject([{ type: 'dispute' }]);
    expect(w.alerts[0]).toMatchObject({ kind: 'reply_dispute', severity: 'critical' });
  });

  it('STOP => opted out everywhere: flag, consents revoked, events on every open invoice; no model call', async () => {
    const w = await replyWorld({ invoices: 2 });
    await w.email(mail({ from: ada, messageId: '<r5@c>', body: 'STOP' }));
    await w.run();
    expect(w.classifier.calls).toHaveLength(0);
    expect((await q<{ opted_out: boolean }>('select opted_out from public.customers where id = $1', [w.customerId]))[0]?.opted_out).toBe(true);
    expect((await q('select 1 from public.customer_consents where customer_id = $1 and revoked_at is null', [w.customerId])).length).toBe(0);
    for (const inv of w.invoices) expect(await eventsOf(w.tenantId, inv.id)).toContain('OptOutRecorded');
    expect((await q<{ type: string }>('select type from public.tenant_events where tenant_id = $1', [w.tenantId])).map((r) => r.type)).toEqual(['OptOutRecorded']);
  });

  it('needs_info => info_request task with a code-written DRAFT (never sent) that pauses reminders', async () => {
    const w = await replyWorld();
    w.script.push(['copy of the invoice', analysis('needs_info')]);
    await w.email(mail({ from: ada, messageId: '<r6@c>', inReplyTo: w.invoices[0]?.rfcId, body: 'Can you send a copy of the invoice?' }));
    await w.run();
    const [t] = await tasksOf(w.tenantId);
    expect(t).toMatchObject({ type: 'info_request' });
    expect(t?.draft_reply).toContain('invoice T-1');
    expect(t?.blocks_reminders_until).not.toBeNull();
    expect((await q(`select 1 from public.messages where tenant_id = $1 and direction = 'out'`, [w.tenantId])).length).toBe(1); // only the original reminder
  });

  it.each(['payment_plan_request', 'wrong_person', 'unclear'])('%s => typed human_review task', async (intent) => {
    const w = await replyWorld();
    w.script.push(['hello there', analysis(intent)]);
    await w.email(mail({ from: ada, messageId: `<r-${intent}@c>`, inReplyTo: w.invoices[0]?.rfcId, body: 'hello there' }));
    await w.run();
    expect(await tasksOf(w.tenantId)).toMatchObject([{ type: 'human_review', reason: intent }]);
  });
});

describe('sender resolution', () => {
  it('a WhatsApp sender is found by its exact +digits even when libphonenumber calls the number invalid', async () => {
    // +44 7700 900xxx is Ofcom's fictional drama range: libphonenumber's isValid() rejects it, but it is what
    // the customer record holds and what Meta says the sender is.
    const w = await replyWorld();
    w.script.push(['already paid', analysis('already_paid')]);
    await w.whatsapp('message', { from: '447700900123', id: 'wamid.s1', timestamp: '1760950000', type: 'text', text: { body: 'I already paid' } }, 'wamid.s1');
    await w.run();
    expect(await tasksOf(w.tenantId)).toMatchObject([{ type: 'verify_payment_claim' }]);
  });
});

describe('matching (issue F: never guess)', () => {
  it('reply to one of three invoices WITH thread context => that invoice', async () => {
    const w = await replyWorld({ invoices: 3 });
    w.script.push(['pay this one', analysis('promise_to_pay', { promisedDate: '2026-11-01' })]);
    await w.email(mail({ from: ada, messageId: '<f1@c>', inReplyTo: w.invoices[1]?.rfcId, body: 'I will pay this one on 1 November.' }));
    await w.run();
    expect((await invoiceRow(w.invoices[1]?.id ?? ''))?.status).toBe('promised');
    expect((await invoiceRow(w.invoices[0]?.id ?? ''))?.status).toBe('overdue');
  });

  it('three recently reminded invoices WITHOUT thread context => ambiguous task listing the candidates, nothing changes', async () => {
    const w = await replyWorld({ invoices: 3 });
    w.script.push(['next week', analysis('promise_to_pay', { promisedDate: '2026-10-27' })]);
    await w.email(mail({ from: ada, messageId: '<f2@c>', body: "I'll pay next week." }));
    await w.run();
    for (const inv of w.invoices) expect((await invoiceRow(inv.id))?.status).toBe('overdue');
    const [t] = await tasksOf(w.tenantId);
    expect(t?.type).toBe('ambiguous_invoice');
    expect((t?.details.candidates as { number: string }[]).map((c) => c.number)).toEqual(['T-1', 'T-2', 'T-3']);
    expect(t?.draft_reply).toContain('which invoice you mean');
  });

  it('unknown sender => stored + unmatched task; no effects (even "STOP" resolves to no one)', async () => {
    const w = await replyWorld();
    await w.email(mail({ from: 'stranger@elsewhere.example', messageId: '<u1@x>', body: 'STOP' }));
    await w.run();
    expect(await tasksOf(w.tenantId)).toMatchObject([{ type: 'unmatched_inbound', reason: 'unknown_sender' }]);
    expect((await q<{ opted_out: boolean }>('select opted_out from public.customers where id = $1', [w.customerId]))[0]?.opted_out).toBe(false);
  });

  it('reply to a PAID invoice: stored, no transition; a dispute about it is a task only', async () => {
    const w = await replyWorld({ statuses: ['paid'] });
    w.script.push(['amount was wrong', analysis('dispute')]);
    await w.email(mail({ from: ada, messageId: '<p1@c>', inReplyTo: w.invoices[0]?.rfcId, body: 'The amount was wrong.' }));
    await w.run();
    expect((await invoiceRow(w.invoices[0]?.id ?? ''))?.status).toBe('paid');
    expect(await tasksOf(w.tenantId)).toMatchObject([{ type: 'dispute' }]);
  });
});

describe('duplicates, order and the promise lifecycle (issues G, I)', () => {
  it('the same email delivered twice (two raw events, one Message-ID) => effects exactly once', async () => {
    const w = await replyWorld();
    w.script.push(['the 15th', analysis('promise_to_pay', { promisedDate: '2026-11-15' })]);
    const raw = mail({ from: ada, messageId: '<d1@c>', inReplyTo: w.invoices[0]?.rfcId, body: 'Paying the 15th.' });
    expect(await w.email(raw, 'uidvalidity1:uid10')).not.toBeNull();
    expect(await w.email(raw, 'uidvalidity1:uid10')).toBeNull(); // provider retry: nothing stored
    expect(await w.email(raw, 'uidvalidity2:uid1')).not.toBeNull(); // UIDVALIDITY changed: new event, same message
    const r = await w.run();
    expect(r.outcomes).toEqual({ processed: 1, duplicate: 1 });
    expect(await promisesOf(w.tenantId)).toHaveLength(1);
    expect(w.alerts).toHaveLength(1);
  });

  it('two promises in the wrong order: the OLDER message processed later never supersedes the newer', async () => {
    const w = await replyWorld();
    w.script.push(['the 15th', analysis('promise_to_pay', { promisedDate: '2026-11-15' })]);
    w.script.push(['the 30th', analysis('promise_to_pay', { promisedDate: '2026-11-30' })]);
    const inv = w.invoices[0];
    // Newer (written 20 Oct 10:30) arrives first; older (written 20 Oct 09:00) arrives second.
    await w.email(mail({ from: ada, messageId: '<g-new@c>', inReplyTo: inv?.rfcId, date: 'Tue, 20 Oct 2026 10:30:00 +0100', body: 'Actually the 30th.' }));
    await w.run();
    await w.email(mail({ from: ada, messageId: '<g-old@c>', inReplyTo: inv?.rfcId, date: 'Tue, 20 Oct 2026 09:00:00 +0100', body: 'I can pay the 15th.' }));
    await w.run();
    expect(await promisesOf(w.tenantId)).toEqual([{ invoice_id: inv?.id, status: 'active', promised_on: '2026-11-30' }]);
    expect(await tasksOf(w.tenantId)).toMatchObject([{ type: 'review_promise', reason: 'promise_not_allowed_in_status' }]);
  });

  it('renewal cap: after 2 promises that did not hold, the next one goes to a human', async () => {
    const w = await replyWorld();
    const inv = w.invoices[0];
    for (const d of ['2026-09-10', '2026-09-20'])
      await q(`insert into public.promises (tenant_id, invoice_id, customer_id, promised_on, reference_at, status, resolved_at) values ($1, $2, $3, $4, now(), 'broken', now())`, [w.tenantId, inv?.id, w.customerId, d]);
    w.script.push(['really pay', analysis('promise_to_pay', { promisedDate: '2026-11-01' })]);
    await w.email(mail({ from: ada, messageId: '<cap@c>', inReplyTo: inv?.rfcId, body: 'I will really pay on 1 November.' }));
    await w.run();
    expect((await invoiceRow(inv?.id ?? ''))?.status).toBe('overdue');
    expect(await tasksOf(w.tenantId)).toMatchObject([{ type: 'review_promise', reason: 'renewal_cap' }]);
  });

  it('WhatsApp statuses out of order: a late "sent" never downgrades "delivered"; duplicates ignored', async () => {
    const w = await replyWorld();
    await q(`update public.messages set channel = 'whatsapp', provider_message_id = 'wamid.OUT1' where id = $1`, [w.invoices[0]?.outboundId]);
    await w.whatsapp('status', { id: 'wamid.OUT1', status: 'delivered', timestamp: '1760954400' }, 'wamid.OUT1:delivered');
    await w.whatsapp('status', { id: 'wamid.OUT1', status: 'sent', timestamp: '1760954300' }, 'wamid.OUT1:sent');
    expect(await w.whatsapp('status', { id: 'wamid.OUT1', status: 'sent', timestamp: '1760954300' }, 'wamid.OUT1:sent')).toBeNull();
    await w.run();
    expect((await q<{ delivery_status: string }>('select delivery_status from public.messages where id = $1', [w.invoices[0]?.outboundId]))[0]?.delivery_status).toBe('delivered');
  });
});

describe('spoofing, bounces, auto-replies and evidence (issues J, M)', () => {
  it('J: a forged From without a thread match => task only; opt-out is still accepted', async () => {
    const w = await replyWorld();
    w.script.push(['dispute this', analysis('dispute')]);
    await w.email(mail({ from: ada, messageId: '<j1@forged>', body: 'I dispute this invoice.' }));
    await w.run();
    expect((await invoiceRow(w.invoices[0]?.id ?? ''))?.status).toBe('overdue');
    expect(await tasksOf(w.tenantId)).toMatchObject([{ type: 'dispute', reason: 'unverified_sender' }]);
  });

  it('bounce (RFC 3464) => DeliveryFailed event + invalid_contact task + alert; never reaches the model', async () => {
    const w = await replyWorld();
    const inv = w.invoices[0];
    const dsn = [
      'From: Mail Delivery System <MAILER-DAEMON@mx.example>',
      'To: billing@test-co.example',
      'Subject: Undelivered Mail Returned to Sender',
      'Message-ID: <dsn-x@mx.example>',
      'MIME-Version: 1.0',
      'Content-Type: multipart/report; report-type=delivery-status; boundary="RR"',
      '',
      '--RR',
      'Content-Type: message/delivery-status',
      '',
      'Reporting-MTA: dns; mx.example',
      '',
      'Final-Recipient: rfc822; ada@customer.example',
      'Action: failed',
      'Status: 5.1.1',
      '--RR',
      'Content-Type: text/rfc822-headers',
      '',
      `Message-ID: ${inv?.rfcId}`,
      '--RR--',
      '',
    ].join('\r\n');
    await w.email(dsn);
    await w.run();
    expect(w.classifier.calls).toHaveLength(0);
    expect(await eventsOf(w.tenantId, inv?.id ?? '')).toContain('DeliveryFailed');
    expect(await tasksOf(w.tenantId)).toMatchObject([{ type: 'invalid_contact', reason: 'dsn_5_1_1' }]);
    expect(w.alerts.map((a) => a.kind)).toEqual(['reply_delivery_failed']);
  });

  it('auto-reply => stored, no effects, no model call, no engagement', async () => {
    const w = await replyWorld();
    await w.email(mail({ from: ada, messageId: '<ooo@c>', inReplyTo: w.invoices[0]?.rfcId, subject: 'Out of office', headers: 'Auto-Submitted: auto-replied', body: 'I am away until Monday.' }));
    await w.run();
    expect(w.classifier.calls).toHaveLength(0);
    expect(await tasksOf(w.tenantId)).toEqual([]);
    expect((await q<{ prefilter: string }>(`select prefilter from public.messages where tenant_id = $1 and direction = 'in'`, [w.tenantId]))[0]?.prefilter).toBe('auto_reply');
  });

  it('M: a reply threading to an UNKNOWN reminder resolves it to sent (no send happens)', async () => {
    const w = await replyWorld();
    const inv = w.invoices[0];
    await q(`update public.messages set send_state = 'unknown' where id = $1`, [inv?.outboundId]);
    await q(`update public.invoices set parked_reason = 'message_unknown', next_action_at = 'infinity' where id = $1`, [inv?.id]);
    w.script.push(['thanks', analysis('unclear')]);
    await w.email(mail({ from: ada, messageId: '<m1@c>', inReplyTo: inv?.rfcId, body: 'thanks for the reminder' }));
    await w.run();
    expect((await q<{ send_state: string }>('select send_state from public.messages where id = $1', [inv?.outboundId]))[0]?.send_state).toBe('sent');
    expect(await eventsOf(w.tenantId, inv?.id ?? '')).toEqual(expect.arrayContaining(['ReminderSent', 'MessageReconciled']));
    const row = await invoiceRow(inv?.id ?? '');
    expect(row?.next_action_at.getTime()).toBeLessThan(Infinity);
    expect((await q(`select 1 from public.messages where tenant_id = $1 and direction = 'out'`, [w.tenantId])).length).toBe(1);
  });
});

describe('classifier failures', () => {
  it('invalid output twice => human_review(invalid_output); the classifier was asked exactly twice', async () => {
    const w = await replyWorld();
    w.script.push(['weird', { intent: 'paid', markPaid: true }]);
    await w.email(mail({ from: ada, messageId: '<x1@c>', inReplyTo: w.invoices[0]?.rfcId, body: 'weird message' }));
    await w.run();
    expect(w.classifier.calls).toHaveLength(2);
    expect(await tasksOf(w.tenantId)).toMatchObject([{ type: 'human_review', reason: 'invalid_output' }]);
    expect((await invoiceRow(w.invoices[0]?.id ?? ''))?.status).toBe('overdue');
  });

  it('outage => retried via the queue, then dead-lettered with a task (never lost)', async () => {
    const w = await replyWorld();
    w.script.push(['outage', new Error('down')]);
    await w.email(mail({ from: ada, messageId: '<o1@c>', inReplyTo: w.invoices[0]?.rfcId, body: 'outage test' }));
    const outcomes: Record<string, number>[] = [];
    for (let i = 0; i < 3; i++) {
      outcomes.push({ ...(await w.run({ config: { maxAttempts: 3 } })).outcomes });
      await expireInboundVisibility(w.tenantId);
    }
    expect(outcomes).toEqual([{ retry: 1 }, { retry: 1 }, { dead_lettered: 1 }]);
    expect(await tasksOf(w.tenantId)).toMatchObject([{ type: 'unprocessed_inbound' }]);
    expect((await q(`select 1 from public.dead_letters where tenant_id = $1 and source = 'inbound_events'`, [w.tenantId])).length).toBe(1);
  });

  it('daily classification cap => human_review, the model is not called, the message is kept', async () => {
    const w = await replyWorld({ cap: 0 });
    await w.email(mail({ from: ada, messageId: '<cap0@c>', inReplyTo: w.invoices[0]?.rfcId, body: 'some reply' }));
    await w.run();
    expect(w.classifier.calls).toHaveLength(0);
    expect(await tasksOf(w.tenantId)).toMatchObject([{ type: 'human_review', reason: 'classification_cap' }]);
  });

  it('the model sees no names, emails, phone numbers or invoice numbers', async () => {
    const w = await replyWorld();
    await w.email(mail({ from: ada, messageId: '<pii@c>', inReplyTo: w.invoices[0]?.rfcId, body: 'Ada Customer here (ada@customer.example, +44 7700 900123) about T-1: will pay Friday.' }));
    await w.run();
    expect(w.classifier.calls[0]?.text).toBe('[name] here ([email], [number]) about [invoice]: will pay Friday.');
  });
});
