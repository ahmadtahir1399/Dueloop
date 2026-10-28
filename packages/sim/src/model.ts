import type { Channel, InvoiceStatus, Money, Policy, Settings } from '@dueloop/core';

export const BEHAVIOURS = [
  'early_payer',
  'pays_after_reminder',
  'pays_in_instalments',
  'promise_keep',
  'promise_break',
  'disputes',
  'opts_out',
  'never_pays',
  // Prompt 4: replies that go through planReplyOutcome and never change state on their own.
  'claims_paid',
  'vague_promise',
] as const;
export type Behaviour = (typeof BEHAVIOURS)[number];

export interface Tenant {
  readonly id: string;
  readonly currency: string;
  readonly settings: Settings;
  readonly policy: Policy;
}

export interface Customer {
  readonly id: string;
  readonly tenantId: string;
  readonly behaviour: Behaviour;
  /** For pays_after_reminder: pays after the k-th reminder of an invoice. */
  readonly k: number;
  /** Hours between a reminder and the customer's reaction. */
  readonly delayHours: number;
  optedOut: boolean;
  /** Every reminder sent to this customer (all invoices), epoch ms. */
  readonly sentAt: number[];
}

export interface SimInvoice {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly total: Money;
  readonly dueOn: string;
  status: InvoiceStatus;
  promisedOn: string | undefined;
  paidMinor: number;
  readonly sentStepIds: string[];
  escalated: boolean;
  remindersSent: number;
  /** Next time the scheduler evaluates this invoice (epoch ms); null = never (final). */
  nextActionAt: number | null;
  /** Reminders blocked until (epoch ms) by an open task ("already paid", info request); null = none. */
  blockedUntil: number | null;
}

export type ExternalKind = 'payment' | 'promise' | 'dispute' | 'opt_out' | 'write_off' | 'void' | 'payment_claim' | 'vague_promise';

export interface ExternalEvent {
  readonly at: number;
  readonly seq: number;
  readonly kind: ExternalKind;
  readonly invoiceId: string;
  readonly amountMinor?: number;
  readonly promiseDays?: number;
}

/** What the outbound gateway saw, with the state at the moment of sending. */
export interface SendRecord {
  readonly at: number;
  readonly tenantId: string;
  readonly customerId: string;
  readonly invoiceId: string;
  readonly stepId: string;
  readonly channel: Channel;
  readonly idempotencyKey: string;
  readonly statusAtSend: InvoiceStatus;
  readonly optedOutAtSend: boolean;
  readonly promisedOnAtSend: string | undefined;
  readonly blockedUntilAtSend: number | null;
}

export interface TimelineEntry {
  readonly at: number;
  readonly type: string;
  readonly detail?: string;
}

export type ViolationKind =
  | 'quiet_hours'
  | 'holiday'
  | 'opted_out'
  | 'no_contact_status'
  | 'duplicate_key'
  | 'weekly_cap'
  | 'illegal_transition'
  // Prompt 4 invariants.
  | 'promised_too_early'
  | 'blocked'
  | 'opt_out_not_final';

export interface Violation {
  readonly kind: ViolationKind;
  readonly at: number;
  readonly invoiceId: string;
  readonly detail: string;
}
