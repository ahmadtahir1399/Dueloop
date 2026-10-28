// Payments (prompt 5): the pure "supervisor" that decides how each received amount is allocated. Money in
// is never lost or invented: for an accepted plan, applied + credit == received (rule 28). Status moves to
// paid ONLY through the state machine's balance_reached_zero event. Pure: paidAt is an argument.
import { DateTime } from 'luxon';
import { isFinal, transition } from './domain/invoiceState.ts';
import type { InvoiceStatus } from './domain/types.ts';

export type PromiseOutcome = 'kept' | 'not_kept' | 'still_active';

/**
 * Issue N, the prompt 4 hook. Same deadline as decide(): the promised local date + grace days, to the end of
 * that day in the tenant zone. Paid in full by then => kept; later => not kept; a partial payment leaves the
 * promise active (no state change).
 */
export function evaluatePromiseOnPayment(
  promise: { readonly promisedOn: string },
  paidAt: Date,
  settings: { readonly timezone: string; readonly graceDays: number },
  fullyPaid: boolean,
): PromiseOutcome {
  if (!fullyPaid) return 'still_active';
  const deadline = DateTime.fromISO(promise.promisedOn, { zone: settings.timezone }).plus({ days: settings.graceDays }).endOf('day');
  return DateTime.fromJSDate(paidAt) <= deadline ? 'kept' : 'not_kept';
}

export interface PaymentPlanInput {
  /** Status and balance as re-read inside the locked transaction. */
  readonly invoice: { readonly status: InvoiceStatus; readonly balanceMinor: number; readonly currency: string };
  /** The money received (a receipt), in minor units. */
  readonly receipt: { readonly amountMinor: number; readonly currency: string };
  readonly promise: { readonly promisedOn: string } | null;
  readonly paidAt: Date;
  readonly timezone: string;
  readonly graceDays: number;
}

export type PaymentTaskType = 'overpayment_credit' | 'payment_on_final_invoice';
export type PaymentAlert = 'invoice_paid' | 'partial_payment' | 'overpayment' | 'payment_on_final_invoice' | 'payment_while_disputed';
export type PaymentEventType = 'PaymentConfirmed' | 'PartialPaymentConfirmed' | 'PaymentCreditCreated' | 'PromiseKept' | 'PromiseBroken';

export interface PaymentPlan {
  /** Not accepted at all (nothing is applied or credited; the pipeline makes a task). */
  readonly rejected: 'currency_mismatch' | 'non_positive_amount' | null;
  readonly applied: number;
  readonly credit: number;
  readonly transition: { readonly event: 'balance_reached_zero'; readonly from: InvoiceStatus; readonly to: InvoiceStatus } | null;
  readonly promiseOutcome: PromiseOutcome | 'none';
  readonly events: readonly PaymentEventType[];
  readonly tasks: readonly { readonly type: PaymentTaskType; readonly urgent: boolean }[];
  readonly alerts: readonly PaymentAlert[];
  /** A receipt goes out when money was applied to the invoice (credit-only cases go to a human first). */
  readonly sendReceipt: boolean;
  /** The invoice is paid: pending approvals and queued reminders are cancelled. */
  readonly stopReminders: boolean;
}

const NONE = { rejected: null, applied: 0, credit: 0, transition: null, promiseOutcome: 'none', events: [], tasks: [], alerts: [], sendReceipt: false, stopReminders: false } as const;

/** Total, deterministic, never throws. */
export function planPaymentOutcome(i: PaymentPlanInput): PaymentPlan {
  const amount = i.receipt.amountMinor;
  if (!Number.isSafeInteger(amount) || amount <= 0) return { ...NONE, rejected: 'non_positive_amount' };
  // Never convert: a receipt in another currency is a human's problem (no FX in this product).
  if (i.receipt.currency !== i.invoice.currency) return { ...NONE, rejected: 'currency_mismatch' };

  const balance = Math.max(0, i.invoice.balanceMinor);
  // Issue C: money for a closed invoice is still real. Apply nothing, keep all of it as credit, tell a human.
  if (isFinal(i.invoice.status)) {
    return { ...NONE, credit: amount, events: ['PaymentCreditCreated'], tasks: [{ type: 'payment_on_final_invoice', urgent: true }], alerts: ['payment_on_final_invoice'] };
  }
  const applied = Math.min(amount, balance);
  const credit = amount - applied;
  if (applied === 0) {
    // A non-final invoice with nothing left to pay: all credit, a human decides.
    return { ...NONE, credit, events: ['PaymentCreditCreated'], tasks: [{ type: 'overpayment_credit', urgent: false }], alerts: ['overpayment'] };
  }

  const reachesZero = balance - applied === 0;
  const t = reachesZero ? transition(i.invoice.status, 'balance_reached_zero') : null;
  const moved = t?.ok ? { event: 'balance_reached_zero' as const, from: t.from, to: t.to } : null;
  const promiseOutcome = i.promise ? evaluatePromiseOnPayment(i.promise, i.paidAt, { timezone: i.timezone, graceDays: i.graceDays }, reachesZero) : 'none';

  const events: PaymentEventType[] = [reachesZero ? 'PaymentConfirmed' : 'PartialPaymentConfirmed'];
  if (promiseOutcome === 'kept') events.push('PromiseKept');
  if (promiseOutcome === 'not_kept') events.push('PromiseBroken');
  if (credit > 0) events.push('PaymentCreditCreated');

  const alerts: PaymentAlert[] = [reachesZero ? 'invoice_paid' : 'partial_payment'];
  if (credit > 0) alerts.push('overpayment');
  if (i.invoice.status === 'disputed') alerts.push('payment_while_disputed');

  return {
    rejected: null,
    applied,
    credit,
    transition: moved,
    promiseOutcome,
    events,
    tasks: credit > 0 ? [{ type: 'overpayment_credit', urgent: false }] : [],
    alerts,
    sendReceipt: true,
    stopReminders: moved !== null,
  };
}
