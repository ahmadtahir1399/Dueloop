import { currencyExponent, type Policy } from '@dueloop/core';
import { DateTime } from 'luxon';
import { BEHAVIOURS, type Behaviour, type Customer, type ExternalEvent, type SimInvoice, type Tenant } from './model.ts';
import type { Rng } from './prng.ts';

const standard = (maxMessagesPerWeek: number): Policy => ({
  steps: [
    { id: 's1', daysAfterDue: 1, channel: 'email', templateKey: 'friendly' },
    { id: 's2', daysAfterDue: 4, channel: 'whatsapp', templateKey: 'nudge' },
    { id: 's3', daysAfterDue: 10, channel: 'sms', templateKey: 'firm' },
    { id: 's4', daysAfterDue: 18, channel: 'email', templateKey: 'final' },
  ],
  escalateAfterDays: 30,
  graceDaysAfterPromise: 2,
  maxMessagesPerWeek,
});

const gentle = (maxMessagesPerWeek: number): Policy => ({
  steps: [
    { id: 's1', daysAfterDue: 3, channel: 'email', templateKey: 'friendly' },
    { id: 's2', daysAfterDue: 10, channel: 'email', templateKey: 'nudge' },
    { id: 's3', daysAfterDue: 21, channel: 'whatsapp', templateKey: 'final' },
  ],
  escalateAfterDays: 40,
  graceDaysAfterPromise: 3,
  maxMessagesPerWeek,
});

/** Mixed tenants: DST zones in both directions, +05:30, +05:45, two NON-wrapping quiet windows, 0/2/3-decimal currencies. */
export const TENANTS: readonly Tenant[] = [
  { id: 't-nyc', currency: 'USD', settings: { timezone: 'America/New_York', quietHours: { startHour: 20, endHour: 9 }, holidays: ['2026-02-16', '2026-05-25'] }, policy: standard(2) },
  { id: 't-ldn', currency: 'GBP', settings: { timezone: 'Europe/London', quietHours: { startHour: 21, endHour: 8 }, holidays: ['2026-04-03', '2026-04-06'] }, policy: gentle(3) },
  { id: 't-del', currency: 'INR', settings: { timezone: 'Asia/Kolkata', quietHours: { startHour: 0, endHour: 8 }, holidays: ['2026-03-04'] }, policy: standard(3) },
  { id: 't-ktm', currency: 'NPR', settings: { timezone: 'Asia/Kathmandu', quietHours: { startHour: 13, endHour: 15 }, holidays: ['2026-02-26'] }, policy: gentle(2) },
  { id: 't-kwi', currency: 'KWD', settings: { timezone: 'Asia/Kuwait', quietHours: { startHour: 22, endHour: 9 }, holidays: ['2026-02-25', '2026-02-26'] }, policy: standard(3) },
  { id: 't-tyo', currency: 'JPY', settings: { timezone: 'Asia/Tokyo', quietHours: { startHour: 19, endHour: 10 }, holidays: ['2026-03-20', '2026-04-29'] }, policy: gentle(3) },
];

/** Invoice size range per currency, in MAJOR units. */
const RANGE: Readonly<Record<string, readonly [number, number]>> = {
  USD: [50, 5000],
  GBP: [40, 4000],
  INR: [2000, 200000],
  NPR: [5000, 500000],
  KWD: [15, 1500],
  JPY: [5000, 500000],
};

const WEIGHTS: Readonly<Record<Behaviour, number>> = {
  early_payer: 10,
  pays_after_reminder: 25,
  pays_in_instalments: 8,
  promise_keep: 12,
  promise_break: 10,
  disputes: 7,
  opts_out: 6,
  never_pays: 22,
};

function weightedBehaviour(rng: Rng): Behaviour {
  const total = BEHAVIOURS.reduce((s, b) => s + WEIGHTS[b], 0);
  let x = rng.next() * total;
  for (const b of BEHAVIOURS) {
    x -= WEIGHTS[b];
    if (x < 0) return b;
  }
  return 'never_pays';
}

function amountMinor(rng: Rng, currency: string): number {
  const exp = currencyExponent(currency);
  const [lo, hi] = RANGE[currency] ?? [1, 1000];
  const unit = 10 ** (exp.ok ? exp.value : 0);
  return rng.int(lo, hi) * unit + rng.int(0, unit - 1);
}

export interface Scenario {
  readonly tenants: ReadonlyMap<string, Tenant>;
  readonly customers: Map<string, Customer>;
  readonly invoices: SimInvoice[];
  readonly initialEvents: ExternalEvent[];
}

const HOUR = 3600_000;
const pad = (n: number, w: number) => String(n).padStart(w, '0');

export function generateScenario(rng: Rng, invoiceCount: number, start: number): Scenario {
  const tenants = new Map(TENANTS.map((t) => [t.id, t]));
  const customers = new Map<string, Customer>();
  const customerCount = Math.max(1, Math.round(invoiceCount * 0.4));
  for (let i = 0; i < customerCount; i++) {
    const tenant = TENANTS[i % TENANTS.length] ?? TENANTS[0];
    if (!tenant) break;
    const id = `cus-${pad(i + 1, 4)}`;
    customers.set(id, {
      id,
      tenantId: tenant.id,
      behaviour: weightedBehaviour(rng),
      k: rng.int(1, 3),
      delayHours: rng.int(1, 60),
      optedOut: false,
      sentAt: [],
    });
  }

  const customerList = [...customers.values()];
  const invoices: SimInvoice[] = [];
  const initialEvents: ExternalEvent[] = [];
  let seq = 0;
  for (let i = 0; i < invoiceCount; i++) {
    const customer = rng.pick(customerList);
    const tenant = tenants.get(customer.tenantId);
    if (!tenant) continue;
    const zone = tenant.settings.timezone;
    const startLocal = DateTime.fromMillis(start, { zone }).startOf('day');
    const due = startLocal.plus({ days: rng.int(-20, 75) });
    const id = `inv-${pad(i + 1, 4)}`;
    invoices.push({
      id,
      tenantId: tenant.id,
      customerId: customer.id,
      total: { minor: amountMinor(rng, tenant.currency), currency: tenant.currency },
      dueOn: due.toFormat('yyyy-MM-dd'),
      status: 'open',
      promisedOn: undefined,
      paidMinor: 0,
      sentStepIds: [],
      escalated: false,
      remindersSent: 0,
      nextActionAt: start,
    });
    if (customer.behaviour === 'early_payer') {
      const payAt = due.minus({ days: rng.int(0, 3) }).set({ hour: 12 }).toMillis();
      initialEvents.push({ at: Math.max(payAt, start + customer.delayHours * HOUR), seq: seq++, kind: 'payment', invoiceId: id });
    }
    if (rng.chance(0.03)) {
      initialEvents.push({ at: start + rng.int(1, 30 * 24) * HOUR, seq: seq++, kind: 'void', invoiceId: id });
    }
  }
  return { tenants, customers, invoices, initialEvents };
}
