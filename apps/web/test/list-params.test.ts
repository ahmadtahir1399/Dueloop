// §4.10 rule 6: list params are parsed with Zod on the server; bad or unknown values fall back to defaults and never
// throw. Values come from the core enums (no duplicated lists).
import { INVOICE_STATUSES } from '@dueloop/core';
import { describe, expect, it } from 'vitest';
import { countText } from '../features/lists/count-text.ts';
import { nextQuery, queryOf, withQuery } from '../features/lists/query.ts';
import { CustomerListParams, InvoiceListParams, OverviewParams, ProofListParams, TaskListParams } from '../domain/list-params.ts';

describe('list params (URL is the source of truth)', () => {
  it('invoices: valid values pass through', () => {
    const p = InvoiceListParams.parse({ q: ' north ', status: 'overdue', bucket: '31-60', customer: '5eed0000-0000-4000-8000-00000000000a', after: '2026-11-01_5eed0000-0000-4000-8000-00000000000a' });
    expect(p).toEqual({ q: 'north', status: 'overdue', bucket: '31-60', customer: '5eed0000-0000-4000-8000-00000000000a', after: '2026-11-01_5eed0000-0000-4000-8000-00000000000a' });
  });
  it('invoices: every core status is accepted', () => {
    for (const s of INVOICE_STATUSES) expect(InvoiceListParams.parse({ status: s }).status).toBe(s);
  });
  it('invoices: bad, repeated or missing values fall back, never throw', () => {
    expect(InvoiceListParams.parse({})).toEqual({ q: undefined, status: 'all', bucket: 'all', customer: undefined, after: undefined });
    const p = InvoiceListParams.parse({ status: 'bogus', bucket: ['1-30', '31-60'], customer: 'not-a-uuid', q: 'x'.repeat(500), after: ['a', 'b'] });
    expect(p).toEqual({ q: undefined, status: 'all', bucket: 'all', customer: undefined, after: undefined });
    expect(InvoiceListParams.parse({ q: '   ' }).q).toBeUndefined();
  });
  it('customers, tasks, proofs, overview fall back to their defaults', () => {
    expect(CustomerListParams.parse({ opted_out: 'yes' }).opted_out).toBeUndefined();
    expect(CustomerListParams.parse({ opted_out: '1' }).opted_out).toBe('1');
    expect(TaskListParams.parse({ status: 'deleted' }).status).toBe('open');
    expect(TaskListParams.parse({ status: 'resolved' }).status).toBe('resolved');
    expect(ProofListParams.parse({ status: 'x' }).status).toBe('pending');
    expect(OverviewParams.parse({ period: 'forever' }).period).toBe('this_month');
    expect(OverviewParams.parse({ period: 'last_90' }).period).toBe('last_90');
  });
});

describe('list URLs (§4.10 rules 1, 2, 11)', () => {
  it('sets and removes params; "all" and "" remove', () => {
    expect(nextQuery('q=north', { status: 'overdue' })).toBe('q=north&status=overdue');
    expect(nextQuery('q=north&status=overdue', { status: 'all' })).toBe('q=north');
    expect(nextQuery('q=north', { q: '' })).toBe('');
  });
  it('any filter change drops the cursor; paging itself keeps the filters', () => {
    expect(nextQuery('status=overdue&after=2026-11-01_x', { bucket: '1-30' })).toBe('status=overdue&bucket=1-30');
    expect(nextQuery('status=overdue', { after: 'c1' })).toBe('status=overdue&after=c1');
  });
  it('builds paths and reads server search params', () => {
    expect(withQuery('/invoices', '')).toBe('/invoices');
    expect(withQuery('/invoices', 'q=a')).toBe('/invoices?q=a');
    expect(queryOf({ q: 'a b', status: undefined, tag: ['x', 'y'] })).toBe('q=a+b&tag=x&tag=y');
  });
  it('announces counts honestly when only one page is loaded', () => {
    expect(countText(1, false, 'invoice')).toBe('1 invoice');
    expect(countText(18, false, 'invoice')).toBe('18 invoices');
    expect(countText(50, true, 'invoice')).toBe('Showing the first 50 invoices; more on the next page');
    expect(countText(0, false, 'invoice')).toBe('No invoices match');
  });
  it('does not say "match" on an unfiltered view, nor "next page" on a capped list without paging', () => {
    expect(countText(0, false, 'open task', { filtered: false })).toBe('No open tasks');
    expect(countText(200, true, 'open task', { paged: false })).toBe('Showing the first 200 open tasks');
  });
});
