// Budget semantics (issue H, ADR 0018): tenants.monthly_message_budget_minor applies to PAID channels only
// (whatsapp, sms), in the tenant's currency minor units. 0 = paid channels blocked. Email is not budgeted.
// The month boundary is the tenant's local calendar month.
import type { Channel } from '@dueloop/core';
import { DateTime } from 'luxon';

/** Documented per-message cost in tenant-currency minor units (a placeholder until real provider pricing). */
export const COST_MINOR: Readonly<Record<Channel, number>> = { email: 0, whatsapp: 10, sms: 10 };

export const isPaidChannel = (channel: Channel) => COST_MINOR[channel] > 0;

/** Start of the tenant-local calendar month containing `at`, as a UTC instant. */
export function monthStart(at: Date, timezone: string): Date {
  return DateTime.fromJSDate(at).setZone(timezone).startOf('month').toJSDate();
}

export type BudgetCheck = { readonly ok: true; readonly cost: number } | { readonly ok: false; readonly reason: 'budget_exhausted'; readonly cost: number };

export function checkBudget(channel: Channel, budgetMinor: number, spentThisMonthMinor: number): BudgetCheck {
  const cost = COST_MINOR[channel];
  if (cost === 0) return { ok: true, cost };
  return spentThisMonthMinor + cost <= budgetMinor ? { ok: true, cost } : { ok: false, reason: 'budget_exhausted', cost };
}
