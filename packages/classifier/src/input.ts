// What the model is allowed to see (pipeline step 7): the customer's text, truncated and redacted, plus the
// reference local date, weekday and timezone (issue K), the currency code and a locale hint. Nothing else:
// no names, emails, phone numbers or invoice numbers.
import { createHash } from 'node:crypto';
import { DateTime } from 'luxon';

export const MAX_MODEL_TEXT = 2000;

export interface ClassifierInput {
  /** Redacted, truncated customer text. Untrusted data: the prompt puts it inside delimiters. */
  readonly text: string;
  /** Reference local date 'YYYY-MM-DD' (when the customer wrote), weekday and IANA zone. */
  readonly referenceDate: string;
  readonly weekday: string;
  readonly timezone: string;
  readonly currency: string;
  readonly localeHint: string;
}

export interface RedactionContext {
  readonly names: readonly string[];
  readonly invoiceNumbers: readonly string[];
}

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
// 7+ digits with optional separators: phone numbers, account numbers. Amounts and dates are shorter.
const LONG_NUMBER = /\+?\d(?:[\s().-]?\d){6,}/g;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Removes contact details and identifiers we know about. Amounts and dates stay (the model needs them). */
export function redactForModel(text: string, ctx: RedactionContext): string {
  let out = text.replace(EMAIL, '[email]').replace(LONG_NUMBER, '[number]');
  for (const n of ctx.invoiceNumbers.filter((x) => x.trim().length >= 2)) out = out.replace(new RegExp(escapeRe(n), 'gi'), '[invoice]');
  // Whole names and their parts of 3+ letters ("Ada Lovelace" -> "Ada", "Lovelace").
  const parts = ctx.names.flatMap((n) => [n, ...n.split(/\s+/)]).filter((p) => p.trim().length >= 3);
  for (const p of [...new Set(parts)].sort((a, b) => b.length - a.length)) out = out.replace(new RegExp(`(?<![\\p{L}])${escapeRe(p)}(?![\\p{L}])`, 'giu'), '[name]');
  return out;
}

/** Drops invisible formatting characters that can hide instructions (zero-width, bidi overrides). */
export function stripInvisible(text: string): string {
  return text.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, '');
}

export function buildClassifierInput(args: {
  text: string;
  reference: Date;
  timezone: string;
  currency: string;
  localeHint: string;
  redaction: RedactionContext;
}): ClassifierInput {
  const local = DateTime.fromJSDate(args.reference).setZone(args.timezone);
  const clean = redactForModel(stripInvisible(args.text), args.redaction);
  return {
    text: clean.length > MAX_MODEL_TEXT ? `${clean.slice(0, MAX_MODEL_TEXT)} [truncated]` : clean,
    referenceDate: local.toISODate() ?? '',
    weekday: local.setLocale('en').toFormat('cccc'),
    timezone: args.timezone,
    currency: args.currency,
    localeHint: args.localeHint,
  };
}

/** Stable key for recorded outputs: the exact input the model saw, plus the prompt version. */
export function inputHash(input: ClassifierInput, promptVersion: string): string {
  const canonical = JSON.stringify([promptVersion, input.text, input.referenceDate, input.weekday, input.timezone, input.currency, input.localeHint]);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
