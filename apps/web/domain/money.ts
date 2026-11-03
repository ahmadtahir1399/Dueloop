// Money in the UI (rule 3, §5.2 adjusted, CONFLICTS C-24): integer minor units carried as TEXT (bigint columns are
// read as ::text so nothing above 2^53 is rounded) plus an ISO 4217 code. Parsing and digits come from core.
import { currencyExponent } from "@dueloop/core";
import { z } from "zod";

export const CurrencyCode = z.string().regex(/^[A-Z]{3}$/, { error: "Use a 3-letter currency code, like USD." });
/** Integer minor units as decimal digits. Never a float. */
export const MinorText = z.string().regex(/^\d{1,38}$/);
export const Money = z.object({ amountMinor: MinorText, currency: CurrencyCode });
export type Money = z.infer<typeof Money>;

/** Fraction digits from core's ISO 4217 table (JPY 0, USD 2, KWD 3). Unknown currencies fall back to 2 for hints. */
export function minorDigits(currency: string): number {
  const e = currencyExponent(currency);
  return e.ok ? e.value : 2;
}

/** "1200.00" for a 2-digit currency, "1200" for a 0-digit one: the example used in amount messages (§5.6). */
export function amountExample(currency: string, decimal: "." | "," = "."): string {
  const d = minorDigits(currency);
  return d === 0 ? "1200" : `1200${decimal}${"0".repeat(d)}`;
}
