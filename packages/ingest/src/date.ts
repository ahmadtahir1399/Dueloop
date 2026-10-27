import { DateTime } from 'luxon';
import type { DateFormat, Issue } from './types.ts';

export type DateResult =
  | {
      readonly ok: true;
      readonly iso: string;
      /** True when the value itself proves the format (day-of-month > 12), so DMY/MDY is not ambiguous. */
      readonly confirmsFormat: boolean;
      readonly excelSerial: boolean;
    }
  | { readonly ok: false; readonly issue: Issue };

const invalid = (text: string, why: string): DateResult => ({ ok: false, issue: { code: 'invalid_date', message: `${why}: "${text}"` } });

/**
 * Excel serial dates (1900 date system, per Microsoft's "Date systems in Excel": serial 1 is
 * 1900-01-01 and Excel wrongly treats 1900 as a leap year). For serials >= 61 the date is
 * 1899-12-30 + serial days. Only plain integers in a plausible invoice range are read as serials:
 * 20000..80000 = 1954-10-03..2119-01-10. The 1904 (old Mac) system is not supported.
 */
export const EXCEL_SERIAL_MIN = 20_000;
export const EXCEL_SERIAL_MAX = 80_000;

/**
 * Parses a date cell with an explicit, never-inferred format. Separators: / - . or space.
 * Years: 4 digits as written; 2 digits are read as 20YY (00-99 -> 2000-2099), since invoices
 * from the 1900s are not expected. Impossible dates such as 31/02 are errors.
 */
export function parseDate(text: string, format: DateFormat): DateResult {
  const s = text.trim();
  if (s === '') return { ok: false, issue: { code: 'missing_value', message: 'date is empty' } };

  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (n < EXCEL_SERIAL_MIN || n > EXCEL_SERIAL_MAX) return invalid(s, 'a plain number that is not a plausible Excel date serial');
    const d = DateTime.fromObject({ year: 1899, month: 12, day: 30 }, { zone: 'UTC' }).plus({ days: n });
    return { ok: true, iso: d.toFormat('yyyy-MM-dd'), confirmsFormat: true, excelSerial: true };
  }

  const parts = s.split(/[/\-. ]+/);
  if (parts.length !== 3 || !parts.every((p) => /^\d+$/.test(p))) return invalid(s, `not a ${format} date`);
  const [a = '', b = '', c = ''] = parts;
  const [yy, mm, dd] = format === 'DMY' ? [c, b, a] : format === 'MDY' ? [c, a, b] : [a, b, c];
  if (mm.length > 2 || dd.length > 2) return invalid(s, `not a ${format} date`);
  let year: number;
  if (yy.length === 4) year = Number(yy);
  else if (yy.length === 2) year = 2000 + Number(yy);
  else return invalid(s, 'the year must have 2 or 4 digits');

  const d = DateTime.fromObject({ year, month: Number(mm), day: Number(dd) }, { zone: 'UTC' });
  if (!d.isValid) return invalid(s, `no such ${format} date`);
  return { ok: true, iso: d.toFormat('yyyy-MM-dd'), confirmsFormat: format === 'YMD' || Number(dd) > 12, excelSerial: false };
}
