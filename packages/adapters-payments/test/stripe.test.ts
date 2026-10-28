// Stripe adapter contract, against a fake fetch and fixtures built from the documented object fields (NOT
// recorded from a live account: that is `pnpm smoke:stripe`, env-gated).
import { describe, expect, it } from 'vitest';
import { STRIPE_API_VERSION, StripeGateway, parseStripeEvent, signStripe, stripeAmount, verifyStripeSignature } from '../src/index.ts';

const NOW = new Date('2026-10-28T10:00:00Z');
const clock = { now: () => NOW };
const SECRET = 'whsec_test_fixture';

function fakeFetch(responses: { status: number; body: unknown }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = responses.shift() ?? { status: 200, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { f, calls };
}
const gw = (f: typeof fetch, mode: 'test' | 'live' = 'test', apiKey = 'rk_test_abc') => new StripeGateway({ apiKey, webhookSecret: SECRET, mode, clock, fetch: f });

describe('minor units (docs.stripe.com/currencies)', () => {
  it('same number for ISO-2 and for Stripe zero-decimal ISO-0; refused when the docs disagree or exponents differ', () => {
    expect(stripeAmount(125050, 'GBP')).toBe(125050);
    expect(stripeAmount(1099, 'usd')).toBe(1099);
    expect(stripeAmount(500, 'JPY')).toBe(500);
    expect(stripeAmount(5000, 'KRW')).toBe(5000);
    for (const c of ['ISK', 'UGX', 'KWD', 'BHD', 'JOD', 'OMR', 'TND', 'XXX']) expect(stripeAmount(1000, c), c).toBeNull();
    expect(stripeAmount(1.5, 'GBP')).toBeNull();
  });
});

describe('createPaymentRequest / deactivate', () => {
  it('posts a one-session fixed-amount link with the pinned version, bearer key and idempotency key', async () => {
    const { f, calls } = fakeFetch([{ status: 200, body: { id: 'plink_1', url: 'https://buy.stripe.com/test_x', livemode: false } }]);
    const r = await gw(f).createPaymentRequest({ invoiceId: 'i1', amountMinor: 125050, reference: 'REFABC', currency: 'GBP', idempotencyKey: 'payreq:i1:stripe:125050GBP:g0' });
    expect(r).toEqual({ kind: 'link', url: 'https://buy.stripe.com/test_x', reference: 'REFABC', providerObjectId: 'plink_1', amountMinor: 125050, currency: 'GBP' });
    const c = calls[0];
    expect(c?.url).toBe('https://api.stripe.com/v1/payment_links');
    const h = c?.init.headers as Record<string, string>;
    expect(h).toMatchObject({ Authorization: 'Bearer rk_test_abc', 'Stripe-Version': STRIPE_API_VERSION, 'Idempotency-Key': 'payreq:i1:stripe:125050GBP:g0', 'Content-Type': 'application/x-www-form-urlencoded' });
    const form = new URLSearchParams(String(c?.init.body));
    expect(Object.fromEntries(form)).toEqual({
      'line_items[0][price_data][currency]': 'gbp',
      'line_items[0][price_data][unit_amount]': '125050',
      'line_items[0][price_data][product_data][name]': 'Invoice payment REFABC',
      'line_items[0][quantity]': '1',
      'restrictions[completed_sessions][limit]': '1',
      'metadata[dueloop_reference]': 'REFABC',
    });
    expect(String(c?.init.body)).not.toMatch(/customer|email|name=Ada/i);
  });
  it('refuses unsupported currencies before any call, a wrong-mode response, and errors without echoing bodies', async () => {
    const { f, calls } = fakeFetch([
      { status: 200, body: { id: 'plink_2', url: 'https://buy.stripe.com/x', livemode: true } },
      { status: 400, body: { error: { code: 'parameter_invalid', message: 'echo rk_test_abc REFABC' } } },
    ]);
    await expect(gw(f).createPaymentRequest({ invoiceId: 'i', amountMinor: 1000, reference: 'R', currency: 'KWD' })).rejects.toThrow('not supported');
    expect(calls).toHaveLength(0);
    await expect(gw(f).createPaymentRequest({ invoiceId: 'i', amountMinor: 1000, reference: 'R', currency: 'GBP' })).rejects.toThrow('mode_mismatch');
    const err = await gw(f).createPaymentRequest({ invoiceId: 'i', amountMinor: 1000, reference: 'R', currency: 'GBP' }).catch((e: Error) => e);
    expect(String(err)).toBe('StripeError: stripe 400 parameter_invalid');
  });
  it('a key that does not match the account mode is refused up front', () => {
    const { f } = fakeFetch([]);
    expect(() => gw(f, 'test', 'rk_live_x')).toThrow('mode');
    expect(() => gw(f, 'live', 'sk_test_x')).toThrow('mode');
    expect(() => gw(f, 'test', 'pk_test_x')).toThrow('mode');
  });
  it('deactivate posts active=false', async () => {
    const { f, calls } = fakeFetch([{ status: 200, body: { id: 'plink_1', active: false, livemode: false } }]);
    await gw(f).deactivate('plink_1');
    expect(calls[0]?.url).toBe('https://api.stripe.com/v1/payment_links/plink_1');
    expect(String(calls[0]?.init.body)).toBe('active=false');
  });
});

const session = (over: Record<string, unknown> = {}) => ({
  id: 'evt_1',
  type: 'checkout.session.completed',
  created: Math.floor(NOW.getTime() / 1000),
  livemode: false,
  data: { object: { id: 'cs_1', object: 'checkout.session', payment_link: 'plink_1', payment_intent: 'pi_1', payment_status: 'paid', amount_total: 125050, currency: 'gbp', metadata: { tenant_id: 'evil' }, ...over } },
});

describe('webhooks (docs.stripe.com/webhooks/signatures)', () => {
  it('verifies v1 over the raw body, accepts any of several v1 (secret rolling), ignores v0, rejects tampering and staleness', () => {
    const body = JSON.stringify(session());
    const h = signStripe(body, SECRET, NOW);
    expect(() => verifyStripeSignature(body, h, SECRET, NOW)).not.toThrow();
    expect(() => verifyStripeSignature(body, `${signStripe(body, 'old', NOW)},${h.split(',')[1]}`, SECRET, NOW)).not.toThrow();
    const v0only = h.replace('v1=', 'v0=');
    expect(() => verifyStripeSignature(body, v0only, SECRET, NOW)).toThrow('malformed_signature');
    expect(() => verifyStripeSignature(body.replace('125050', '1'), h, SECRET, NOW)).toThrow('bad_signature');
    expect(() => verifyStripeSignature(body, h, 'other', NOW)).toThrow('bad_signature');
    expect(() => verifyStripeSignature(body, h, SECRET, new Date(NOW.getTime() + 301_000))).toThrow('stale_signature');
    expect(() => verifyStripeSignature(body, undefined, SECRET, NOW)).toThrow('missing_signature');
    expect(() => verifyStripeSignature(body, h, '', NOW)).toThrow('missing_signature');
  });

  it('translates only definitive outcomes; metadata is ignored; unknown types yield nothing', async () => {
    const one = (o: Record<string, unknown>) => parseStripeEvent(JSON.stringify(o));
    expect(one(session())).toEqual([{ type: 'payment_confirmed', providerEventId: 'evt_1', livemode: false, requestRef: 'plink_1', providerRef: 'pi_1', amountMinor: 125050, currency: 'GBP', paidAt: new Date(Math.floor(NOW.getTime() / 1000) * 1000) }]);
    expect(one(session({ payment_status: 'unpaid' }))[0]?.type).toBe('payment_processing');
    expect(one({ ...session(), type: 'checkout.session.async_payment_succeeded' })[0]?.type).toBe('payment_confirmed');
    expect(one({ ...session(), type: 'checkout.session.async_payment_failed' })[0]?.type).toBe('payment_failed');
    expect(one(session({ payment_link: null }))).toEqual([]); // not our link
    expect(one(session({ currency: 'kwd' }))[0]).toMatchObject({ amountMinor: -1 }); // never money
    expect(one({ id: 'evt_r', type: 'charge.refunded', created: 1, livemode: false, data: { object: { payment_intent: 'pi_1', amount_refunded: 5000, currency: 'gbp' } } })).toEqual([
      { type: 'payment_reversed', providerEventId: 'evt_r', livemode: false, reversal: 'refund', providerRef: 'pi_1', amountMinor: 5000, currency: 'GBP', at: new Date(1000) },
    ]);
    expect(one({ id: 'evt_d', type: 'charge.dispute.created', created: 1, livemode: false, data: { object: { payment_intent: 'pi_1', amount: 125050, currency: 'gbp' } } })[0]).toMatchObject({ reversal: 'chargeback' });
    expect(one({ id: 'e', type: 'customer.updated', created: 1, data: { object: {} } })).toEqual([]);
    const body = JSON.stringify(session());
    const { f } = fakeFetch([]);
    expect(await gw(f).handleWebhook(body, { 'stripe-signature': signStripe(body, SECRET, NOW) })).toHaveLength(1);
    await expect(gw(f).handleWebhook(body, { 'stripe-signature': signStripe(body, 'x', NOW) })).rejects.toThrow('bad_signature');
  });

  it('getStatus lists completed sessions of the link and returns paid ones only', async () => {
    const { f, calls } = fakeFetch([{ status: 200, body: { object: 'list', data: [session().data.object, { ...session().data.object, id: 'cs_2', payment_status: 'unpaid' }] } }]);
    const r = await gw(f).getStatus('plink_1');
    expect(calls[0]?.url).toBe('https://api.stripe.com/v1/checkout/sessions?payment_link=plink_1&status=complete&limit=10');
    expect(calls[0]?.init.method).toBe('GET');
    expect(r.map((e) => e.type)).toEqual(['payment_confirmed']);
  });
});
