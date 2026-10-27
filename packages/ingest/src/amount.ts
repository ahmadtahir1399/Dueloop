// Amount text -> integer minor units, with string/BigInt arithmetic only (never parseFloat).
import { currencyExponent } from '@dueloop/core';
import type { Issue } from './types.ts';

export type AmountResult =
  | { readonly ok: true; readonly minor: number; readonly currencyInCell: string | null }
  | { readonly ok: false; readonly issue: Issue };

const err = (code: Issue['code'], message: string): AmountResult => ({ ok: false, issue: { code, message } });

// Symbols are stripped but never decide the currency ('$' is USD, CAD, AUD, ...). Only a 3-letter code does.
const SYMBOLS = /[$€£¥₹₨]|\bRs\.?(?=\s|\d|$)/gi;
// Spaces used as thousands separators: normal, no-break, narrow no-break, thin.
const SPACES = /[ \u00A0\u202F\u2009]/;

/**
 * Parses "$1,250.00", "1.250,00 EUR", "1 250,00", "1250", "1,250", "PKR 1,00,000".
 * - decimal '.' : groups may be ',' ' or spaces; decimal ',' : groups may be '.' ' or spaces.
 * - Western grouping (1,234,567) is accepted, and so is Indian grouping (1,00,000 and 12,34,567)
 *   with ',' as the group separator. Anything else with separators is an error, not a guess.
 * - Zero and negative amounts, and more decimals than the currency allows, are row errors.
 */
export function parseAmount(text: string, decimal: '.' | ',', resolveCurrency: (cellCode: string | null) => string): AmountResult {
  let s = text.trim();
  if (s === '') return err('missing_value', 'amount is empty');
  if (/^[-−]|[-−]$|^\(.*\)$/.test(s)) return err('non_positive_amount', `amount must be positive: "${text}"`);

  let code: string | null = null;
  const m = /^([A-Za-z]{3})\s*(?=[\d$€£¥₹₨.,])|\s*([A-Za-z]{3})$/.exec(s);
  if (m) {
    code = (m[1] ?? m[2] ?? '').toUpperCase();
    s = (s.slice(0, m.index) + s.slice(m.index + m[0].length)).trim();
  }
  s = s.replace(SYMBOLS, '').trim();
  if (s === '' || /[^\d.,' \u00A0\u202F\u2009]/.test(s)) return err('invalid_amount', `not an amount: "${text}"`);

  const currency = resolveCurrency(code);
  const exp = currencyExponent(currency);
  if (!exp.ok) return err('unknown_currency', `unknown ISO 4217 currency: "${currency}"`);

  const group = decimal === '.' ? ',' : '.';
  const parts = s.split(decimal);
  if (parts.length > 2) return err('invalid_amount', `more than one decimal separator: "${text}"`);
  const [intRaw = '', frac = ''] = parts;
  if (parts.length === 2 && !/^\d+$/.test(frac)) return err('invalid_amount', `bad decimals in "${text}"`);

  const intPart = groupedDigits(intRaw, group);
  if (intPart === null) return err('invalid_amount', `cannot read digit grouping in "${text}" with decimal "${decimal}"`);
  if (frac.length > exp.value) {
    return err('excess_decimals', `${currency} has ${exp.value} decimal place(s); "${text}" has ${frac.length}`);
  }

  const minor = BigInt(intPart + frac.padEnd(exp.value, '0'));
  if (minor <= 0n) return err('non_positive_amount', `amount must be positive: "${text}"`);
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return err('amount_too_large', `amount too large: "${text}"`);
  return { ok: true, minor: Number(minor), currencyInCell: code };
}

/** Validates thousands grouping and returns the bare digits, or null if the grouping is not recognised. */
function groupedDigits(s: string, group: ',' | '.'): string | null {
  if (/^\d+$/.test(s)) return s;
  const seps = new Set([...s].filter((c) => !/\d/.test(c)).map((c) => (SPACES.test(c) ? ' ' : c)));
  if (seps.size !== 1) return null;
  const sep = [...seps][0];
  if (sep !== group && sep !== ' ' && sep !== "'") return null;
  const groups = s.split(sep === ' ' ? SPACES : sep);
  const western = /^\d{1,3}$/.test(groups[0] ?? '') && groups.slice(1).every((g) => /^\d{3}$/.test(g));
  const indian =
    sep === ',' &&
    groups.length >= 3 &&
    /^\d{1,2}$/.test(groups[0] ?? '') &&
    groups.slice(1, -1).every((g) => /^\d{2}$/.test(g)) &&
    /^\d{3}$/.test(groups.at(-1) ?? '');
  return western || indian ? groups.join('') : null;
}
