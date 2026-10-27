import parsePhoneNumber, { isSupportedCountry, type CountryCode } from 'libphonenumber-js/max';
import { z } from 'zod';

/** Trimmed, lower-cased email, or null if empty or invalid. */
export function normaliseEmail(text: string): { readonly email: string | null; readonly invalid: boolean } {
  const s = text.trim().toLowerCase();
  if (s === '') return { email: null, invalid: false };
  return z.email().safeParse(s).success ? { email: s, invalid: false } : { email: null, invalid: true };
}

export function isCountry(code: string): code is CountryCode {
  return isSupportedCountry(code);
}

/**
 * E.164 using the tenant default country for national numbers. Uses the "max" metadata, because
 * the default "min" metadata only checks length (libphonenumber-js README, "min vs max").
 * The default export returns undefined instead of throwing on unparseable input.
 */
export function normalisePhone(text: string, defaultCountry: CountryCode): { readonly phone: string | null; readonly invalid: boolean } {
  const s = text.trim();
  if (s === '') return { phone: null, invalid: false };
  const p = parsePhoneNumber(s, { defaultCountry, extract: false });
  return p?.isValid() ? { phone: p.number, invalid: false } : { phone: null, invalid: true };
}
