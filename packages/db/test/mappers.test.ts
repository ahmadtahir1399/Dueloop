import { describe, expect, it } from 'vitest';
import { customerRowToCtxCustomer, invoiceRowToCtxInvoice, policyRowToPolicy, tenantToSettings } from '../src/mappers.ts';

const tenant = { id: 't1', timezone: 'Asia/Karachi', quiet_start_hour: 21, quiet_end_hour: 8 };

describe('tenantToSettings', () => {
  it('maps hours and sorts holidays', () => {
    const r = tenantToSettings(tenant, [
      { tenant_id: 't1', on_date: '2026-12-25' },
      { tenant_id: 't1', on_date: '2026-08-14' },
    ]);
    expect(r).toEqual({
      ok: true,
      value: { timezone: 'Asia/Karachi', quietHours: { startHour: 21, endHour: 8 }, holidays: ['2026-08-14', '2026-12-25'] },
    });
  });
  it('rejects data core would reject (bad zone, bad hour)', () => {
    const r = tenantToSettings({ ...tenant, timezone: '+05:00', quiet_end_hour: 24 }, []);
    expect(r.ok ? [] : r.errors.map((e) => e.field)).toEqual(['timezone', 'quietHours.endHour']);
  });
  it('rejects holidays of another tenant', () => {
    expect(tenantToSettings(tenant, [{ tenant_id: 'other', on_date: '2026-01-01' }]).ok).toBe(false);
  });
});

describe('policyRowToPolicy', () => {
  const row = { escalate_after_days: 21, grace_days_after_promise: 2, max_messages_per_week: 3 };
  it('parses valid steps', () => {
    const steps = [{ id: 's1', daysAfterDue: 1, channel: 'email', templateKey: 'friendly' }];
    expect(policyRowToPolicy({ ...row, steps })).toEqual({
      ok: true,
      value: { steps, escalateAfterDays: 21, graceDaysAfterPromise: 2, maxMessagesPerWeek: 3 },
    });
  });
  it.each([
    ['not an array', { id: 's1' }],
    ['fractional day', [{ id: 's1', daysAfterDue: 1.5, channel: 'email', templateKey: 't' }]],
    ['negative day', [{ id: 's1', daysAfterDue: -1, channel: 'email', templateKey: 't' }]],
    ['unknown channel', [{ id: 's1', daysAfterDue: 1, channel: 'fax', templateKey: 't' }]],
    ['missing template', [{ id: 's1', daysAfterDue: 1, channel: 'sms' }]],
    ['extra key', [{ id: 's1', daysAfterDue: 1, channel: 'sms', templateKey: 't', tone: 'x' }]],
    ['duplicate ids', [
      { id: 's1', daysAfterDue: 1, channel: 'sms', templateKey: 't' },
      { id: 's1', daysAfterDue: 2, channel: 'sms', templateKey: 't' },
    ]],
    ['null', null],
  ])('rejects %s without throwing', (_name, steps) => {
    const r = policyRowToPolicy({ ...row, steps });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.field.startsWith('steps')).toBe(true);
  });
});

describe('invoiceRowToCtxInvoice / customerRowToCtxCustomer', () => {
  it('maps an invoice, omitting promisedOn when null', () => {
    expect(invoiceRowToCtxInvoice({ id: 'i1', status: 'overdue', due_on: '2026-03-01', promised_on: null })).toEqual({
      ok: true,
      value: { id: 'i1', status: 'overdue', dueOn: '2026-03-01' },
    });
    expect(invoiceRowToCtxInvoice({ id: 'i1', status: 'promised', due_on: '2026-03-01', promised_on: '2026-03-10' })).toEqual({
      ok: true,
      value: { id: 'i1', status: 'promised', dueOn: '2026-03-01', promisedOn: '2026-03-10' },
    });
  });
  it('rejects an unknown status', () => {
    expect(invoiceRowToCtxInvoice({ id: 'i1', status: 'lost', due_on: '2026-03-01', promised_on: null }).ok).toBe(false);
  });
  it('maps opt-out', () => {
    expect(customerRowToCtxCustomer({ opted_out: true })).toEqual({ optedOut: true });
  });
});
