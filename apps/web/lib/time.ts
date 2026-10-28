// Time display (rule 38, issue J). Every instant is shown in the TENANT's zone, never the browser's; dates
// (due_on, issued_on) are calendar dates and are shown as written. Periods are tenant-local days.
import { DateTime } from "luxon";

/** "28 Oct 2026, 14:05 (Europe/London)": the zone is part of the label so nobody guesses. */
export function formatInstant(iso: string | null | undefined, timezone: string): string {
  if (!iso) return "—";
  const dt = DateTime.fromISO(iso, { setZone: true }).setZone(timezone);
  return dt.isValid ? dt.toFormat("d LLL yyyy, HH:mm") : "—";
}

/** A calendar date (YYYY-MM-DD) shown as "1 Feb 2026", with no zone conversion. */
export function formatDate(date: string | null | undefined): string {
  if (!date) return "—";
  const dt = DateTime.fromISO(date, { zone: "UTC" });
  return dt.isValid ? dt.toFormat("d LLL yyyy") : "—";
}

/** Today's date in the tenant zone at the given instant. */
export function tenantToday(timezone: string, now: Date): string {
  return DateTime.fromJSDate(now, { zone: timezone }).toISODate() ?? "";
}

export type PeriodKey = "this_week" | "this_month" | "last_30" | "last_90";
export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "this_week", label: "This week" },
  { key: "this_month", label: "This month" },
  { key: "last_30", label: "Last 30 days" },
  { key: "last_90", label: "Last 90 days" },
];

/** An inclusive local-date period [from, to] in the tenant zone (ADR 0041). Weeks start on Monday (ISO). */
export function periodRange(key: PeriodKey, timezone: string, now: Date): { from: string; to: string } {
  const today = DateTime.fromJSDate(now, { zone: timezone }).startOf("day");
  const iso = (d: DateTime) => d.toISODate() ?? "";
  switch (key) {
    case "this_week":
      return { from: iso(today.startOf("week")), to: iso(today) };
    case "this_month":
      return { from: iso(today.startOf("month")), to: iso(today) };
    case "last_30":
      return { from: iso(today.minus({ days: 29 })), to: iso(today) };
    case "last_90":
      return { from: iso(today.minus({ days: 89 })), to: iso(today) };
  }
}

export function isPeriodKey(v: unknown): v is PeriodKey {
  return typeof v === "string" && PERIODS.some((p) => p.key === v);
}
