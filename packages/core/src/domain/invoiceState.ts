import { FINAL_STATUSES, type InvoiceStatus } from './types.ts';

/** Triggers from guide Section 3.3. Classifier proposals (prompt 4) must map onto these. */
export const INVOICE_EVENTS = [
  'due_date_passed',
  'promise_accepted',
  'promise_broken',
  'dispute_raised',
  'escalation_triggered',
  'balance_reached_zero',
  'written_off',
  'voided',
] as const;
export type InvoiceEvent = (typeof INVOICE_EVENTS)[number];

export interface TransitionRule {
  readonly event: InvoiceEvent;
  readonly from: readonly InvoiceStatus[];
  readonly to: InvoiceStatus;
}

/**
 * The legal transitions, as data. Anything not listed here is rejected.
 * "any open state" (dispute) is read as every non-final status except disputed itself.
 * "any non-final" (balance reaches zero) includes disputed and escalated.
 */
export const TRANSITIONS: readonly TransitionRule[] = [
  { event: 'due_date_passed', from: ['open'], to: 'overdue' },
  { event: 'promise_accepted', from: ['overdue'], to: 'promised' },
  { event: 'promise_broken', from: ['promised'], to: 'overdue' },
  { event: 'dispute_raised', from: ['open', 'overdue', 'promised', 'escalated'], to: 'disputed' },
  { event: 'escalation_triggered', from: ['overdue', 'promised'], to: 'escalated' },
  { event: 'balance_reached_zero', from: ['open', 'overdue', 'promised', 'disputed', 'escalated'], to: 'paid' },
  { event: 'written_off', from: ['escalated'], to: 'written_off' },
  { event: 'voided', from: ['open'], to: 'cancelled' },
];

export type TransitionResult =
  | { readonly ok: true; readonly from: InvoiceStatus; readonly to: InvoiceStatus }
  | { readonly ok: false; readonly reason: 'final_state' | 'not_allowed'; readonly from: InvoiceStatus; readonly event: InvoiceEvent };

export function isFinal(status: InvoiceStatus): boolean {
  return FINAL_STATUSES.includes(status);
}

/** The only way an invoice status may change. Never throws. */
export function transition(status: InvoiceStatus, event: InvoiceEvent): TransitionResult {
  if (isFinal(status)) return { ok: false, reason: 'final_state', from: status, event };
  const rule = TRANSITIONS.find((r) => r.event === event && r.from.includes(status));
  return rule ? { ok: true, from: status, to: rule.to } : { ok: false, reason: 'not_allowed', from: status, event };
}
