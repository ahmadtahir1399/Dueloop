// Everything the worker touches goes through these interfaces, so tests inject a fake clock, fake channels,
// failpoints and an in-memory notifier while the database stays real.
import type { Channel } from '@dueloop/core';
import type { Alert, OutboundChannel } from '@dueloop/messaging';

export interface Clock {
  now(): Date;
}

/** Named crash points in the send protocol. Only tests install a Failpoints that does anything. */
export const FAILPOINTS = ['after_claim', 'after_pending_insert', 'after_adapter', 'after_record'] as const;
export type FailpointName = (typeof FAILPOINTS)[number];

export interface Failpoints {
  /** Awaited at every point, so a test can also inject state there (e.g. an opt-out arriving mid-send). */
  hit(name: FailpointName, context: { readonly idempotencyKey: string | null }): void | Promise<void>;
}

/** Production failpoints: a no-op. The runner can only ever construct this one (tested). */
export const NO_FAILPOINTS: Failpoints = Object.freeze({ hit: () => undefined });

export interface Notifier {
  /** Best effort. Must not throw; the worker also guards against throwing notifiers. */
  notify(alert: Alert): Promise<void>;
}

export interface ChannelRegistry {
  get(channel: Channel): OutboundChannel | undefined;
}

export interface RateLimiter {
  /** 0 = allowed now, otherwise milliseconds to wait. */
  tryTake(key: string): number;
}

export interface WorkerConfig {
  /** Seconds a claimed job stays invisible to other workers. */
  readonly visibilitySeconds: number;
  /** A pending message older than this is in an unknown state (ADR 0013). */
  readonly stalePendingSeconds: number;
  /** Retryable attempts per message before the job is dead-lettered. */
  readonly maxAttempts: number;
  /** Base for exponential retry backoff. */
  readonly retryBaseSeconds: number;
  /** Delay before a released job (paused tenant, busy key, rate limit) becomes visible again. */
  readonly releaseSeconds: number;
  /** Deterministic jitter window added to next_action_at. */
  readonly jitterMinutes: number;
  /** Hard timeout for one adapter call; hitting it is AMBIGUOUS, never a retryable failure (issue K). */
  readonly sendTimeoutMs: number;
  /** Pending approvals older than this expire and the invoice re-enters decide() (ADR 0015). */
  readonly approvalMaxAgeDays: number;
}

export const DEFAULT_CONFIG: WorkerConfig = {
  visibilitySeconds: 120,
  stalePendingSeconds: 15 * 60,
  maxAttempts: 5,
  retryBaseSeconds: 60,
  releaseSeconds: 300,
  jitterMinutes: 10,
  sendTimeoutMs: 30_000,
  approvalMaxAgeDays: 7,
};
