// Stripe, on the client's OWN account (guide Part 6), via the REST API with form-encoded bodies, as the docs
// show it (no SDK). Sources, fetched 2026-10-28 (ADR 0037):
//   docs.stripe.com/api/payment-link/create, /update, /object  (line_items price_data, restrictions, active)
//   docs.stripe.com/api/checkout/sessions/object, /list         (payment_link, payment_status, payment_intent)
//   docs.stripe.com/api/events/types                           (checkout.session.*, charge.refunded, charge.dispute.created)
//   docs.stripe.com/webhooks/signatures                        (Stripe-Signature t=,v1=; HMAC-SHA256 of "t.body"; v1 only)
//   docs.stripe.com/api/idempotent_requests, /api/versioning, /currencies
// Nothing here logs; no card data ever passes through (Stripe hosts the payment page).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { currencyExponent, type PaymentEvent, type PaymentRequest } from '@dueloop/core';
import type { Clock, PaymentGateway } from './fake-gateway.ts';

/** Pinned on every request (Stripe-Version). Webhook endpoints must be created with the same version. */
export const STRIPE_API_VERSION = '2026-09-30.endive';
export const STRIPE_SIGNATURE_HEADER = 'stripe-signature';
const TOLERANCE_SECONDS = 300; // the documented library default; never 0

// docs.stripe.com/currencies: "zero-decimal currencies" with general API support.
const STRIPE_ZERO_DECIMAL = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
// The same page lists ISK and UGX as "special cases" sent as two-decimal values ending in 00, which contradicts
// UGX being in the zero-decimal list. We do not guess: no Stripe links in these (bank text instead).
const STRIPE_REFUSED = new Set(['ISK', 'UGX']);

/**
 * Our minor units -> Stripe's `amount`, or null when we will not use Stripe for this currency. Supported:
 * ISO exponent 0 and in Stripe's zero-decimal list (same number), or ISO exponent 2 and NOT in that list (same
 * number). Everything else (three-decimal currencies, the contradictory special cases, any mismatch between
 * ISO and Stripe) is refused, so an amount can never be off by a factor of 10 or 100.
 */
export function stripeAmount(minor: number, currency: string): number | null {
  const c = currency.toUpperCase();
  const exp = currencyExponent(c);
  if (!exp.ok || STRIPE_REFUSED.has(c) || !Number.isSafeInteger(minor)) return null;
  if (exp.value === 0 && STRIPE_ZERO_DECIMAL.has(c)) return minor;
  if (exp.value === 2 && !STRIPE_ZERO_DECIMAL.has(c)) return minor;
  return null;
}
/** Stripe `amount` -> our minor units (the same mapping, inverted; null = unsupported). */
export const fromStripeAmount = (amount: number, currency: string): number | null => stripeAmount(amount, currency);

export class StripeSignatureError extends Error {
  constructor(code: string) {
    super(code);
    this.name = 'StripeSignatureError';
  }
}

/** docs.stripe.com/webhooks/signatures steps 1-4: t and every v1 (other schemes ignored), HMAC, constant time, tolerance. */
export function verifyStripeSignature(rawBody: string, header: string | undefined, secret: string, now: Date, toleranceSeconds = TOLERANCE_SECONDS): void {
  if (!header || !secret) throw new StripeSignatureError('missing_signature');
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't' && /^\d{1,12}$/.test(v)) t = Number(v);
    else if (k === 'v1' && /^[0-9a-f]{64}$/.test(v)) v1.push(v);
  }
  if (t === null || v1.length === 0) throw new StripeSignatureError('malformed_signature');
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`, 'utf8').digest();
  if (!v1.some((s) => timingSafeEqual(expected, Buffer.from(s, 'hex')))) throw new StripeSignatureError('bad_signature');
  if (Math.abs(now.getTime() / 1000 - t) > toleranceSeconds) throw new StripeSignatureError('stale_signature');
}

/** For tests and fixtures only: the header Stripe would send for this body. */
export function signStripe(rawBody: string, secret: string, at: Date): string {
  const t = Math.floor(at.getTime() / 1000);
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${rawBody}`, 'utf8').digest('hex')}`;
}

type Obj = Record<string, unknown>;
const str = (o: Obj, k: string): string | null => (typeof o[k] === 'string' ? (o[k] as string) : null);
const int = (o: Obj, k: string): number | null => (Number.isSafeInteger(o[k]) ? (o[k] as number) : null);

/** Translate a VERIFIED Stripe event. Types we do not act on yield nothing (acknowledged, never stored). */
export function parseStripeEvent(rawBody: string): PaymentEvent[] {
  const e = JSON.parse(rawBody) as Obj;
  const id = str(e, 'id');
  const type = str(e, 'type');
  const created = int(e, 'created');
  const obj = ((e.data as Obj | undefined)?.object ?? null) as Obj | null;
  if (!id || !type || created === null || !obj) return [];
  const ids = { providerEventId: id, livemode: e.livemode === true };
  const at = new Date(created * 1000);
  const currency = (str(obj, 'currency') ?? '').toUpperCase();
  const amount = (k: string) => {
    const a = int(obj, k);
    return a === null ? -1 : (fromStripeAmount(a, currency) ?? -1); // -1 => the pipeline sees a mismatch, never money
  };
  switch (type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
    case 'checkout.session.async_payment_failed': {
      const link = str(obj, 'payment_link');
      if (!link) return []; // not one of OUR payment links
      const ref = str(obj, 'payment_intent') ?? str(obj, 'id') ?? id;
      const base = { ...ids, requestRef: link, providerRef: ref };
      if (type === 'checkout.session.async_payment_failed') return [{ type: 'payment_failed', ...base, reason: 'async_payment_failed' }];
      // Definitive success only: payment_status 'paid'. 'unpaid' on completion = an async method still processing.
      if (str(obj, 'payment_status') !== 'paid') return [{ type: 'payment_processing', ...base }];
      return [{ type: 'payment_confirmed', ...base, amountMinor: amount('amount_total'), currency, paidAt: at }];
    }
    case 'charge.refunded': {
      const pi = str(obj, 'payment_intent');
      return pi ? [{ type: 'payment_reversed', ...ids, reversal: 'refund', providerRef: pi, amountMinor: amount('amount_refunded'), currency, at }] : [];
    }
    case 'charge.dispute.created': {
      const pi = str(obj, 'payment_intent');
      return pi ? [{ type: 'payment_reversed', ...ids, reversal: 'chargeback', providerRef: pi, amountMinor: amount('amount'), currency, at }] : [];
    }
    default:
      return [];
  }
}

export interface StripeOptions {
  readonly apiKey: string;
  readonly webhookSecret: string;
  readonly mode: 'test' | 'live';
  readonly clock: Clock;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly baseUrl?: string;
}

export class StripeError extends Error {
  readonly status: number;
  constructor(status: number, code: string) {
    super(`stripe ${status} ${code}`); // the code only: never the response body (it can echo our input)
    this.name = 'StripeError';
    this.status = status;
  }
}

export class StripeGateway implements PaymentGateway {
  readonly name = 'stripe';
  private readonly o: StripeOptions;
  constructor(o: StripeOptions) {
    // A live key on a test account (or the reverse) is refused before any call (issue O).
    const live = /^(rk|sk)_live_/.test(o.apiKey);
    const test = /^(rk|sk)_test_/.test(o.apiKey);
    if ((o.mode === 'live' && !live) || (o.mode === 'test' && !test)) throw new Error('stripe key does not match the account mode');
    this.o = o;
  }

  supportsCurrency(currency: string): boolean {
    return stripeAmount(1, currency) !== null;
  }

  private async call(method: 'GET' | 'POST', path: string, form: [string, string][], idempotencyKey?: string): Promise<Obj> {
    const body = new URLSearchParams(form).toString();
    const url = `${this.o.baseUrl ?? 'https://api.stripe.com'}${path}${method === 'GET' && body ? `?${body}` : ''}`;
    const headers: Record<string, string> = { Authorization: `Bearer ${this.o.apiKey}`, 'Stripe-Version': STRIPE_API_VERSION };
    if (method === 'POST') headers['Content-Type'] = 'application/x-www-form-urlencoded';
    if (method === 'POST' && idempotencyKey) headers['Idempotency-Key'] = idempotencyKey.slice(0, 255);
    const r = await (this.o.fetch ?? fetch)(url, { method, headers, ...(method === 'POST' ? { body } : {}), signal: AbortSignal.timeout(this.o.timeoutMs ?? 15_000) });
    const json = (await r.json().catch(() => ({}))) as Obj;
    if (!r.ok) throw new StripeError(r.status, String(((json.error as Obj | undefined)?.code as string | undefined) ?? 'error'));
    if (typeof json.livemode === 'boolean' && json.livemode !== (this.o.mode === 'live')) throw new StripeError(r.status, 'mode_mismatch');
    return json;
  }

  async createPaymentRequest(args: { invoiceId: string; amountMinor: number; reference: string; currency?: string; expiresAt?: Date; idempotencyKey?: string }): Promise<PaymentRequest> {
    const currency = (args.currency ?? '').toUpperCase();
    const amount = stripeAmount(args.amountMinor, currency);
    if (amount === null || amount <= 0) throw new Error('currency not supported for stripe links');
    // One fixed amount, one completed session, no customer data: the reference code is the only label.
    const link = await this.call(
      'POST',
      '/v1/payment_links',
      [
        ['line_items[0][price_data][currency]', currency.toLowerCase()],
        ['line_items[0][price_data][unit_amount]', String(amount)],
        ['line_items[0][price_data][product_data][name]', `Invoice payment ${args.reference}`],
        ['line_items[0][quantity]', '1'],
        ['restrictions[completed_sessions][limit]', '1'],
        ['metadata[dueloop_reference]', args.reference],
      ],
      args.idempotencyKey,
    );
    const id = str(link, 'id');
    const url = str(link, 'url');
    if (!id || !url) throw new StripeError(200, 'unexpected_response');
    return { kind: 'link', url, reference: args.reference, providerObjectId: id, amountMinor: args.amountMinor, currency };
  }

  async deactivate(providerObjectId: string): Promise<void> {
    await this.call('POST', `/v1/payment_links/${encodeURIComponent(providerObjectId)}`, [['active', 'false']], `dueloop-deactivate-${providerObjectId}`);
  }

  async handleWebhook(rawBody: string, headers: Readonly<Record<string, string>>): Promise<PaymentEvent[]> {
    verifyStripeSignature(rawBody, headers[STRIPE_SIGNATURE_HEADER], this.o.webhookSecret, this.o.clock.now());
    return parseStripeEvent(rawBody);
  }

  /** Polling fallback: completed Checkout Sessions of this link, paid ones only, as confirmations. */
  async getStatus(providerObjectId: string): Promise<PaymentEvent[]> {
    const r = await this.call('GET', '/v1/checkout/sessions', [
      ['payment_link', providerObjectId],
      ['status', 'complete'],
      ['limit', '10'],
    ]);
    const out: PaymentEvent[] = [];
    for (const s of (Array.isArray(r.data) ? r.data : []) as Obj[]) {
      if (str(s, 'payment_status') !== 'paid') continue;
      const currency = (str(s, 'currency') ?? '').toUpperCase();
      const a = int(s, 'amount_total');
      const created = int(s, 'created');
      out.push({
        type: 'payment_confirmed',
        providerRef: str(s, 'payment_intent') ?? str(s, 'id') ?? '',
        amountMinor: a === null ? -1 : (fromStripeAmount(a, currency) ?? -1),
        currency,
        paidAt: new Date((created ?? 0) * 1000),
        requestRef: providerObjectId,
        livemode: s.livemode === true,
      });
    }
    return out;
  }
}
