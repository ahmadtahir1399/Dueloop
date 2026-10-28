import { INVOICE_STATUSES, toMajorString } from '@dueloop/core';
import { DateTime } from 'luxon';
import { maxPerCustomerPerWeek } from './checker.ts';
import type { SimResult } from './engine.ts';

const iso = (ms: number) => DateTime.fromMillis(ms, { zone: 'UTC' }).toFormat("yyyy-MM-dd'T'HH:mm'Z'");
const sortedEntries = <V>(m: ReadonlyMap<string, V>) => [...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

export interface Summary {
  readonly seed: number;
  readonly days: number;
  readonly invoices: number;
  readonly start: string;
  readonly tenants: readonly { id: string; timezone: string; currency: string; quietHours: string }[];
  readonly byStatus: Readonly<Record<string, number>>;
  readonly remindersPerStep: Readonly<Record<string, number>>;
  readonly remindersTotal: number;
  readonly promises: { made: number; kept: number; broken: number };
  readonly escalations: number;
  readonly disputes: number;
  readonly optOuts: number;
  readonly partialPayments: number;
  readonly replyTasks: number;
  readonly reminderBlocks: number;
  readonly recovered: Readonly<Record<string, string>>;
  readonly maxMessagesToOneCustomerIn7Days: { count: number; customerId: string | null };
  readonly evaluations: number;
  readonly violations: { total: number; byKind: Readonly<Record<string, number>>; first: readonly string[] };
}

export function summarize(r: SimResult): Summary {
  const byStatus = Object.fromEntries(INVOICE_STATUSES.map((s) => [s, r.invoices.filter((i) => i.status === s).length]));
  const byKind: Record<string, number> = {};
  for (const v of r.violations) byKind[v.kind] = (byKind[v.kind] ?? 0) + 1;
  return {
    seed: r.options.seed,
    days: r.options.days,
    invoices: r.options.invoices,
    start: r.options.start,
    tenants: sortedEntries(r.tenants).map(([id, t]) => ({
      id,
      timezone: t.settings.timezone,
      currency: t.currency,
      quietHours: `${t.settings.quietHours.startHour}->${t.settings.quietHours.endHour}`,
    })),
    byStatus,
    remindersPerStep: Object.fromEntries(sortedEntries(r.stats.remindersPerStep)),
    remindersTotal: r.sends.length,
    promises: { made: r.stats.promisesMade, kept: r.stats.promisesKept, broken: r.stats.promisesBroken },
    escalations: r.stats.escalations,
    disputes: r.stats.disputes,
    optOuts: r.stats.optOuts,
    partialPayments: r.stats.partialPayments,
    replyTasks: r.stats.replyTasks,
    reminderBlocks: r.stats.reminderBlocks,
    recovered: Object.fromEntries(
      sortedEntries(r.stats.recoveredMinor).map(([cur, minor]) => {
        const s = toMajorString({ minor, currency: cur });
        return [cur, s.ok ? s.value : `${minor} minor`];
      }),
    ),
    maxMessagesToOneCustomerIn7Days: maxPerCustomerPerWeek(r.sends),
    evaluations: r.stats.evaluations,
    violations: {
      total: r.violations.length,
      byKind,
      first: r.violations.slice(0, 20).map((v) => `${iso(v.at)} ${v.kind} ${v.invoiceId}: ${v.detail}`),
    },
  };
}

const row = (label: string, value: string | number) => `  ${label.padEnd(26)}${String(value).padStart(14)}`;

export function formatText(s: Summary): string {
  const lines = [
    `Dueloop simulator  seed=${s.seed} days=${s.days} invoices=${s.invoices} start=${s.start}`,
    '',
    'Tenants',
    ...s.tenants.map((t) => `  ${t.id.padEnd(8)}${t.timezone.padEnd(20)}${t.currency.padEnd(5)}quiet ${t.quietHours}`),
    '',
    'Invoices by final status',
    ...Object.entries(s.byStatus).map(([k, v]) => row(k, v)),
    '',
    'Reminders sent per step',
    ...Object.entries(s.remindersPerStep).map(([k, v]) => row(k, v)),
    row('total', s.remindersTotal),
    '',
    'Outcomes',
    row('promises made', s.promises.made),
    row('promises kept', s.promises.kept),
    row('promises broken', s.promises.broken),
    row('escalations', s.escalations),
    row('disputes', s.disputes),
    row('opt-outs', s.optOuts),
    row('partial payments', s.partialPayments),
    row('reply tasks (human)', s.replyTasks),
    row('reminder blocks', s.reminderBlocks),
    '',
    'Amount recovered',
    ...Object.entries(s.recovered).map(([k, v]) => row(k, v)),
    '',
    row('max msgs/customer/7 days', s.maxMessagesToOneCustomerIn7Days.count),
    row('decide() evaluations', s.evaluations),
    '',
    `Invariant violations: ${s.violations.total}`,
    ...Object.entries(s.violations.byKind).map(([k, v]) => row(k, v)),
    ...s.violations.first.map((l) => `  ${l}`),
  ];
  return `${lines.join('\n')}\n`;
}

export function traceLines(r: SimResult, invoiceId: string): string[] | null {
  const entries = r.timeline.get(invoiceId);
  const inv = r.invoices.find((i) => i.id === invoiceId);
  if (!entries || !inv) return null;
  const zone = r.tenants.get(inv.tenantId)?.settings.timezone ?? 'UTC';
  return entries.map((e) => {
    const local = DateTime.fromMillis(e.at, { zone }).toFormat('yyyy-MM-dd HH:mm');
    return `${iso(e.at)}  (${local} local)  ${e.type}${e.detail === undefined ? '' : `  ${e.detail}`}`;
  });
}

export function formatTrace(r: SimResult, invoiceId: string): string {
  const lines = traceLines(r, invoiceId);
  if (!lines) return `No invoice ${invoiceId}\n`;
  const inv = r.invoices.find((i) => i.id === invoiceId);
  return [`Trace ${invoiceId} (tenant ${inv?.tenantId}, customer ${inv?.customerId}, final ${inv?.status})`, ...lines.map((l) => `  ${l}`)].join('\n') + '\n';
}
