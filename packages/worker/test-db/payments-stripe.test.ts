// Stripe through the real composition path: secrets in Vault -> accountProviders -> StripeGateway -> signed
// fixture events (built from the documented fields) -> ingest -> pipeline. No network: links are seeded rows.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { signStripe } from '@dueloop/adapters-payments';
import { accountProviders, ingestPaymentWebhook, processPaymentBatch, type PaymentsDeps } from '@dueloop/payments';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { pool, q, quietCron, world } from './harness.ts';
import { balanceOf, paymentsDb, statusOf, tasksOf } from './payments-harness.ts';
import { createJsonLogger } from '../src/logger.ts';
import { DEFAULT_PAYMENTS_CONFIG, NO_PAYMENT_FAILPOINTS } from '@dueloop/payments';

beforeAll(quietCron);
afterAll(() => pool.end());

it('checkout.session.completed for our link => paid; charge.refunded => urgent reversal task; wrong secret => 401', async () => {
  const w = await world();
  const inv = w.invoiceIds[0] ?? '';
  const accountId = randomUUID();
  const token = randomBytes(32).toString('base64url');
  const secret = `whsec_${randomBytes(12).toString('hex')}`;
  await q(`insert into public.payment_accounts (id, tenant_id, provider, mode, webhook_token_hash) values ($1, $2, 'stripe', 'test', $3)`, [accountId, w.tenantId, createHash('sha256').update(token).digest('hex')]);
  await q(`select private.set_payment_secret($1, 'api_key', 'rk_test_fixture_not_a_real_key')`, [accountId]);
  await q(`select private.set_payment_secret($1, 'webhook_secret', $2)`, [accountId, secret]);
  const link = `plink_${randomBytes(6).toString('hex')}`;
  await q(
    `insert into public.payment_requests (tenant_id, invoice_id, payment_account_id, provider, provider_object_id, url, amount, currency, idempotency_key, created_at)
     values ($1, $2, $3, 'stripe', $4, 'https://buy.stripe.com/test_fixture', 125050, 'GBP', $5, now())`,
    [w.tenantId, inv, accountId, link, `seed-${link}`],
  );
  const deps: PaymentsDeps = {
    db: paymentsDb,
    clock: w.clock,
    logger: createJsonLogger((l) => w.logs.push(l), () => w.clock.now().toISOString()),
    notifier: w.notifier,
    providers: accountProviders({}, paymentsDb, w.clock),
    failpoints: NO_PAYMENT_FAILPOINTS,
    config: { ...DEFAULT_PAYMENTS_CONFIG, retryBaseSeconds: 0 },
  };
  const created = Math.floor(w.clock.now().getTime() / 1000);
  const paid = JSON.stringify({ id: `evt_${randomUUID()}`, type: 'checkout.session.completed', created, livemode: false, data: { object: { id: 'cs_1', payment_link: link, payment_intent: 'pi_fix_1', payment_status: 'paid', amount_total: 125050, currency: 'gbp', metadata: { invoice_id: randomUUID() } } } });
  expect(await ingestPaymentWebhook(deps, token, paid, { 'stripe-signature': signStripe(paid, 'whsec_wrong', w.clock.now()) })).toEqual({ status: 401, reason: 'signature' });
  expect(await ingestPaymentWebhook(deps, token, paid, { 'stripe-signature': signStripe(paid, secret, w.clock.now()) })).toMatchObject({ status: 200, stored: 1 });
  expect((await processPaymentBatch(deps, { limit: 10, filter: { tenant_id: w.tenantId } })).outcomes).toEqual({ applied: 1 });
  expect(await statusOf(inv)).toBe('paid');
  expect(await balanceOf(inv)).toBe(0);
  expect((await q<{ method: string; provider_ref: string }>('select method, provider_ref from public.receipts where tenant_id = $1', [w.tenantId]))[0]).toEqual({ method: 'stripe', provider_ref: 'pi_fix_1' });

  const refund = JSON.stringify({ id: `evt_${randomUUID()}`, type: 'charge.refunded', created, livemode: false, data: { object: { payment_intent: 'pi_fix_1', amount_refunded: 125050, currency: 'gbp' } } });
  await ingestPaymentWebhook(deps, token, refund, { 'stripe-signature': signStripe(refund, secret, w.clock.now()) });
  expect((await processPaymentBatch(deps, { limit: 10, filter: { tenant_id: w.tenantId } })).outcomes).toEqual({ reversal_recorded: 1 });
  expect((await tasksOf(w.tenantId)).filter((t) => t.type === 'payment_reversal').map((t) => [t.urgent, t.invoice_id])).toEqual([[true, inv]]);
  expect(await statusOf(inv)).toBe('paid');
  // Nothing secret or payer-related reached the logs.
  expect(w.logs.join('\n')).not.toMatch(/rk_test|whsec_|pi_fix_1|cs_1/);
});
