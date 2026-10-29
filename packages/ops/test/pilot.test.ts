// Pilot report against hand-computed snapshots (same numbers as supabase/tests/ops/pilot.test.sql).
import { describe, expect, it } from 'vitest';
import { pilotReport, reportCsv, REPORT_LIMITS, type KpiSnapshot } from '../src/pilot.ts';

const base: KpiSnapshot = {
  kind: 'baseline',
  taken_at: '2026-03-31T18:00:00Z',
  period_from: '2026-03-01',
  period_to: '2026-03-31',
  kpis: { overdue: [{ currency: 'INR', invoices: 2, balance: '14000' }], recovered: [], days_to_pay: null, promises: null, messages: [{ purpose: 'reminder', channel: 'email', sent: 3, cost_minor: '0' }] },
  client_reported: { staff_hours_per_week: 6 },
};
const now: KpiSnapshot = {
  kind: 'periodic',
  taken_at: '2026-04-30T12:00:00Z',
  period_from: '2026-04-01',
  period_to: '2026-04-30',
  kpis: {
    overdue: [{ currency: 'INR', invoices: 1, balance: '4000' }],
    recovered: [{ currency: 'INR', recovered: '10000', receipts: 1, credit: '0' }],
    days_to_pay: { invoices: 1, avg_days_to_pay: 31, avg_days_after_due: 17 },
    promises: { kept: 1, broken: 1, rate: 0.5 },
    messages: [{ purpose: 'reminder', channel: 'email', sent: 5, cost_minor: '0' }, { purpose: 'reminder', channel: 'whatsapp', sent: 2, cost_minor: '120' }],
  },
  client_reported: { staff_hours_per_week: 2.5 },
};

describe('pilot report', () => {
  const rows = pilotReport(base, now);
  const row = (m: string) => rows.find((r) => r.metric === m);
  it('baseline versus now, money formatted by core per currency (INR has 2 decimals)', () => {
    expect(row('overdue balance (INR)')).toMatchObject({ baseline: '140.00 INR', now: '40.00 INR', change: '-100.00 INR', source: 'system' });
    expect(row('overdue invoices (INR)')).toMatchObject({ baseline: '2', now: '1', change: '-1' });
    expect(row('recovered in the period (INR)')).toMatchObject({ baseline: '0.00 INR', now: '100.00 INR', change: '+100.00 INR' });
  });
  it('undefined rates stay undefined (never 0)', () => {
    expect(row('promise-kept rate (kept / resolved)')).toMatchObject({ baseline: 'n/a', now: '0.5', change: 'n/a' });
    expect(row('average days to pay')).toMatchObject({ baseline: 'n/a', now: '31' });
  });
  it('messages and cost', () => {
    expect(row('messages sent')).toMatchObject({ baseline: '3', now: '7', change: '+4' });
    expect(row('message cost (minor units of the budget currency)')).toMatchObject({ now: '120', change: '+120' });
  });
  it('client-reported fields are labelled as such', () => {
    expect(row('staff hours per week')).toEqual({ metric: 'staff hours per week', baseline: '6', now: '2.5', change: '-3.5', source: 'client-reported' });
  });
  it('the CSV neutralises formulas and carries the limits', () => {
    const csv = reportCsv([...rows, { metric: '=HYPERLINK("http://evil.example")', baseline: '+1', now: '-2', change: '@x', source: 'client-reported' }]);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.example"")"`);
    expect(csv).toContain(`"'+1"`);
    expect(csv).not.toMatch(/(^|,)"[=+\-@]/m);
    for (const l of REPORT_LIMITS) expect(csv).toContain(l.slice(0, 30));
    expect(csv).toContain('written permission');
  });
  it('amounts beyond 2^53 keep every digit', () => {
    const big = pilotReport({ ...base, kpis: { overdue: [{ currency: 'INR', invoices: 1, balance: '90071992547409930' }] } }, { ...now, kpis: { overdue: [{ currency: 'INR', invoices: 1, balance: '90071992547409931' }] } });
    expect(big[0]?.change).toBe('+0.01 INR');
  });
});
