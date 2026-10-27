// Domain vocabulary. Channel and the other shared types are defined here ONCE;
// ports.ts and everything else import them from this file.

export const CHANNELS = ['email', 'whatsapp', 'sms'] as const;
export type Channel = (typeof CHANNELS)[number];

/**
 * A BCP 47 locale code such as 'en', 'ur', 'ur-Latn' or 'pt-BR'.
 * Deliberately a plain string: customers may speak any language.
 */
export type Locale = string;

export const INVOICE_STATUSES = [
  'open',
  'overdue',
  'promised',
  'disputed',
  'escalated',
  'paid',
  'written_off',
  'cancelled',
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** Final states have no outgoing transitions; nobody is ever contacted again. */
export const FINAL_STATUSES: readonly InvoiceStatus[] = ['paid', 'written_off', 'cancelled'];

/** Statuses for which decide() never contacts the customer (invariant 3.4). */
export const NO_CONTACT_STATUSES: readonly InvoiceStatus[] = ['paid', 'written_off', 'cancelled', 'disputed'];

export interface PolicyStep {
  readonly id: string;
  readonly daysAfterDue: number;
  readonly channel: Channel;
  readonly templateKey: string;
}

export interface Policy {
  readonly steps: readonly PolicyStep[];
  readonly escalateAfterDays: number;
  readonly graceDaysAfterPromise: number;
  readonly maxMessagesPerWeek: number;
}

/**
 * Local hours [startHour, endHour) during which nothing is sent.
 * startHour > endHour wraps midnight (20 and 9 => quiet 20:00-08:59).
 * startHour < endHour does not wrap (1 and 5 => quiet 01:00-04:59).
 * startHour === endHour means no quiet hours (an empty interval).
 */
export interface QuietHours {
  readonly startHour: number;
  readonly endHour: number;
}

export interface Settings {
  /** IANA zone name, e.g. 'Europe/London'. Never a fixed offset. */
  readonly timezone: string;
  readonly quietHours: QuietHours;
  /** Tenant-local ISO dates 'YYYY-MM-DD'. */
  readonly holidays: readonly string[];
}

export interface Ctx {
  readonly now: Date;
  readonly invoice: {
    readonly id: string;
    readonly status: InvoiceStatus;
    /** Tenant-local ISO date 'YYYY-MM-DD'. */
    readonly dueOn: string;
    /** Tenant-local ISO date 'YYYY-MM-DD'. */
    readonly promisedOn?: string;
  };
  readonly customer: { readonly optedOut: boolean };
  readonly history: {
    readonly sentStepIds: readonly string[];
    readonly sentAt: readonly Date[];
    readonly escalated: boolean;
  };
  readonly policy: Policy;
  readonly settings: Settings;
}

export type Action =
  | { readonly kind: 'mark_overdue' }
  | { readonly kind: 'mark_promise_broken' }
  | { readonly kind: 'send_reminder'; readonly step: PolicyStep; readonly idempotencyKey: string }
  | { readonly kind: 'escalate'; readonly reason: string }
  | { readonly kind: 'wait_until'; readonly at: Date };
