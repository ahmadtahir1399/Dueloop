// Prompt 5 step 9: payment webhook abuse through the REAL HTTP route and store, plus hostile manual input.
// Every rejected request leaves no stored event and no ledger change; accepted hostile content changes only
// what the plan allows (here: nothing, or an urgent task in the sender's own tenant).
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { signFake, FAKE_SIGNATURE_HEADER } from '@dueloop/adapters-payments';
import { confirmByHuman, ingestPaymentWebhook, planManualPayment } from '@dueloop/payments';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool, q, quietCron } from '../../worker/test-db/harness.ts';
import { balanceOf, payWorld, statusOf, type PayWorld } from '../../worker/test-db/payments-harness.ts';
import { DEFAULT_WEBHOOK_CONFIG, createWebhookServer, pgWebhookStore } from '../src/index.ts';

let X: PayWorld;
let Y: PayWorld;
let base = '';
const worlds = new Map<string, PayWorld>();
const server = createWebhookServer({
  store: pgWebhookStore(pool),
  config: { ...DEFAULT_WEBHOOK_CONFIG, appSecret: '', verifyToken: '', maxBodyBytes: 16 * 1024, rateBurst: 1000 },
  now: () => new Date(),
  log: () => undefined,
  // Each world's deps (its gateway on its own test clock); the token decides which account is looked up.
  payments: async (token, raw, headers) => {
    for (const w of worlds.values()) if (w.token === token) return ingestPaymentWebhook(w.pdeps(), token, raw, headers);
    return ingestPaymentWebhook(X.pdeps(), token, raw, headers); // unknown token: same lookup, finds nothing
  },
});

beforeAll(async () => {
  await quietCron();
  X = await payWorld();
  Y = await payWorld();
  worlds.set('X', X);
  worlds.set('Y', Y);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await pool.end();
});

const snapshot = async () =>
  JSON.stringify(
    await q(
      `select (select count(*) from public.payment_events where tenant_id in ($1, $2)) as events,
              (select count(*) from public.receipts where tenant_id in ($1, $2)) as receipts,
              (select count(*) from public.payments where tenant_id in ($1, $2)) as payments,
              (select count(*) from public.credits where tenant_id in ($1, $2)) as credits,
              (select string_agg(status, ',' order by id) from public.invoices where tenant_id in ($1, $2)) as statuses`,
      [X.tenantId, Y.tenantId],
    ),
  );
const post = async (token: string, body: string, headers: Record<string, string>) => {
  const r = await fetch(`${base}/webhooks/payments/${token}`, { method: 'POST', body, headers });
  const text = await r.text();
  expect(text).not.toMatch(/Error|\bat .+\(|stack|node:|whsec|plink/); // fixed short strings, no echo
  expect(text.length).toBeLessThan(40);
  return r.status;
};
const body = (w: PayWorld, data: Record<string, unknown>, o: { livemode?: boolean; type?: string } = {}) =>
  JSON.stringify({ id: `fevt_adv_${randomUUID()}`, type: o.type ?? 'link.paid', created: Math.floor(w.clock.now().getTime() / 1000), livemode: o.livemode ?? false, data });
const signed = (w: PayWorld, b: string, secret = w.secret, at = w.clock.now()) => ({ 'Content-Type': 'application/json', [FAKE_SIGNATURE_HEADER]: signFake(secret, b, at) });

describe('payment webhook abuse (real route)', () => {
  it('control: a correctly signed delivery for our own link is stored (200)', async () => {
    const l = await X.link();
    const b = body(X, { link: l.objectId, payment: `fpay_ctl_${randomUUID()}`, amount: l.amount, currency: 'GBP' });
    expect(await post(X.token, b, signed(X, b))).toBe(200);
    expect(await X.process()).toEqual({ applied: 1 });
    expect(await statusOf(X.invoiceIds[0] ?? '')).toBe('paid');
  });

  it('forged, stale, cross-account, edited, unknown token, mode, size and type abuse: rejected, nothing stored', async () => {
    const l = await Y.link();
    const good = body(Y, { link: l.objectId, payment: 'fpay_evil', amount: l.amount, currency: 'GBP' });
    const before = await snapshot();
    const cases: [string, () => Promise<number>, number][] = [
      ['forged signature (attacker secret)', () => post(Y.token, good, signed(Y, good, 'whsec_attacker')), 401],
      ['no signature', () => post(Y.token, good, { 'Content-Type': 'application/json' }), 401],
      ['malformed signature', () => post(Y.token, good, { 'Content-Type': 'application/json', [FAKE_SIGNATURE_HEADER]: 't=1,v1=zz' }), 401],
      ['stale timestamp replay (10 min old)', () => post(Y.token, good, signed(Y, good, Y.secret, new Date(Y.clock.now().getTime() - 600_000))), 401],
      ['valid signature for account X sent to account Y', () => post(Y.token, good, signed(X, good, X.secret)), 401],
      ['amount edited after signing', async () => post(Y.token, good.replace(`"amount":${l.amount}`, '"amount":1'), signed(Y, good)), 401],
      ['unknown token', () => post('A'.repeat(43), good, signed(Y, good)), 404],
      ['token too short to be ours', () => post('abc', good, signed(Y, good)), 404],
      ['mode mismatch (live event to a test account)', async () => {
        const live = body(Y, { link: l.objectId, payment: 'fpay_live', amount: l.amount, currency: 'GBP' }, { livemode: true });
        return post(Y.token, live, signed(Y, live));
      }, 400],
      ['oversize body', async () => {
        const big = body(Y, { link: l.objectId, pad: 'x'.repeat(20_000) });
        return post(Y.token, big, signed(Y, big));
      }, 413],
      ['wrong content type', () => post(Y.token, good, { ...signed(Y, good), 'Content-Type': 'text/plain' }), 415],
    ];
    for (const [name, run, status] of cases) expect(await run(), name).toBe(status);
    const get = await fetch(`${base}/webhooks/payments/${Y.token}`);
    expect(get.status).toBe(405);
    expect(await snapshot()).toBe(before);
  });

  it("hostile metadata: X signs an event pointing at Y's link and claiming Y's tenant/invoice -> unmatched in X, Y untouched", async () => {
    const ly = await Y.link();
    const yInvoice = Y.invoiceIds[0] ?? '';
    const yBalance = await balanceOf(yInvoice);
    const hostile = body(X, { link: ly.objectId, payment: 'fpay_hostile', amount: ly.amount, currency: 'GBP', tenant_id: Y.tenantId, invoice_id: yInvoice, metadata: { tenant_id: Y.tenantId, invoice_id: yInvoice } });
    expect(await post(X.token, hostile, signed(X, hostile))).toBe(200); // signed by X: stored in X's tenant only
    expect(await X.process()).toEqual({ unmatched: 1 });
    expect(await Y.process()).toEqual({});
    expect(await balanceOf(yInvoice)).toBe(yBalance);
    expect(await q('select 1 from public.receipts where tenant_id = $1', [Y.tenantId])).toEqual([]);
    expect((await q<{ type: string }>(`select type from public.tasks where tenant_id = $1 and type = 'unmatched_payment'`, [X.tenantId])).length).toBe(1);
  });
});

describe('hostile manual input', () => {
  it('a collector cannot confirm money, even calling the pipeline directly (DB re-checks the role)', async () => {
    const w = await payWorld();
    const collector = randomUUID();
    await q(`insert into auth.users (id, email) values ($1, $2)`, [collector, `col-${collector.slice(0, 8)}@test-co.example`]);
    await q(`insert into public.memberships (tenant_id, user_id, role) values ($1, $2, 'collector')`, [w.tenantId, collector]);
    const p = await planManualPayment(w.pdeps(), { tenantId: w.tenantId, invoice: 'T-1', amount: '10', date: '2026-06-10', bankRef: 'COL-1', user: collector });
    expect(p.ok).toBe(false);
    await expect(
      confirmByHuman(w.pdeps(), { tenantId: w.tenantId, invoiceId: w.invoiceIds[0] ?? '', amountMinor: 1000, currency: 'GBP', paidAt: w.clock.now(), bankRef: 'COL-2', userId: collector, source: 'manual', proofId: null, note: null }),
    ).rejects.toMatchObject({ code: '42501' });
    // A user from ANOTHER tenant is not a member here at all.
    await expect(
      confirmByHuman(w.pdeps(), { tenantId: w.tenantId, invoiceId: w.invoiceIds[0] ?? '', amountMinor: 1000, currency: 'GBP', paidAt: w.clock.now(), bankRef: 'COL-3', userId: X.ownerId, source: 'manual', proofId: null, note: null }),
    ).rejects.toMatchObject({ code: '42501' });
    expect(await q('select 1 from public.receipts where tenant_id = $1', [w.tenantId])).toEqual([]);
  });

  it('negative, zero, huge and float-ish amounts never reach the ledger; a bank ref is never reused across invoices', async () => {
    const w = await payWorld({ count: 2 });
    for (const amount of ['-100', '0', '0.00', '1e5', '99999999999999999999', 'NaN', '1/2', '12.345'])
      expect((await planManualPayment(w.pdeps(), { tenantId: w.tenantId, invoice: 'T-1', amount, date: '2026-06-10', bankRef: 'H-1', user: w.ownerId })).ok, amount).toBe(false);
    await expect(
      confirmByHuman(w.pdeps(), { tenantId: w.tenantId, invoiceId: w.invoiceIds[0] ?? '', amountMinor: -5, currency: 'GBP', paidAt: w.clock.now(), bankRef: 'H-2', userId: w.ownerId, source: 'manual', proofId: null, note: null }),
    ).rejects.toThrow();
    await w.manual(0, 1000, 'SHARED-REF');
    const reuse = await planManualPayment(w.pdeps(), { tenantId: w.tenantId, invoice: 'T-2', amount: '10', date: '2026-06-10', bankRef: 'SHARED-REF', user: w.ownerId });
    expect(reuse).toEqual({ ok: false, refusal: 'this bank reference is already recorded for another invoice' });
    expect(await w.manual(1, 1000, 'SHARED-REF')).toMatchObject({ outcome: 'duplicate' }); // and the DB key holds even if code is bypassed
    expect(await balanceOf(w.invoiceIds[1] ?? '')).toBe(125050);
  });
});
