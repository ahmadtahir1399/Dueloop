// Prompt 5 step 8: concurrency (row lock + re-plan), crash at every pipeline step, and a real SIGKILL of the
// payment processor mid-batch. After every scenario: one effect per money, ledger integrity clean.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { processPaymentBatch, type PaymentFailpoint, type PaymentFailpoints } from '@dueloop/payments';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventsOf, pool, q, quietCron } from './harness.ts';
import { balanceOf, creditsOf, integrityOf, outboxOf, payWorld, receiptsOf, statusOf } from './payments-harness.ts';

beforeAll(quietCron);
afterAll(() => pool.end());

class PaymentCrash extends Error {
  constructor(point: string) {
    super(`failpoint ${point}`);
    this.name = 'FailpointCrash';
  }
}
const crashAt = (point: PaymentFailpoint): PaymentFailpoints & { fired: number } => {
  const fp = {
    fired: 0,
    hit(name: PaymentFailpoint) {
      if (name === point && fp.fired === 0) {
        fp.fired++;
        throw new PaymentCrash(name);
      }
    },
  };
  return fp;
};
const expirePaymentVisibility = (tenantId: string) => q(`update pgmq.q_payment_events set vt = now() - interval '1 second' where message ->> 'tenant_id' = $1`, [tenantId]);
const count = (types: string[], t: string) => types.filter((x) => x === t).length;

describe('concurrency (issue D)', () => {
  it('N partial payments in parallel that sum exactly to the total: one paid transition, balance 0, N receipts', async () => {
    const w = await payWorld();
    const inv = w.invoiceIds[0] ?? '';
    const parts = [12505, 12505, 12505, 12505, 12505, 12505, 12505, 12505, 12505, 12505]; // 10 x 125.05 = 1,250.50
    const d = w.pdeps({ config: { maxReplans: 50 } });
    const { confirmByHuman } = await import('@dueloop/payments');
    const results = await Promise.all(
      parts.map((amount, i) =>
        confirmByHuman(d, { tenantId: w.tenantId, invoiceId: inv, amountMinor: amount, currency: 'GBP', paidAt: w.clock.now(), bankRef: `PAR-${i}`, userId: w.ownerId, source: 'manual', proofId: null, note: null }),
      ),
    );
    expect(results.map((r) => r.outcome)).toEqual(Array(10).fill('applied'));
    const types = (await eventsOf(w.tenantId)).map((e) => e.type);
    expect(count(types, 'PaymentConfirmed')).toBe(1);
    expect(count(types, 'PartialPaymentConfirmed')).toBe(9);
    expect(await balanceOf(inv)).toBe(0);
    expect(await statusOf(inv)).toBe('paid');
    expect(await receiptsOf(w.tenantId)).toHaveLength(10);
    expect(await creditsOf(w.tenantId)).toEqual([]);
    expect(await integrityOf(w.tenantId)).toEqual([]);
  });

  it('parallel payments exceeding the total: applied stops at the total, the rest is credit', async () => {
    const w = await payWorld();
    const inv = w.invoiceIds[0] ?? '';
    const d = w.pdeps({ config: { maxReplans: 50 } });
    const { confirmByHuman } = await import('@dueloop/payments');
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        confirmByHuman(d, { tenantId: w.tenantId, invoiceId: inv, amountMinor: 20000, currency: 'GBP', paidAt: w.clock.now(), bankRef: `OVR-${i}`, userId: w.ownerId, source: 'manual', proofId: null, note: null }),
      ),
    );
    expect(await balanceOf(inv)).toBe(0);
    expect((await creditsOf(w.tenantId)).reduce((a, b) => a + b, 0)).toBe(200000 - 125050);
    expect(count((await eventsOf(w.tenantId)).map((e) => e.type), 'PaymentConfirmed')).toBe(1);
    expect(await integrityOf(w.tenantId)).toEqual([]);
  });

  it('the same provider event delivered 50x in parallel, processed by 5 parallel workers: one effect', async () => {
    const w = await payWorld();
    const link = await w.link();
    w.gw.pay(link.objectId);
    const [d] = w.gw.drain();
    if (!d) throw new Error('no delivery');
    const { ingestPaymentWebhook } = await import('@dueloop/payments');
    const r = await Promise.all(Array.from({ length: 50 }, () => ingestPaymentWebhook(w.pdeps(), w.token, d.rawBody, d.headers)));
    expect(r.filter((x) => x.status === 200 && x.stored === 1)).toHaveLength(1);
    expect(r.filter((x) => x.status === 200 && x.duplicates === 1)).toHaveLength(49);
    await Promise.all(Array.from({ length: 5 }, () => processPaymentBatch(w.pdeps(), { limit: 10, filter: { tenant_id: w.tenantId } })));
    expect(await receiptsOf(w.tenantId)).toHaveLength(1);
    expect(await w.receipts()).toEqual({ sent: 1 });
    expect(w.email.calls).toHaveLength(1);
  });
});

describe('crash at every pipeline step', () => {
  for (const point of ['after_store', 'after_resolve', 'after_plan', 'after_apply'] as const) {
    it(`${point}: the money counts once, the event ends processed, one receipt sent once`, async () => {
      const w = await payWorld();
      const inv = w.invoiceIds[0] ?? '';
      const link = await w.link();
      w.gw.pay(link.objectId);
      const fp = crashAt(point);
      const [d] = w.gw.drain();
      if (!d) throw new Error('no delivery');
      const { ingestPaymentWebhook } = await import('@dueloop/payments');
      if (point === 'after_store') {
        // The process dies after the event is stored and queued, before answering: the provider redelivers.
        await expect(ingestPaymentWebhook(w.pdeps({ failpoints: fp }), w.token, d.rawBody, d.headers)).rejects.toThrow('failpoint');
        expect(await ingestPaymentWebhook(w.pdeps(), w.token, d.rawBody, d.headers)).toMatchObject({ status: 200, stored: 0, duplicates: 1 });
        await w.process();
      } else {
        await ingestPaymentWebhook(w.pdeps(), w.token, d.rawBody, d.headers);
        await expect(w.process({ failpoints: fp })).rejects.toThrow('failpoint');
        await expirePaymentVisibility(w.tenantId);
        const after = await w.process();
        expect(after).toEqual(point === 'after_apply' ? { duplicate: 1 } : { applied: 1 });
      }
      expect(fp.fired).toBe(1);
      expect(await statusOf(inv)).toBe('paid');
      expect(await receiptsOf(w.tenantId)).toHaveLength(1);
      expect((await q<{ status: string }>('select status from public.payment_events where tenant_id = $1', [w.tenantId])).map((x) => x.status)).toEqual(['processed']);
      expect(await w.receipts()).toEqual({ sent: 1 });
      expect(await w.receipts()).toEqual({});
      expect(w.email.calls).toHaveLength(1);
      expect(await integrityOf(w.tenantId)).toEqual([]);
    });
  }

  it('receipt worker dies after claiming the receipt: unknown, never resent (rule 17)', async () => {
    const w = await payWorld();
    await w.manual(0, 125050, 'CR-1');
    const { FailpointCrash, crashAt: workerCrashAt } = await import('./harness.ts');
    void FailpointCrash;
    await expect(w.receipts({ failpoints: workerCrashAt('after_pending_insert') })).rejects.toThrow('failpoint');
    await q(`update pgmq.q_transactional_sends set vt = now() - interval '1 second' where message ->> 'tenant_id' = $1`, [w.tenantId]);
    expect(await w.receipts()).toEqual({ busy: 1 }); // the pending row is fresh: someone may be sending it
    w.clock.advanceMinutes(20);
    await q(`update pgmq.q_transactional_sends set vt = now() - interval '1 second' where message ->> 'tenant_id' = $1`, [w.tenantId]);
    expect(await w.receipts()).toEqual({ unknown: 1 });
    expect(w.email.calls).toEqual([]);
    expect((await outboxOf(w.tenantId)).map((m) => m.send_state)).toEqual(['unknown']);
  });
});

describe('SIGKILL mid-batch (payments)', () => {
  it('200 events incl. duplicates and out-of-order pairs: kill, restart, integrity clean, nothing lost, stuck or doubled', { timeout: 180_000 }, async () => {
    const w = await payWorld({ count: 100, separateCustomers: true });
    const links = [];
    for (let i = 0; i < 100; i++) links.push(await w.link(i));
    // 100 confirmations; 50 of them also polled (a second event for the same money); 50 "processing" events
    // that arrive AFTER their confirmation.
    for (const [i, l] of links.entries()) {
      if (i < 50) {
        const p = w.gw.pay(l.objectId, { async: true });
        w.gw.settle(p, 'succeeded');
      } else w.gw.pay(l.objectId);
    }
    const stored = (await w.deliver({ reverse: true })).reduce((a, r) => a + (r.status === 200 ? r.stored : 0), 0);
    w.clock.advanceMinutes(61);
    const polled = await q(`select 1 from public.payment_requests where tenant_id = $1 and status = 'active'`, [w.tenantId]);
    expect(polled).toHaveLength(100);
    for (const l of links.slice(50)) {
      const [e] = await w.gw.getStatus(l.objectId);
      if (e) await w.pdeps().db.store(w.accountId, 'fake', { ...e, providerEventId: `poll:payment_confirmed:${e.providerRef}` }, null, w.clock.now());
    }
    const queued = await q<{ n: number }>(`select count(*)::int as n from pgmq.q_payment_events where message ->> 'tenant_id' = $1`, [w.tenantId]);
    expect(stored + 50).toBe(200);
    expect(queued[0]?.n).toBe(200);

    const dir = mkdtempSync(path.join(tmpdir(), 'dueloop-paychaos-'));
    const applyLog = path.join(dir, 'applied.log');
    const runner = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'payments-sigkill-runner.ts');
    const env = { ...process.env, TENANT_ID: w.tenantId, NOW_ISO: w.clock.now().toISOString(), APPLY_LOG: applyLog };
    const lines = () => (existsSync(applyLog) ? readFileSync(applyLog, 'utf8').split('\n').filter(Boolean) : []);
    let stderr = '';
    const start = () => {
      const child = spawn(process.execPath, [runner], { env, stdio: ['ignore', 'ignore', 'pipe'] });
      child.stderr.on('data', (b: Buffer) => (stderr += b.toString()));
      return { child, exited: new Promise<number | null>((r) => child.once('exit', (c) => r(c))) };
    };
    const first = start();
    let firstExited = false;
    void first.exited.then(() => (firstExited = true));
    while (lines().length < 30 && !firstExited) await new Promise((r) => setTimeout(r, 20));
    expect(firstExited, stderr).toBe(false);
    first.child.kill('SIGKILL');
    await first.exited;
    const atKill = lines().length;
    const second = start();
    expect(await second.exited, stderr).toBe(0);

    const receipts = await q<{ invoice_id: string; n: number }>(`select invoice_id, count(*)::int as n from public.receipts where tenant_id = $1 group by 1`, [w.tenantId]);
    const events = await q<{ status: string; n: number }>(`select status, count(*)::int as n from public.payment_events where tenant_id = $1 group by 1`, [w.tenantId]);
    const left = await q(`select 1 from pgmq.q_payment_events where message ->> 'tenant_id' = $1`, [w.tenantId]);
    const receiptJobs = await q<{ n: number }>(`select count(*)::int as n from pgmq.q_transactional_sends where message ->> 'tenant_id' = $1`, [w.tenantId]);
    const paid = await q<{ n: number }>(`select count(*)::int as n from public.invoices where tenant_id = $1 and status = 'paid'`, [w.tenantId]);
    console.log(JSON.stringify({ appliedAtKill: atKill, appliedTotal: lines().length, receipts: receipts.length, events, receiptJobs: receiptJobs[0]?.n }));

    expect(receipts).toHaveLength(100);
    expect(receipts.every((r) => r.n === 1)).toBe(true); // no doubled money
    expect(events).toEqual([{ status: 'processed', n: 200 }]); // no lost and no stuck event
    expect(left).toEqual([]);
    expect(receiptJobs[0]?.n).toBe(100); // exactly one receipt job per receipt
    expect(paid[0]?.n).toBe(100);
    expect(await integrityOf(w.tenantId)).toEqual([]);
  });
});
