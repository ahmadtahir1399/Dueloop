// Money display (rules 3, 38; issue I). Amounts arrive as TEXT (bigint columns are selected with ::text, because
// a JSON number is rounded above 2^53) and are formatted by core's digitsToMajorString plus Intl with the exact
// decimal string. A value that cannot be shown exactly is shown as "amount unavailable", never as a wrong number.
import { currencyExponent, digitsToMajorString } from "@dueloop/core";

export const AMOUNT_UNAVAILABLE = "amount unavailable";

/** Minor units as text ("12345", "-50") or a safe integer. Anything else is rejected. */
export function formatMinor(minor: string | number | null | undefined, currency: string | null | undefined): string {
  if (!currency) return AMOUNT_UNAVAILABLE;
  let text: string;
  if (typeof minor === "number") {
    if (!Number.isSafeInteger(minor)) return AMOUNT_UNAVAILABLE;
    text = String(minor);
  } else if (typeof minor === "string") {
    text = minor;
  } else {
    return AMOUNT_UNAVAILABLE;
  }
  const negative = text.startsWith("-");
  const digits = negative ? text.slice(1) : text;
  const major = digitsToMajorString(digits, currency);
  const exp = currencyExponent(currency);
  if (!major.ok || !exp.ok) return AMOUNT_UNAVAILABLE;
  const formatted = new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    minimumFractionDigits: exp.value,
    maximumFractionDigits: exp.value,
  }).format(major.value as Intl.StringNumericLiteral);
  return negative ? `-${formatted}` : formatted;
}

/** Compare two minor-unit texts without converting to Number. */
export function minorIsPositive(minor: string | null | undefined): boolean {
  return typeof minor === "string" && /^\d+$/.test(minor) && /[1-9]/.test(minor);
}
