// pnpm chaos (inbound part): crash at every pipeline step and SIGKILL the processor mid-batch.
// Invariant: a reply's effects happen exactly once, whatever is re-delivered.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { InboundFailpoint } from '../src/ports.ts';
import { analysis, crashAt, expireInboundVisibility, mail, pool, q, quietCron, replyWorld } from './harness.ts';

beforeAll(quietCron);
afterAll(() => pool.end());

const ada = 'Ada Customer <ada@customer.example>';
const effectsOf = async (tenantId: string) => ({
  promises: (await q('select 1 from public.promises where tenant_id = $1', [tenantId])).length,
  promiseEvents: (await q(`select 1 from public.invoice_events where tenant_id = $1 and type = 'PromiseRecorded'`, [tenantId])).length,
  status: (await q<{ status: string }>('select status from public.invoices where tenant_id = $1', [tenantId]))[0]?.status,
  pendingEvents: (await q(`select 1 from public.inbound_events where tenant_id = $1 and status = 'pending'`, [tenantId])).length,
  queued: (await q(`select 1 from pgmq.q_inbound_events where message ->> 'tenant_id' = $1`, [tenantId])).length,
});

describe('inbound kill points', () => {
  it('after_raw_insert: the provider retries (no 2xx seen) => stored once, effects once', async () => {
    const w = await replyWorld();
    w.script.push(['pay', analysis('promise_to_pay', { promisedDate: '2026-11-15' })]);
    const raw = mail({ from: ada, messageId: '<k0@c>', inReplyTo: w.invoices[0]?.rfcId, body: 'I will pay on the 15th' });
    expect(await w.email(raw, 'uid:1')).not.toBeNull(); // stored + queued atomically, then the "process died"
    expect(await w.email(raw, 'uid:1')).toBeNull(); // the retry stores nothing
    await w.run();
    expect(await effectsOf(w.tenantId)).toEqual({ promises: 1, promiseEvents: 1, status: 'promised', pendingEvents: 0, queued: 0 });
  });

  it.each<InboundFailpoint>(['after_message_insert', 'after_classify', 'after_apply'])('crash %s, re-deliver twice => effects exactly once', async (point) => {
    const w = await replyWorld();
    w.script.push(['pay', analysis('promise_to_pay', { promisedDate: '2026-11-15' })]);
    await w.email(mail({ from: ada, messageId: `<k-${point}@c>`, inReplyTo: w.invoices[0]?.rfcId, body: 'I will pay on the 15th' }));
    await expect(w.run({ failpoints: crashAt(point) })).rejects.toThrow(/failpoint/);
    for (let i = 0; i < 2; i++) {
      await expireInboundVisibility(w.tenantId);
      await w.run();
    }
    expect(await effectsOf(w.tenantId)).toEqual({ promises: 1, promiseEvents: 1, status: 'promised', pendingEvents: 0, queued: 0 });
    // Alerts are best effort after commit: at most one, and none is lost before the apply commits.
    expect(w.alerts.length).toBe(point === 'after_apply' ? 0 : 1);
  });
});

describe('SIGKILL the processor mid-batch', () => {
  it('200 events with duplicates and out-of-order pairs: no duplicate effect, no lost event, none stuck', { timeout: 180_000 }, async () => {
    const w = await replyWorld({ invoices: 1 });
    // 100 customers, each with one overdue invoice and one reminder we sent.
    const cust = await q<{ id: string; inv: string; rfc: string; email: string }>(
      `with c as (
         insert into public.customers (tenant_id, display_name, email)
         select $1, 'Load ' || g, 'load' || g || '@customer.example' from generate_series(1, 100) g returning id, email),
       i as (
         insert into public.invoices (tenant_id, customer_id, number, amount_total, currency, issued_on, due_on, reference_code, status)
         select $1, c.id, 'L-' || row_number() over (), 1000, 'GBP', '2026-09-01', '2026-10-01', 'REF' || upper(substr(md5(c.id::text), 1, 9)), 'open'
         from c returning id, customer_id)
       select c.id, i.id as inv, '<' || i.id || '.s1.email.dueloop@test-co.example>' as rfc, c.email from c join i on i.customer_id = c.id`,
      [w.tenantId],
    );
    await q(`update public.invoices set status = 'overdue' where tenant_id = $1 and status = 'open'`, [w.tenantId]);
    for (const c of cust) {
      const m = await q<{ id: string }>(
        `insert into public.messages (tenant_id, customer_id, channel, direction, idempotency_key, send_state, step_id, rfc_message_id, sent_at)
         values ($1, $2, 'email', 'out', $3, 'sent', 's1', $4, '2026-10-19T09:00:00Z') returning id`,
        [w.tenantId, c.id, `${c.inv}:s1:email`, c.rfc],
      );
      await q('insert into public.message_invoices (tenant_id, message_id, invoice_id) values ($1, $2, $3)', [w.tenantId, m[0]?.id, c.inv]);
    }
    // 200 events: per customer a promise reply; half of them re-delivered (same Message-ID, new UID), the other
    // half get a second, OLDER reply delivered after the newer one (out of order).
    let events = 0;
    for (const [i, c] of cust.entries()) {
      const reply = mail({ from: c.email, messageId: `<p${i}@load>`, inReplyTo: c.rfc, date: 'Tue, 20 Oct 2026 10:30:00 +0100', body: 'I will pay on 2026-11-20' });
      await w.email(reply, `uid:${i}:a`);
      events++;
      if (i % 2 === 0) await w.email(reply, `uid2:${i}:a`);
      else await w.email(mail({ from: c.email, messageId: `<o${i}@load>`, inReplyTo: c.rfc, date: 'Tue, 20 Oct 2026 09:00:00 +0100', body: 'I will pay on 2026-11-10' }), `uid:${i}:b`);
      events++;
    }
    expect(events).toBe(200);

    const runner = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'sigkill-runner.ts');
    const env = { ...process.env, TENANT_ID: w.tenantId, NOW_ISO: w.clock.now().toISOString() };
    const processed = async () => (await q(`select 1 from public.inbound_events where tenant_id = $1 and status <> 'pending'`, [w.tenantId])).length;
    const first = spawn(process.execPath, [runner], { env, stdio: 'ignore' });
    while ((await processed()) < 50) await new Promise((r) => setTimeout(r, 50));
    first.kill('SIGKILL');
    await new Promise((r) => first.once('exit', r));
    const atKill = await processed();
    const second = spawn(process.execPath, [runner], { env, stdio: 'ignore' });
    expect(await new Promise((r) => second.once('exit', (c) => r(c)))).toBe(0);

    const perInvoice = await q<{ promises: number; active: number; events: number; tasks: number }>(
      `select (select count(*)::int from public.promises p where p.invoice_id = i.id) as promises,
              (select count(*)::int from public.promises p where p.invoice_id = i.id and p.status = 'active') as active,
              (select count(*)::int from public.invoice_events e where e.invoice_id = i.id and e.type = 'PromiseRecorded') as events,
              (select count(*)::int from public.tasks t where t.invoice_id = i.id) as tasks
       from public.invoices i where i.tenant_id = $1 and i.number like 'L-%'`,
      [w.tenantId],
    );
    const states = await q<{ status: string; n: number }>(`select status, count(*)::int as n from public.inbound_events where tenant_id = $1 group by 1`, [w.tenantId]);
    const unprocessedMessages = (await q(`select 1 from public.messages where tenant_id = $1 and direction = 'in' and processed_at is null`, [w.tenantId])).length;
    const queued = (await q(`select 1 from pgmq.q_inbound_events where message ->> 'tenant_id' = $1`, [w.tenantId])).length;
    console.log(JSON.stringify({ events, processedAtKill: atKill, states, unprocessedMessages, queued }));

    expect(perInvoice).toHaveLength(100);
    for (const r of perInvoice) {
      expect(r.active).toBe(1); // every customer's promise recorded once...
      expect(r.events).toBe(1); // ...with exactly one PromiseRecorded
      expect(r.promises).toBe(1); // no duplicate promise rows
      expect(r.tasks).toBeLessThanOrEqual(1); // the out-of-order second reply: at most one review task
    }
    expect(states).toEqual([{ status: 'processed', n: 200 }]); // no lost event
    expect(unprocessedMessages).toBe(0); // none stuck
    expect(queued).toBe(0);
  });
});
