// Everything the payment pipeline touches is injected (fake gateway, fake clock, failpoints in tests; the
// database stays real).
import type { PaymentProvider } from '@dueloop/core';
import type { Alert } from '@dueloop/messaging';
import type { PaymentsDb } from './db.ts';

export interface Clock {
  now(): Date;
}

/** Same shape as the worker's allowlisting logger: ids, codes and counters only (no payer data, no payloads). */
export interface Logger {
  info(event: string, fields?: Readonly<Record<string, string | number | boolean | null>>): void;
  warn(event: string, fields?: Readonly<Record<string, string | number | boolean | null>>): void;
  error(event: string, fields?: Readonly<Record<string, string | number | boolean | null>>): void;
}

export interface Notifier {
  notify(alert: Alert): Promise<void>;
}

export const PAYMENT_FAILPOINTS = ['after_store', 'after_resolve', 'after_plan', 'after_apply'] as const;
export type PaymentFailpoint = (typeof PAYMENT_FAILPOINTS)[number];
export interface PaymentFailpoints {
  hit(name: PaymentFailpoint, context: { readonly eventId: number | null }): void | Promise<void>;
}
export const NO_PAYMENT_FAILPOINTS: PaymentFailpoints = Object.freeze({ hit: () => undefined });

/** A provider plus the one call the core port does not need: switching a hosted object off (issue F). */
export interface PaymentGateway extends PaymentProvider {
  deactivate?(providerObjectId: string): Promise<void>;
  /** False = no hosted link in this currency (the reminder carries bank text only), e.g. Stripe minor-unit doubts. */
  supportsCurrency?(currency: string): boolean;
}

export interface PaymentAccountRef {
  readonly id: string;
  readonly tenantId: string;
  readonly provider: string;
  readonly mode: 'test' | 'live';
}

/** One gateway per payment account: each account has its own Vault secrets (API key, webhook secret). */
export interface ProviderRegistry {
  forAccount(account: PaymentAccountRef): Promise<PaymentGateway | undefined>;
}

export interface PaymentsConfig {
  readonly visibilitySeconds: number;
  readonly maxAttempts: number;
  readonly retryBaseSeconds: number;
  readonly maxReplans: number;
  /** Requests still active and unpaid this long after creation are checked with getStatus (polling fallback). */
  readonly pollAfterMinutes: number;
  /** A link is reused only while it stays valid at least this long (issue F); otherwise it is replaced. */
  readonly linkMinRemainingHours: number;
}

export const DEFAULT_PAYMENTS_CONFIG: PaymentsConfig = { visibilitySeconds: 120, maxAttempts: 5, retryBaseSeconds: 30, maxReplans: 10, pollAfterMinutes: 60, linkMinRemainingHours: 24 };

export interface PaymentsDeps {
  readonly db: PaymentsDb;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly notifier: Notifier;
  readonly providers: ProviderRegistry;
  readonly failpoints: PaymentFailpoints;
  readonly config: PaymentsConfig;
}
