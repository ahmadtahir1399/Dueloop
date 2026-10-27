// Display formatting happens only at the edge (guide 3.2). Amounts stay integer minor units until here,
// and are handed to Intl as an exact decimal string (never divided as a float).
import { currencyExponent, toMajorString } from "@dueloop/core";
import { DateTime } from "luxon";

export function formatMoney(minor: number, currency: string): string {
  const major = toMajorString({ minor: Math.abs(minor), currency });
  const exp = currencyExponent(currency);
  if (!major.ok || !exp.ok) return `${minor} ${currency} (minor units)`;
  const text = new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    minimumFractionDigits: exp.value,
    maximumFractionDigits: exp.value,
  }).format(major.value as Intl.StringNumericLiteral);
  return minor < 0 ? `-${text}` : text;
}

/** Whole calendar days past due, in the tenant's time zone (0 or negative = not yet due). */
export function daysOverdue(dueOn: string, timezone: string): number {
  const today = DateTime.now().setZone(timezone).startOf("day");
  const due = DateTime.fromISO(dueOn, { zone: timezone }).startOf("day");
  return Math.round(today.diff(due, "days").days);
}

export type AgeingBucket = "not_due" | "1-30" | "31-60" | "61-90" | "90+";

export function ageingBucket(days: number): AgeingBucket {
  if (days <= 0) return "not_due";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

export function formatDate(iso: string): string {
  return DateTime.fromISO(iso, { zone: "UTC" }).toFormat("d LLL yyyy");
}

export function formatTimestamp(iso: string, timezone: string): string {
  return DateTime.fromISO(iso).setZone(timezone).toFormat("d LLL yyyy, HH:mm");
}
