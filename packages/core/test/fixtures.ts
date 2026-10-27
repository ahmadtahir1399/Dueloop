import { DateTime } from 'luxon';
import type { Ctx, Policy, Settings } from '../src/domain/types.ts';

export const ZONE = 'Europe/London';

export const policy: Policy = {
  steps: [
    { id: 's1', daysAfterDue: 1, channel: 'email', templateKey: 'friendly' },
    { id: 's2', daysAfterDue: 7, channel: 'whatsapp', templateKey: 'firm' },
    { id: 's3', daysAfterDue: 14, channel: 'email', templateKey: 'final' },
  ],
  escalateAfterDays: 21,
  graceDaysAfterPromise: 2,
  maxMessagesPerWeek: 3,
};

export const settings: Settings = { timezone: ZONE, quietHours: { startHour: 20, endHour: 9 }, holidays: [] };

/** Tenant-local wall time -> Date. */
export const at = (iso: string, zone: string = ZONE): Date => DateTime.fromISO(iso, { zone }).toJSDate();

/** Date -> ISO string in the tenant zone, for readable assertions. */
export const local = (d: Date, zone: string = ZONE): string | null => DateTime.fromJSDate(d).setZone(zone).toISO();

type Overrides = {
  now?: Date;
  invoice?: Partial<Ctx['invoice']>;
  customer?: Partial<Ctx['customer']>;
  history?: Partial<Ctx['history']>;
  policy?: Partial<Policy>;
  settings?: Partial<Settings>;
};

export function ctx(o: Overrides = {}): Ctx {
  return {
    now: o.now ?? at('2026-06-02T10:30'),
    invoice: { id: 'inv-1', status: 'overdue', dueOn: '2026-06-01', ...o.invoice },
    customer: { optedOut: false, ...o.customer },
    history: { sentStepIds: [], sentAt: [], escalated: false, ...o.history },
    policy: { ...policy, ...o.policy },
    settings: { ...settings, ...o.settings },
  };
}
