// ErrorReporter (prompt 7 step 2). An interface with a no-op default and a scrubber. No vendor SDK is wired: a
// hosted error tracker would receive stack traces and messages from code that handles customer data, so adding one
// needs a data-handling decision (what is sent, where it is stored, for how long) that only the operator can make.
// Whatever reporter is plugged in later receives SCRUBBED text only.

export interface ErrorContext {
  readonly service: string;
  readonly tenantId?: string;
  readonly event?: string;
}

export interface ErrorReporter {
  capture(error: unknown, context: ErrorContext): void;
}

export const NOOP_REPORTER: ErrorReporter = Object.freeze({ capture: () => undefined });

const RULES: [RegExp, string][] = [
  [/postgres(?:ql)?:\/\/[^\s'"]+/gi, '[db-url]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]'],
  [/\bdl_[a-z0-9]{8}_[A-Za-z0-9_-]{20,}/g, '[api-key]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, '[jwt]'],
  [/\b(?:sb_secret|sb_publishable|sk_live|sk_test|rk_live|rk_test|whsec)_[A-Za-z0-9_-]+/g, '[key]'],
  [/\/(?:p|o)\/[A-Za-z0-9_-]{40,}/g, '/[link-token]'],
  [/\/webhooks\/payments\/[A-Za-z0-9_-]{20,}/g, '/webhooks/payments/[token]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  [/\+?\d[\d ()-]{7,}\d/g, '[phone]'],
];

/** Removes secrets, tokens and contact details, and caps the length (message bodies never survive whole). */
export function scrub(text: string, max = 500): string {
  let t = text;
  for (const [re, rep] of RULES) t = t.replace(re, rep);
  return t.length > max ? `${t.slice(0, max)}…[truncated]` : t;
}

/** Turns any thrown value into a scrubbed one-line summary: class name + message, never the stack or a payload. */
export function summarise(error: unknown): string {
  if (error instanceof Error) return scrub(`${error.name}: ${error.message}`);
  return scrub(typeof error === 'string' ? error : 'non-error value thrown');
}

/** A reporter that writes scrubbed JSON lines (the default for services: stdout is collected by the host). */
export function lineReporter(write: (line: string) => void): ErrorReporter {
  return {
    capture(error, context) {
      write(JSON.stringify({ level: 'error', event: context.event ?? 'error', service: context.service, ...(context.tenantId ? { tenantId: context.tenantId } : {}), error: summarise(error) }));
    },
  };
}
