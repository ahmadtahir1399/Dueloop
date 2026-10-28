// A deterministic fake payment provider for tests, chaos and the demo: hosted "links", signed webhook
// deliveries (HMAC-SHA256 over `${t}.${rawBody}`, checked over the RAW body before parsing), controllable
// delays, duplicates, reordering and failures. It never touches card data: a "payment" is just a call.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PaymentEvent, PaymentProvider, PaymentRequest } from '@dueloop/core';

export interface Clock {
  now(): Date;
}

/** The core port plus switching a hosted object off (issue F); structurally what @dueloop/payments expects. */
export interface PaymentGateway extends PaymentProvider {
  deactivate?(providerObjectId: string): Promise<void>;
}

export const FAKE_SIGNATURE_HEADER = 'fake-signature';
const TOLERANCE_SECONDS = 300;

export interface FakeDelivery {
  readonly rawBody: string;
  readonly headers: Readonly<Record<string, string>>;
  /** Delivered no earlier than this (controllable delay). */
  readonly notBefore: Date;
}

type FakeKind = 'link.paid' | 'link.processing' | 'link.failed' | 'payment.refunded' | 'payment.disputed';

interface FakeLink {
  readonly id: string;
  readonly amount: number;
  readonly currency: string;
  readonly reference: string;
  active: boolean;
  paidBy: string | null;
  paidAt: Date | null;
}

export class SignatureError extends Error {
  constructor(code: string) {
    super(code);
    this.name = 'SignatureError';
  }
}

export function signFake(secret: string, rawBody: string, at: Date): string {
  const t = Math.floor(at.getTime() / 1000);
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')}`;
}

/** Verify a fake-signature header over the raw body. Throws SignatureError; never parses before success. */
export function verifyFake(secret: string, rawBody: string, header: string | undefined, now: Date): void {
  if (!header) throw new SignatureError('missing_signature');
  const parts = new Map(header.split(',').map((p) => p.split('=', 2) as [string, string]));
  const t = Number(parts.get('t'));
  const v1 = parts.get('v1') ?? '';
  if (!Number.isInteger(t) || !/^[0-9a-f]{64}$/.test(v1)) throw new SignatureError('malformed_signature');
  if (Math.abs(now.getTime() / 1000 - t) > TOLERANCE_SECONDS) throw new SignatureError('stale_signature');
  const want = Buffer.from(createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex'), 'hex');
  if (!timingSafeEqual(want, Buffer.from(v1, 'hex'))) throw new SignatureError('bad_signature');
}

export class FakeGateway implements PaymentGateway {
  readonly name = 'fake';
  readonly livemode: boolean;
  private readonly secret: string;
  private readonly clock: Clock;
  private readonly links = new Map<string, FakeLink>();
  private readonly byKey = new Map<string, string>();
  private seq = 0;
  /** Provider ids are global (one provider object = one of OUR rows), so every gateway instance gets its own. */
  private readonly prefix: string;
  private failCreates = 0;
  private failStatus = 0;
  /** Deliveries not yet handed out. Tests drain them in whatever order and multiplicity they want. */
  readonly outbox: FakeDelivery[] = [];
  /** Every createPaymentRequest call that reached the provider (idempotent retries included). */
  readonly createCalls: string[] = [];

  constructor(opts: { secret: string; clock: Clock; livemode?: boolean; idPrefix?: string }) {
    this.prefix = opts.idPrefix ?? `${randomBytes(4).toString('hex')}_`;
    this.secret = opts.secret;
    this.clock = opts.clock;
    this.livemode = opts.livemode ?? false;
  }

  // ---- controls ---------------------------------------------------------------------------------------
  failNextCreates(n: number): void {
    this.failCreates = n;
  }
  failNextStatus(n: number): void {
    this.failStatus = n;
  }
  link(id: string): Readonly<FakeLink> | undefined {
    return this.links.get(id);
  }
  activeLinks(): string[] {
    return [...this.links.values()].filter((l) => l.active).map((l) => l.id);
  }

  /**
   * The payer pays a link. `race: true` pays even an inactive link (the provider-side switch-off lags our rows).
   * `async: true` emits processing now and the confirmation (or failure) only when `settle` is called.
   */
  pay(linkId: string, o: { amount?: number; currency?: string; delaySeconds?: number; async?: boolean; race?: boolean } = {}): string {
    const l = this.links.get(linkId);
    if (!l) throw new Error('fake: no such link');
    if (!l.active && !o.race) throw new Error('fake: link inactive');
    const paymentRef = `fpay_${this.prefix}${++this.seq}`;
    const amount = o.amount ?? l.amount;
    const currency = o.currency ?? l.currency;
    if (o.async) {
      this.emit('link.processing', { link: linkId, payment: paymentRef, amount, currency }, o.delaySeconds);
      this.pendingAsync.set(paymentRef, { linkId, amount, currency });
    } else {
      this.confirm(l, paymentRef, amount, currency, o.delaySeconds);
    }
    return paymentRef;
  }
  private readonly pendingAsync = new Map<string, { linkId: string; amount: number; currency: string }>();
  settle(paymentRef: string, outcome: 'succeeded' | 'failed', delaySeconds?: number): void {
    const p = this.pendingAsync.get(paymentRef);
    if (!p) throw new Error('fake: no pending payment');
    this.pendingAsync.delete(paymentRef);
    const l = this.links.get(p.linkId) as FakeLink;
    if (outcome === 'failed') this.emit('link.failed', { link: p.linkId, payment: paymentRef, reason: 'insufficient_funds' }, delaySeconds);
    else this.confirm(l, paymentRef, p.amount, p.currency, delaySeconds);
  }
  /** A failure reported for a payment that was already confirmed (success-then-failed ordering). */
  failAfterSuccess(linkId: string, paymentRef: string): void {
    this.emit('link.failed', { link: linkId, payment: paymentRef, reason: 'reversed_by_bank' });
  }
  /** A delivery signed with this gateway's secret but carrying any body (hostile metadata, unknown links). */
  forge(body: Record<string, unknown>): void {
    this.emit((body.type as FakeKind) ?? 'link.paid', (body.data as Record<string, unknown>) ?? {});
  }
  refund(paymentRef: string, amount: number, currency: string): void {
    this.emit('payment.refunded', { payment: paymentRef, amount, currency });
  }
  chargeback(paymentRef: string, amount: number, currency: string): void {
    this.emit('payment.disputed', { payment: paymentRef, amount, currency });
  }
  /** Hand out pending deliveries due by `now`, optionally duplicated and/or reversed. */
  drain(o: { duplicate?: boolean; reverse?: boolean } = {}): FakeDelivery[] {
    const now = this.clock.now().getTime();
    const due = this.outbox.filter((d) => d.notBefore.getTime() <= now);
    for (const d of due) this.outbox.splice(this.outbox.indexOf(d), 1);
    const out = o.reverse ? [...due].reverse() : due;
    return o.duplicate ? out.flatMap((d) => [d, d]) : out;
  }

  private confirm(l: FakeLink, paymentRef: string, amount: number, currency: string, delaySeconds?: number): void {
    l.paidBy ??= paymentRef;
    l.paidAt ??= this.clock.now();
    this.emit('link.paid', { link: l.id, payment: paymentRef, amount, currency }, delaySeconds);
  }
  private emit(type: FakeKind, data: Record<string, unknown>, delaySeconds = 0): void {
    const now = this.clock.now();
    const rawBody = JSON.stringify({ id: `fevt_${this.prefix}${++this.seq}`, type, created: Math.floor(now.getTime() / 1000), livemode: this.livemode, data });
    const notBefore = new Date(now.getTime() + delaySeconds * 1000);
    // Signed when handed out (a provider signs each attempt), so a delayed delivery is still fresh.
    const secret = this.secret;
    const clock = this.clock;
    this.outbox.push({
      rawBody,
      notBefore,
      get headers() {
        return { [FAKE_SIGNATURE_HEADER]: signFake(secret, rawBody, clock.now()), 'content-type': 'application/json' };
      },
    });
  }

  // ---- PaymentProvider ---------------------------------------------------------------------------------
  async createPaymentRequest(args: { invoiceId: string; amountMinor: number; reference: string; currency?: string; expiresAt?: Date; idempotencyKey?: string }): Promise<PaymentRequest> {
    this.createCalls.push(args.idempotencyKey ?? '');
    if (this.failCreates > 0) {
      this.failCreates--;
      throw new Error('fake: provider unavailable');
    }
    const existing = args.idempotencyKey ? this.byKey.get(args.idempotencyKey) : undefined;
    const l: FakeLink = existing
      ? (this.links.get(existing) as FakeLink)
      : { id: `plink_${this.prefix}${++this.seq}`, amount: args.amountMinor, currency: args.currency ?? 'GBP', reference: args.reference, active: true, paidBy: null, paidAt: null };
    this.links.set(l.id, l);
    if (args.idempotencyKey) this.byKey.set(args.idempotencyKey, l.id);
    return { kind: 'link', url: `https://pay.fake.test/${l.id}`, reference: args.reference, providerObjectId: l.id, amountMinor: l.amount, currency: l.currency };
  }

  async deactivate(providerObjectId: string): Promise<void> {
    const l = this.links.get(providerObjectId);
    if (l) l.active = false;
  }

  async handleWebhook(rawBody: string, headers: Readonly<Record<string, string>>): Promise<PaymentEvent[]> {
    verifyFake(this.secret, rawBody, headers[FAKE_SIGNATURE_HEADER], this.clock.now());
    return parseFake(rawBody);
  }

  async getStatus(providerObjectId: string): Promise<PaymentEvent[]> {
    if (this.failStatus > 0) {
      this.failStatus--;
      throw new Error('fake: provider unavailable');
    }
    const l = this.links.get(providerObjectId);
    if (!l?.paidBy || !l.paidAt) return [];
    return [{ type: 'payment_confirmed', providerRef: l.paidBy, amountMinor: l.amount, currency: l.currency, paidAt: l.paidAt, requestRef: l.id, livemode: this.livemode }];
  }
}

/** Translate a VERIFIED fake body. Unknown types yield nothing (acknowledged, never stored). */
function parseFake(rawBody: string): PaymentEvent[] {
  const b = JSON.parse(rawBody) as { id: string; type: FakeKind; created: number; livemode: boolean; data: Record<string, unknown> };
  const d = b.data;
  const ids = { providerEventId: b.id, livemode: b.livemode, ...(typeof d.link === 'string' ? { requestRef: d.link } : {}) };
  const at = new Date(b.created * 1000);
  switch (b.type) {
    case 'link.paid':
      return [{ type: 'payment_confirmed', providerRef: String(d.payment), amountMinor: Number(d.amount), currency: String(d.currency), paidAt: at, ...ids }];
    case 'link.processing':
      return [{ type: 'payment_processing', providerRef: String(d.payment), ...ids }];
    case 'link.failed':
      return [{ type: 'payment_failed', providerRef: String(d.payment), reason: String(d.reason), ...ids }];
    case 'payment.refunded':
    case 'payment.disputed':
      return [{ type: 'payment_reversed', reversal: b.type === 'payment.refunded' ? 'refund' : 'chargeback', providerRef: String(d.payment), amountMinor: Number(d.amount), currency: String(d.currency), at, ...ids }];
    default:
      return [];
  }
}
