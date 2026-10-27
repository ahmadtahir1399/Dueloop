import { ISO4217_MINOR_UNITS } from './iso4217.ts';

/**
 * An amount in the currency's smallest unit (cents, fils, yen) plus its ISO 4217 code.
 * `minor` is always a non-negative safe integer. Never a float.
 */
export interface Money {
  readonly minor: number;
  readonly currency: string;
}

export type MoneyError =
  | 'unknown_currency'
  | 'not_safe_integer'
  | 'negative'
  | 'currency_mismatch'
  | 'overflow'
  | 'invalid_count'
  | 'invalid_format';

export type MoneyResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: MoneyError };

const ok = <T>(value: T): MoneyResult<T> => ({ ok: true, value });
const fail = <T>(error: MoneyError): MoneyResult<T> => ({ ok: false, error });

/** Number of minor-unit digits from the ISO 4217 table: JPY 0, USD 2, KWD 3, CLF 4. */
export function currencyExponent(currency: string): MoneyResult<number> {
  const exp = Object.hasOwn(ISO4217_MINOR_UNITS, currency) ? ISO4217_MINOR_UNITS[currency] : undefined;
  return exp === undefined ? fail('unknown_currency') : ok(exp);
}

export function money(minor: number, currency: string): MoneyResult<Money> {
  if (!currencyExponent(currency).ok) return fail('unknown_currency');
  if (!Number.isSafeInteger(minor)) return fail('not_safe_integer');
  if (minor < 0) return fail('negative');
  return ok({ minor, currency });
}

export function assertSameCurrency(a: Money, b: Money): MoneyResult<string> {
  return a.currency === b.currency ? ok(a.currency) : fail('currency_mismatch');
}

export function add(a: Money, b: Money): MoneyResult<Money> {
  if (!assertSameCurrency(a, b).ok) return fail('currency_mismatch');
  const minor = a.minor + b.minor;
  return Number.isSafeInteger(minor) ? ok({ minor, currency: a.currency }) : fail('overflow');
}

/** a - b. A balance never goes below zero: b > a is an error, not a negative amount. */
export function subtract(a: Money, b: Money): MoneyResult<Money> {
  if (!assertSameCurrency(a, b).ok) return fail('currency_mismatch');
  if (b.minor > a.minor) return fail('negative');
  return ok({ minor: a.minor - b.minor, currency: a.currency });
}

export function compare(a: Money, b: Money): MoneyResult<-1 | 0 | 1> {
  if (!assertSameCurrency(a, b).ok) return fail('currency_mismatch');
  return ok(a.minor < b.minor ? -1 : a.minor > b.minor ? 1 : 0);
}

/**
 * Splits total into n instalments whose sum is exactly total.
 * Rule: every part gets floor(total / n); the remainder r = total mod n is handed
 * out one minor unit at a time to the FIRST r parts. So parts are non-increasing
 * and differ by at most one minor unit. If n > total, trailing parts are zero.
 */
export function splitInstalments(total: Money, n: number): MoneyResult<Money[]> {
  if (!Number.isSafeInteger(n) || n < 1) return fail('invalid_count');
  const base = Math.floor(total.minor / n);
  const remainder = total.minor % n;
  const parts: Money[] = [];
  for (let i = 0; i < n; i++) parts.push({ minor: base + (i < remainder ? 1 : 0), currency: total.currency });
  return ok(parts);
}

/** Formats minor units as a plain major-unit string without floats: KWD 12345 -> "12.345". */
export function toMajorString(m: Money): MoneyResult<string> {
  const exp = currencyExponent(m.currency);
  if (!exp.ok) return fail(exp.error);
  if (exp.value === 0) return ok(String(m.minor));
  const digits = String(m.minor).padStart(exp.value + 1, '0');
  return ok(`${digits.slice(0, -exp.value)}.${digits.slice(-exp.value)}`);
}

/**
 * Parses a plain major-unit string ("12.5", "1250", "0.345") into Money.
 * At most `exponent` decimals are accepted; no signs, separators or exponents.
 */
export function parseMajor(text: string, currency: string): MoneyResult<Money> {
  const exp = currencyExponent(currency);
  if (!exp.ok) return fail(exp.error);
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) return fail('invalid_format');
  const whole = m[1] ?? '';
  const frac = m[2] ?? '';
  if (frac.length > exp.value) return fail('invalid_format');
  return money(Number(whole + frac.padEnd(exp.value, '0')), currency);
}
