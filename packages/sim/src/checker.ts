import { DateTime } from 'luxon';
import type { SendRecord, Tenant, Violation } from './model.ts';

const WEEK_MS = 7 * 24 * 3600 * 1000;

/**
 * Independent oracle for quiet hours. Deliberately NOT imported from core, so a
 * bug in core's isQuietHour/nextSendWindow cannot hide itself from the checker.
 */
function quietAt(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? start <= hour && hour < end : hour >= start || hour < end;
}

/**
 * Checks every outbound reminder against the invariants of guide Section 3.4.
 * Works only from the send log and tenant data; it never calls decide().
 */
/** `optOutAt`: when each customer opted out (prompt 4: opt-out is final, nothing may be sent afterwards). */
export function checkSends(sends: readonly SendRecord[], tenants: ReadonlyMap<string, Tenant>, optOutAt: ReadonlyMap<string, number> = new Map()): Violation[] {
  const violations: Violation[] = [];
  const keys = new Set<string>();
  const byCustomer = new Map<string, number[]>();

  for (const s of sends) {
    const tenant = tenants.get(s.tenantId);
    if (!tenant) {
      violations.push({ kind: 'no_contact_status', at: s.at, invoiceId: s.invoiceId, detail: `unknown tenant ${s.tenantId}` });
      continue;
    }
    const { timezone, quietHours, holidays } = tenant.settings;
    const local = DateTime.fromMillis(s.at, { zone: timezone });
    const v = (kind: Violation['kind'], detail: string) => violations.push({ kind, at: s.at, invoiceId: s.invoiceId, detail });

    if (quietAt(local.hour, quietHours.startHour, quietHours.endHour)) {
      v('quiet_hours', `${s.idempotencyKey} sent at ${local.toFormat('yyyy-MM-dd HH:mm')} ${timezone}`);
    }
    if (holidays.includes(local.toFormat('yyyy-MM-dd'))) {
      v('holiday', `${s.idempotencyKey} sent on holiday ${local.toFormat('yyyy-MM-dd')}`);
    }
    if (s.optedOutAtSend) v('opted_out', `${s.idempotencyKey} sent to opted-out ${s.customerId}`);
    if (['paid', 'written_off', 'cancelled', 'disputed'].includes(s.statusAtSend)) {
      v('no_contact_status', `${s.idempotencyKey} sent while ${s.statusAtSend}`);
    }
    // Prompt 4: a promised invoice is never reminded before promise date + grace (tenant-local dates).
    if (s.statusAtSend === 'promised' && s.promisedOnAtSend !== undefined) {
      const earliest = DateTime.fromISO(s.promisedOnAtSend, { zone: timezone }).plus({ days: tenant.policy.graceDaysAfterPromise }).toFormat('yyyy-MM-dd');
      if (local.toFormat('yyyy-MM-dd') < earliest) v('promised_too_early', `${s.idempotencyKey} sent before ${earliest} (promised ${s.promisedOnAtSend})`);
    }
    // A blocked invoice (open task) is never reminded inside its block.
    if (s.blockedUntilAtSend !== null && s.at < s.blockedUntilAtSend) v('blocked', `${s.idempotencyKey} sent inside a reminder block`);
    const out = optOutAt.get(s.customerId);
    if (out !== undefined && s.at > out) v('opt_out_not_final', `${s.idempotencyKey} sent after ${s.customerId} opted out`);
    if (keys.has(s.idempotencyKey)) v('duplicate_key', `${s.idempotencyKey} sent twice`);
    keys.add(s.idempotencyKey);

    // Weekly cap: in any window (t - 7 days, t] the customer gets at most maxMessagesPerWeek.
    const times = byCustomer.get(s.customerId) ?? [];
    times.push(s.at);
    byCustomer.set(s.customerId, times);
    const inWindow = times.filter((t) => t > s.at - WEEK_MS && t <= s.at).length;
    if (inWindow > tenant.policy.maxMessagesPerWeek) {
      v('weekly_cap', `${s.customerId} got ${inWindow} messages in 7 days (cap ${tenant.policy.maxMessagesPerWeek})`);
    }
  }
  return violations;
}

/** Largest number of reminders one customer received in any rolling 7-day window. */
export function maxPerCustomerPerWeek(sends: readonly SendRecord[]): { count: number; customerId: string | null } {
  const byCustomer = new Map<string, number[]>();
  for (const s of sends) {
    const list = byCustomer.get(s.customerId) ?? [];
    list.push(s.at);
    byCustomer.set(s.customerId, list);
  }
  let best = { count: 0, customerId: null as string | null };
  for (const [customerId, times] of [...byCustomer.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    times.sort((a, b) => a - b);
    let lo = 0;
    for (let hi = 0; hi < times.length; hi++) {
      const t = times[hi] ?? 0;
      while ((times[lo] ?? 0) <= t - WEEK_MS) lo++;
      if (hi - lo + 1 > best.count) best = { count: hi - lo + 1, customerId };
    }
  }
  return best;
}
