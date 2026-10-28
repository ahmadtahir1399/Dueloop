// Everything the processor touches is injected, so tests use a fake classifier, a fake clock and failpoints
// while the database stays real.
import { DEFAULT_REPLY_RULES, type ReplyRules } from '@dueloop/core';
import type { ReplyClassifier } from '@dueloop/classifier';
import type { Alert } from '@dueloop/messaging';
import type { InboundDb } from './db.ts';

export interface Clock {
  now(): Date;
}

/** Same shape as the worker's allowlisting JSON logger (ids, codes and counters only; rules 20 and 25). */
export interface Logger {
  info(event: string, fields?: Readonly<Record<string, string | number | boolean | null>>): void;
  warn(event: string, fields?: Readonly<Record<string, string | number | boolean | null>>): void;
  error(event: string, fields?: Readonly<Record<string, string | number | boolean | null>>): void;
}

export interface Notifier {
  notify(alert: Alert): Promise<void>;
}

/** Crash points of the inbound pipeline (chaos). `after_raw_insert` lives in the webhook/IMAP store step. */
export const INBOUND_FAILPOINTS = ['after_message_insert', 'after_classify', 'after_apply'] as const;
export type InboundFailpoint = (typeof INBOUND_FAILPOINTS)[number];

export interface InboundFailpoints {
  hit(name: InboundFailpoint, context: { readonly eventId: number }): void;
}

export const NO_INBOUND_FAILPOINTS: InboundFailpoints = Object.freeze({ hit: () => undefined });

export interface InboundConfig {
  readonly visibilitySeconds: number;
  /** Processing attempts (classifier outages included) before the event is dead-lettered with a task. */
  readonly maxAttempts: number;
  readonly retryBaseSeconds: number;
  /** Issue K: a provider timestamp counts only if not more than this far in the future... */
  readonly maxFutureSkewMs: number;
  /** ...and not older than this. Otherwise the reference time is when we received it. */
  readonly maxProviderAgeDays: number;
  /** Re-plan attempts when the invoice moved between planning and applying (optimistic guard). */
  readonly maxReplans: number;
  /** Tenant settings override promiseAcceptance; the rest are the measured/default rules. */
  readonly rules: ReplyRules;
}

export const DEFAULT_INBOUND_CONFIG: InboundConfig = {
  visibilitySeconds: 120,
  maxAttempts: 5,
  retryBaseSeconds: 30,
  maxFutureSkewMs: 5 * 60_000,
  maxProviderAgeDays: 14,
  maxReplans: 3,
  rules: DEFAULT_REPLY_RULES,
};

export interface InboundDeps {
  readonly db: InboundDb;
  readonly classifier: ReplyClassifier;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly notifier: Notifier;
  readonly failpoints: InboundFailpoints;
  readonly config: InboundConfig;
}
