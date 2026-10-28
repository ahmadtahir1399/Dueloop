// pnpm smoke:stripe: one round trip against a Stripe SANDBOX (test mode) account. Never runs in CI.
// Gated: does nothing unless STRIPE_SMOKE=1 and STRIPE_TEST_API_KEY is a test key (rk_test_ / sk_test_); a live
// key is refused. The key comes from the environment only and is never printed (rule 19).
// It creates a 1.00 GBP payment link (twice, with the same idempotency key: one link), lists its completed
// sessions (none), and deactivates it. It pays nothing and needs no webhook endpoint.
import { randomUUID } from 'node:crypto';
import { StripeGateway } from '../src/index.ts';

const env = process.env;
if (env.STRIPE_SMOKE !== '1') {
  console.log('smoke:stripe skipped: NOT VERIFIED (set STRIPE_SMOKE=1 and STRIPE_TEST_API_KEY to a sandbox restricted key).');
  process.exit(0);
}
const apiKey = env.STRIPE_TEST_API_KEY ?? '';
if (!/^(rk|sk)_test_/.test(apiKey)) {
  console.error('smoke:stripe: STRIPE_TEST_API_KEY must be a TEST key (rk_test_ or sk_test_); live keys are refused');
  process.exit(2);
}
const gw = new StripeGateway({ apiKey, webhookSecret: 'unused-by-this-smoke', mode: 'test', clock: { now: () => new Date() } });
const key = `dueloop-smoke-${randomUUID()}`;
try {
  const a = await gw.createPaymentRequest({ invoiceId: 'smoke', amountMinor: 100, currency: 'GBP', reference: 'SMOKE', idempotencyKey: key });
  const b = await gw.createPaymentRequest({ invoiceId: 'smoke', amountMinor: 100, currency: 'GBP', reference: 'SMOKE', idempotencyKey: key });
  const sessions = await gw.getStatus(a.providerObjectId ?? '');
  await gw.deactivate(a.providerObjectId ?? '');
  const ok = a.providerObjectId === b.providerObjectId && sessions.length === 0 && (a.url ?? '').startsWith('https://');
  console.log(JSON.stringify({ result: ok ? 'ok' : 'unexpected', sameLinkOnRetry: a.providerObjectId === b.providerObjectId, paidSessions: sessions.length, deactivated: true }));
  process.exitCode = ok ? 0 : 1;
} catch (e) {
  console.error(`smoke:stripe failed: ${e instanceof Error ? e.message : 'error'}`); // StripeError carries status + code only
  process.exitCode = 1;
}
