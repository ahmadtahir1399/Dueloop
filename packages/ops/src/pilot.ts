// Pilot report (prompt 7 step 11, issue P): a stored baseline snapshot versus a later one. Pure: snapshots in,
// rows out. Money stays in minor units as text until core formats it (rules 3, 38); no FX between currencies.
import { digitsToMajorString } from '@dueloop/core';
import { neutraliseCell } from '@dueloop/ingest';

export interface KpiSnapshot {
  kind: 'baseline' | 'periodic';
  taken_at: string;
  period_from: string;
  period_to: string;
  kpis: {
    overdue?: { currency: string; invoices: number; balance: string }[];
    recovered?: { currency: string; recovered: string; receipts: number; credit: string }[];
    days_to_pay?: { invoices: number; avg_days_to_pay: number | null; avg_days_after_due: number | null } | null;
    promises?: { kept: number; broken: number; rate: number | null } | null;
    messages?: { purpose: string; channel: string; sent: number; cost_minor: string }[];
  };
  client_reported: Record<string, string | number>;
}

export interface ReportRow {
  metric: string;
  baseline: string;
  now: string;
  change: string;
  source: 'system' | 'client-reported';
}

export const REPORT_LIMITS = [
  'A before/after comparison, not proof that this software caused the change: payment behaviour also moves with season, customers, prices and the business itself.',
  'The baseline period was chosen by whoever took the snapshot; another period can give different numbers.',
  'Client-reported rows are what the client typed in; the system cannot check them.',
  'Amounts are per currency; there is no conversion between currencies.',
  'Do not publish any of this without the client\'s written permission and without removing anything that identifies them or their customers.',
];

const money = (digits: string, currency: string): string => {
  const negative = digits.startsWith('-');
  const r = digitsToMajorString(negative ? digits.slice(1) : digits, currency);
  return r.ok ? `${negative ? '-' : ''}${r.value} ${currency}` : `${digits} (minor units, ${currency})`;
};
const diffDigits = (a: string, b: string) => (BigInt(b) - BigInt(a)).toString();
const signed = (s: string) => (s.startsWith('-') || s === '0' ? s : `+${s}`);
const num = (v: number | null | undefined) => (v === null || v === undefined ? 'n/a' : String(v));
const numChange = (a: number | null | undefined, b: number | null | undefined) =>
  a === null || a === undefined || b === null || b === undefined ? 'n/a' : signed(String(Math.round((b - a) * 10) / 10));

export function pilotReport(base: KpiSnapshot, now: KpiSnapshot): ReportRow[] {
  const rows: ReportRow[] = [];
  const currencies = [...new Set([...(base.kpis.overdue ?? []), ...(now.kpis.overdue ?? []), ...(base.kpis.recovered ?? []), ...(now.kpis.recovered ?? [])].map((x) => x.currency))].sort();
  for (const c of currencies) {
    const bo = base.kpis.overdue?.find((x) => x.currency === c);
    const no = now.kpis.overdue?.find((x) => x.currency === c);
    const d = diffDigits(bo?.balance ?? '0', no?.balance ?? '0');
    rows.push({ metric: `overdue balance (${c})`, baseline: money(bo?.balance ?? '0', c), now: money(no?.balance ?? '0', c), change: `${d.startsWith('-') ? '' : '+'}${money(d, c)}`, source: 'system' });
    rows.push({ metric: `overdue invoices (${c})`, baseline: String(bo?.invoices ?? 0), now: String(no?.invoices ?? 0), change: signed(String((no?.invoices ?? 0) - (bo?.invoices ?? 0))), source: 'system' });
    const br = base.kpis.recovered?.find((x) => x.currency === c)?.recovered ?? '0';
    const nr = now.kpis.recovered?.find((x) => x.currency === c)?.recovered ?? '0';
    const rd = diffDigits(br, nr);
    rows.push({ metric: `recovered in the period (${c})`, baseline: money(br, c), now: money(nr, c), change: `${rd.startsWith('-') ? '' : '+'}${money(rd, c)}`, source: 'system' });
  }
  rows.push({ metric: 'average days to pay', baseline: num(base.kpis.days_to_pay?.avg_days_to_pay), now: num(now.kpis.days_to_pay?.avg_days_to_pay), change: numChange(base.kpis.days_to_pay?.avg_days_to_pay, now.kpis.days_to_pay?.avg_days_to_pay), source: 'system' });
  rows.push({ metric: 'promise-kept rate (kept / resolved)', baseline: num(base.kpis.promises?.rate), now: num(now.kpis.promises?.rate), change: numChange(base.kpis.promises?.rate, now.kpis.promises?.rate), source: 'system' });
  const sent = (s: KpiSnapshot) => (s.kpis.messages ?? []).reduce((a, m) => a + m.sent, 0);
  const cost = (s: KpiSnapshot) => (s.kpis.messages ?? []).reduce((a, m) => a + BigInt(m.cost_minor), 0n).toString();
  rows.push({ metric: 'messages sent', baseline: String(sent(base)), now: String(sent(now)), change: signed(String(sent(now) - sent(base))), source: 'system' });
  rows.push({ metric: 'message cost (minor units of the budget currency)', baseline: cost(base), now: cost(now), change: signed(diffDigits(cost(base), cost(now))), source: 'system' });
  for (const key of [...new Set([...Object.keys(base.client_reported), ...Object.keys(now.client_reported)])].sort()) {
    const a = base.client_reported[key];
    const b = now.client_reported[key];
    rows.push({ metric: key.replace(/_/g, ' '), baseline: a === undefined ? 'n/a' : String(a), now: b === undefined ? 'n/a' : String(b), change: typeof a === 'number' && typeof b === 'number' ? numChange(a, b) : 'n/a', source: 'client-reported' });
  }
  return rows;
}

/** CSV with every cell neutralised against spreadsheet formulas (rule 14), the limits as trailing rows. */
export function reportCsv(rows: readonly ReportRow[]): string {
  const line = (cells: readonly string[]) => cells.map(neutraliseCell).join(',');
  return [line(['metric', 'baseline', 'now', 'change', 'source']), ...rows.map((r) => line([r.metric, r.baseline, r.now, r.change, r.source])), '', ...REPORT_LIMITS.map((l) => line([`limit: ${l}`]))].join('\r\n');
}
