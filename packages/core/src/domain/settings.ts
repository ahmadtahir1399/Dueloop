import { DateTime, IANAZone } from 'luxon';
import type { Settings } from './types.ts';

export interface SettingsError {
  readonly field: string;
  readonly message: string;
}

export type SettingsValidation =
  | { readonly ok: true; readonly value: Settings }
  | { readonly ok: false; readonly errors: readonly SettingsError[] };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// Modern Intl (Node 24, ICU 78) accepts offset zones like '+05:00', and Luxon's
// isValidZone delegates to Intl, so offset-looking strings are rejected explicitly.
const OFFSET_LIKE = /^[+-]|^(UTC|GMT)[+-]/i;

/** True when tz is an IANA zone name (not a fixed-offset specifier). */
export function isIanaZone(tz: unknown): tz is string {
  return (
    typeof tz === 'string' &&
    !OFFSET_LIKE.test(tz) &&
    IANAZone.isValidZone(tz) &&
    DateTime.fromMillis(0, { zone: tz }).isValid
  );
}

function isHour(h: unknown): h is number {
  return typeof h === 'number' && Number.isInteger(h) && h >= 0 && h <= 23;
}

/** True when s is a real calendar date written as 'YYYY-MM-DD'. */
export function isIsoDate(s: unknown): s is string {
  return typeof s === 'string' && ISO_DATE.test(s) && DateTime.fromISO(s, { zone: 'UTC' }).isValid;
}

/**
 * Validates tenant settings without throwing. Rejects fixed-offset specifiers
 * such as 'UTC+5' (Luxon accepts those, IANA does not).
 * startHour === endHour is VALID and means "no quiet hours".
 */
export function validateSettings(s: Settings): SettingsValidation {
  const errors: SettingsError[] = [];
  const tz: unknown = s.timezone;
  if (!isIanaZone(tz)) {
    errors.push({ field: 'timezone', message: `not a valid IANA time zone: ${String(tz)}` });
  }
  if (!isHour(s.quietHours.startHour)) {
    errors.push({ field: 'quietHours.startHour', message: 'must be an integer 0-23' });
  }
  if (!isHour(s.quietHours.endHour)) {
    errors.push({ field: 'quietHours.endHour', message: 'must be an integer 0-23' });
  }
  s.holidays.forEach((d, i) => {
    if (!isIsoDate(d)) errors.push({ field: `holidays[${i}]`, message: `not a valid ISO date: ${String(d)}` });
  });
  return errors.length === 0 ? { ok: true, value: s } : { ok: false, errors };
}
