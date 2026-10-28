// The confirmation pipeline (prompt 5, "the cashier window"): resolve against OUR rows, plan with pure core,
// apply in one transaction, alert after commit, ack last. Manual and proof confirmations enter at step 4.
import { planPaymentOutcome, type PaymentEvent, type PaymentPlan } from '@dueloop/core';
import type { Alert } from '@dueloop/messaging';
import type { ClaimedPaymentEvent, InvoiceForPayment, PaymentEventRow, ReceiptInput, RequestRow } from './db.ts';
import { POLL_EVENT_PREFIX } from './poll.ts';
import { sweepRequests } from './requests.ts';
import type { PaymentsDeps } from './ports.ts';

export type PaymentOutcome =
  | 'applied'
  | 'duplicate'
  | 'unmatched'
  | 'mismatch'
  | 'failed_recorded'
  | 'processing'
  | 'reversal_recorded'
  | 'retry'
  | 'dead_lettered'
  | 'missing';

export class RetryablePayment extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

const ALERT: Record<string, { severity: Alert['severity']; title: (n: string) => string }> = {
  invoice_paid: { severity: 'info', title: (n) => `Invoice ${n} is paid` },
  partial_payment: { severity: 'info', title: (n) => `A partial payment arrived for invoice ${n}` },
  overpayment: { severity: 'warning', title: (n) => `Invoice ${n} was overpaid: a credit was recorded` },
  payment_on_final_invoice: { severity: 'critical', title: (n) => `Money arrived for closed invoice ${n}: recorded as credit` },
  payment_while_disputed: { severity: 'warning', title: (n) => `Disputed invoice ${n} was paid: the dispute task stays open` },
  payment_reversal: { severity: 'critical', title: (n) => `A payment for invoice ${n} was refunded or charged back` },
  unmatched_payment: { severity: 'critical', title: () => 'A payment arrived that matches none of our payment requests' },
  payment_amount_mismatch: { severity: 'critical', title: (n) => `A payment for invoice ${n} does not match the requested amount` },
};

async function alert(deps: PaymentsDeps, tenantId: string, key: string, kind: string, invoiceNumber: string, lines: string[]): Promise<void> {
  const spec = ALERT[kind];
  if (!spec) return;
  try {
    if (!(await deps.db.firstNotification(tenantId, `${key}:${kind}`, `payment_${kind}`, deps.clock.now()))) return;
    await deps.notifier.notify({ tenantId, dedupeKey: `${key}:${kind}`, kind: `payment_${kind}`, severity: spec.severity, title: spec.title(invoiceNumber), lines });
  } catch {
    deps.logger.warn('notify_failed', { tenantId, reason: kind }); // a failed alert never fails processing
  }
}

/**
 * Steps 4-6 for money that is real and resolved to one invoice: plan (pure) + apply (one transaction, row
 * lock, bounded re-plan) + alerts after commit. Shared by webhooks, polling, manual and proof confirmation.
 */
export async function applyMoney(
  deps: PaymentsDeps,
  a: { tenantId: string; invoiceId: string; receipt: ReceiptInput; requestId: string | null; correlationId: string },
): Promise<{ outcome: 'applied' | 'duplicate'; receiptId: string; plan: PaymentPlan; invoice: InvoiceForPayment }> {
  for (let round = 0; round < deps.config.maxReplans; round++) {
    const inv = await deps.db.invoice(a.tenantId, a.invoiceId);
    if (!inv) throw new RetryablePayment('invoice_missing');
    const plan = planPaymentOutcome({
      invoice: { status: inv.status, balanceMinor: inv.balanceMinor, currency: inv.currency },
      receipt: { amountMinor: a.receipt.amountMinor, currency: a.receipt.currency },
      promise: inv.promisedOn ? { promisedOn: inv.promisedOn } : null,
      paidAt: a.receipt.receivedAt,
      timezone: inv.timezone,
      graceDays: inv.graceDays,
    });
    if (plan.rejected) throw new PaymentRejected(plan.rejected, inv);
    await deps.failpoints.hit('after_plan', { eventId: a.receipt.paymentEventId });
    const r = await deps.db.apply({ invoice: inv, receipt: a.receipt, plan, requestId: a.requestId, now: deps.clock.now() });
    if (r.result === 'replan') continue;
    await deps.failpoints.hit('after_apply', { eventId: a.receipt.paymentEventId });
    if (r.result === 'applied') {
      // Requests apply_payment retired (paid / balance changed) stop taking money at the provider now; a
      // failure here is retried by the sweep.
      await sweepRequests(deps, { tenantId: a.tenantId, invoiceId: a.invoiceId }, 10).catch(() => undefined);
      const lines = [`invoice: ${inv.number}`, `received: ${a.receipt.amountMinor} ${inv.currency} minor units`, `applied: ${plan.applied}`, ...(plan.credit ? [`credit: ${plan.credit}`] : [])];
      for (const k of [...plan.alerts]) await alert(deps, a.tenantId, `receipt:${r.receiptId}`, k, inv.number, lines);
    }
    deps.logger.info('payment_applied', { correlationId: a.correlationId, tenantId: a.tenantId, invoiceId: a.invoiceId, outcome: r.result, count: plan.applied });
    return { outcome: r.result, receiptId: r.receiptId, plan, invoice: inv };
  }
  throw new RetryablePayment('replan_exhausted');
}

/** The plan refused the money outright (currency mismatch, non-positive amount): a human looks. */
export class PaymentRejected extends Error {
  readonly reason: string;
  readonly invoice: InvoiceForPayment;
  constructor(reason: string, invoice: InvoiceForPayment) {
    super(reason);
    this.reason = reason;
    this.invoice = invoice;
  }
}

async function mismatch(deps: PaymentsDeps, ev: PaymentEventRow, req: RequestRow | null, invoiceId: string | null, reason: string, number: string): Promise<PaymentOutcome> {
  const at = deps.clock.now();
  await deps.db.task({ tenantId: ev.tenantId, type: 'payment_amount_mismatch', reason, invoiceId, urgent: true, details: { eventId: ev.id, requestId: req?.id ?? null }, dedupeKey: `payment-event:${ev.id}:mismatch`, at });
  await alert(deps, ev.tenantId, `payment-event:${ev.id}`, 'payment_amount_mismatch', number, [`reason: ${reason}`]);
  deps.logger.warn('payment_mismatch', { correlationId: `payment:${ev.id}`, tenantId: ev.tenantId, reason });
  return 'mismatch';
}

async function handle(deps: PaymentsDeps, ev: PaymentEventRow): Promise<PaymentOutcome> {
  const e: PaymentEvent = ev.event;
  const log = { correlationId: `payment:${ev.id}`, tenantId: ev.tenantId };
  const at = deps.clock.now();
  const account = ev.accountId ? await deps.db.account(ev.accountId) : null;

  // Mode must match the account (issue G/O). The webhook route already rejects mismatches; this is the backstop.
  if (account && e.livemode !== undefined && e.livemode !== (account.mode === 'live')) return mismatch(deps, ev, null, null, 'mode_mismatch', '?');

  if (e.type === 'payment_reversed') {
    // Issue E: a reversal never reopens or edits anything. An urgent task + an event, for a human.
    const rec = await deps.db.receiptByRef(ev.tenantId, ev.provider, e.providerRef);
    const req = !rec && e.requestRef ? await deps.db.requestByObject(ev.provider, e.requestRef) : null;
    const invoiceId = rec?.invoiceId ?? (req && req.tenantId === ev.tenantId ? req.invoiceId : null);
    await deps.db.task({ tenantId: ev.tenantId, type: 'payment_reversal', reason: e.reversal, invoiceId, urgent: true, details: { eventId: ev.id, amount: e.amountMinor, receiptId: rec?.id ?? null }, dedupeKey: `payment-event:${ev.id}:reversal`, at });
    if (invoiceId) await deps.db.invoiceEvent(ev.tenantId, invoiceId, 'PaymentReversed', `payment-event:${ev.id}:reversed`, { reversal: e.reversal, amount: e.amountMinor, receiptId: rec?.id ?? null }, at);
    const inv = invoiceId ? await deps.db.invoice(ev.tenantId, invoiceId) : null;
    await alert(deps, ev.tenantId, `payment-event:${ev.id}`, 'payment_reversal', inv?.number ?? '?', [`type: ${e.reversal}`, `amount: ${e.amountMinor}`]);
    deps.logger.warn('payment_reversal', { ...log, reason: e.reversal });
    return 'reversal_recorded';
  }

  // Resolve via OUR payment_requests row (issue G). Never from metadata.
  const req = e.requestRef ? await deps.db.requestByObject(ev.provider, e.requestRef) : null;
  await deps.failpoints.hit('after_resolve', { eventId: ev.id });
  if (!req || req.tenantId !== ev.tenantId) {
    if (e.type !== 'payment_confirmed') return 'unmatched';
    await deps.db.task({ tenantId: ev.tenantId, type: 'unmatched_payment', reason: 'unknown_request', invoiceId: null, urgent: true, details: { eventId: ev.id, amount: e.amountMinor, currency: e.currency ?? null }, dedupeKey: `payment-event:${ev.id}:unmatched`, at });
    await deps.db.tenantEvent(ev.tenantId, 'PaymentUnmatched', `payment-event:${ev.id}:unmatched`, { eventId: ev.id }, at);
    await alert(deps, ev.tenantId, `payment-event:${ev.id}`, 'unmatched_payment', '?', [`event: ${ev.id}`]);
    deps.logger.warn('payment_unmatched', log);
    return 'unmatched';
  }

  if (e.type === 'payment_processing') {
    // Issue J: "processing" is not paid.
    deps.logger.info('payment_processing', { ...log, invoiceId: req.invoiceId });
    return 'processing';
  }
  if (e.type === 'payment_failed') {
    const rec = await deps.db.receiptByRef(ev.tenantId, ev.provider, e.providerRef);
    if (rec) {
      // A failure AFTER confirmation is a reversal (issue J -> E).
      await deps.db.task({ tenantId: ev.tenantId, type: 'payment_reversal', reason: 'failed_after_confirmation', invoiceId: rec.invoiceId, urgent: true, details: { eventId: ev.id, receiptId: rec.id }, dedupeKey: `payment-event:${ev.id}:reversal`, at });
      await deps.db.invoiceEvent(ev.tenantId, rec.invoiceId, 'PaymentReversed', `payment-event:${ev.id}:reversed`, { reversal: 'failed_after_confirmation', receiptId: rec.id }, at);
      const inv = await deps.db.invoice(ev.tenantId, rec.invoiceId);
      await alert(deps, ev.tenantId, `payment-event:${ev.id}`, 'payment_reversal', inv?.number ?? '?', ['type: failed_after_confirmation']);
      deps.logger.warn('payment_reversal', { ...log, reason: 'failed_after_confirmation' });
      return 'reversal_recorded';
    }
    await deps.db.invoiceEvent(ev.tenantId, req.invoiceId, 'PaymentFailed', `payment-event:${ev.id}:failed`, { requestId: req.id, reason: e.reason ?? null }, at);
    return 'failed_recorded'; // the request stays active
  }

  // payment_confirmed: amount and currency must be what we asked for (issue G).
  const inv = await deps.db.invoice(ev.tenantId, req.invoiceId);
  if (!inv) throw new RetryablePayment('invoice_missing');
  if ((e.currency ?? req.currency) !== req.currency || e.amountMinor !== req.amountMinor) return mismatch(deps, ev, req, req.invoiceId, 'amount_or_currency', inv.number);

  try {
    const r = await applyMoney(deps, {
      tenantId: ev.tenantId,
      invoiceId: req.invoiceId,
      requestId: req.id,
      correlationId: log.correlationId,
      receipt: {
        method: ev.provider === 'stripe' ? 'stripe' : 'fake',
        source: ev.providerEventId.startsWith(POLL_EVENT_PREFIX) ? 'poll' : 'gateway',
        providerRef: e.providerRef,
        amountMinor: e.amountMinor,
        currency: e.currency ?? req.currency,
        receivedAt: e.paidAt,
        confirmedBy: null,
        paymentEventId: ev.id,
        proofId: null,
        note: null,
      },
    });
    return r.outcome;
  } catch (err) {
    if (err instanceof PaymentRejected) return mismatch(deps, ev, req, req.invoiceId, err.reason, inv.number);
    throw err;
  }
}

/** One stored event: steps 3-7. Errors are classified for retry / dead letter. */
export async function processPaymentEvent(job: ClaimedPaymentEvent, deps: PaymentsDeps): Promise<PaymentOutcome> {
  const { db, clock, logger, config } = deps;
  const ev = await db.event(job.eventId);
  if (!ev) {
    await db.ack(job.msgId);
    return 'missing';
  }
  if (ev.status !== 'pending') {
    await db.ack(job.msgId);
    return 'duplicate';
  }
  try {
    const outcome = await handle(deps, ev);
    await db.markProcessed(ev.id, clock.now());
    await db.ack(job.msgId);
    return outcome;
  } catch (e) {
    if (e instanceof Error && e.name === 'FailpointCrash') throw e;
    const code = e instanceof RetryablePayment ? e.code : 'processing_error';
    const attempts = await db.bumpAttempt(ev.id, code);
    if (attempts >= config.maxAttempts) {
      await db.deadLetter({ ...ev, attempts }, code, clock.now());
      await db.ack(job.msgId);
      logger.error('payment_dead_lettered', { correlationId: `payment:${ev.id}`, tenantId: ev.tenantId, reason: code });
      return 'dead_lettered';
    }
    await db.release(job.msgId, config.retryBaseSeconds * 2 ** (attempts - 1));
    logger.warn('payment_retry', { correlationId: `payment:${ev.id}`, tenantId: ev.tenantId, reason: code, attempt: attempts });
    return 'retry';
  }
}

export async function processPaymentBatch(deps: PaymentsDeps, opts: { limit: number; filter?: Record<string, string> }): Promise<{ claimed: number; outcomes: Record<string, number> }> {
  const jobs = await deps.db.claim(opts.limit, deps.config.visibilitySeconds, opts.filter ?? {});
  const outcomes: Record<string, number> = {};
  for (const job of jobs) {
    const o = await processPaymentEvent(job, deps);
    outcomes[o] = (outcomes[o] ?? 0) + 1;
  }
  return { claimed: jobs.length, outcomes };
}

/** Manual / proof confirmation (pipeline step 4): a human with the right role entered real bank details. */
export async function confirmByHuman(
  deps: PaymentsDeps,
  a: { tenantId: string; invoiceId: string; amountMinor: number; currency: string; paidAt: Date; bankRef: string; userId: string; source: 'manual' | 'proof'; proofId: string | null; note: string | null },
): Promise<{ outcome: 'applied' | 'duplicate'; receiptId: string; plan: PaymentPlan }> {
  const r = await applyMoney(deps, {
    tenantId: a.tenantId,
    invoiceId: a.invoiceId,
    requestId: null,
    correlationId: `${a.source}:${a.invoiceId}`,
    receipt: {
      method: 'bank_transfer',
      source: a.source,
      providerRef: a.bankRef,
      amountMinor: a.amountMinor,
      currency: a.currency,
      receivedAt: a.paidAt,
      confirmedBy: a.userId,
      paymentEventId: null,
      proofId: a.proofId,
      note: a.note,
    },
  });
  return { outcome: r.outcome, receiptId: r.receiptId, plan: r.plan };
}
