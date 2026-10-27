// Rate limiting and jitter. Both are deterministic and clock-injected, so tests use a fake clock.

/** Token bucket per key (tenant + channel). Limits are configuration, deliberately conservative defaults. */
export interface RateLimit {
  readonly capacity: number;
  readonly refillPerSecond: number;
}

export const DEFAULT_RATE_LIMIT: RateLimit = { capacity: 5, refillPerSecond: 1 };

export class TokenBucketLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  private readonly limitFor: (key: string) => RateLimit;
  private readonly nowMs: () => number;

  constructor(limitFor: (key: string) => RateLimit, nowMs: () => number) {
    this.limitFor = limitFor;
    this.nowMs = nowMs;
  }

  /** Takes a token if available. Returns the wait in ms when not (0 = allowed). */
  tryTake(key: string): number {
    const limit = this.limitFor(key);
    const now = this.nowMs();
    const b = this.buckets.get(key) ?? { tokens: limit.capacity, at: now };
    const refilled = Math.min(limit.capacity, b.tokens + ((now - b.at) / 1000) * limit.refillPerSecond);
    if (refilled >= 1) {
      this.buckets.set(key, { tokens: refilled - 1, at: now });
      return 0;
    }
    this.buckets.set(key, { tokens: refilled, at: now });
    return Math.ceil(((1 - refilled) / limit.refillPerSecond) * 1000);
  }
}

/** FNV-1a 32-bit: a stable, dependency-free hash for spreading work (not for security). */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic forward-only offset in whole minutes, [0, windowMinutes). */
export function jitterMinutes(invoiceId: string, windowMinutes: number): number {
  return windowMinutes <= 0 ? 0 : fnv1a(invoiceId) % windowMinutes;
}
