import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { transition } from '../src/domain/invoiceState.ts';
import { INVOICE_STATUSES, type InvoiceStatus } from '../src/domain/types.ts';
import { evaluatePromiseOnPayment, planPaymentOutcome, type PaymentPlanInput } from '../src/payment.ts';

const at = (iso: string) => new Date(iso);
const input = (over: Partial<PaymentPlanInput> = {}): PaymentPlanInput => ({
  invoice: { status: 'overdue', balanceMinor: 125050, currency: 'GBP' },
  receipt: { amountMinor: 125050, currency: 'GBP' },
  promise: null,
  paidAt: at('2026-10-20T10:00:00Z'),
  timezone: 'Europe/London',
  graceDays: 2,
  ...over,
});

describe('evaluatePromiseOnPayment (issue N)', () => {
  const s = { timezone: 'Europe/London', graceDays: 2 };
  it('fully paid by promise date + grace (end of that local day) => kept; later => not kept; partial => still active', () => {
    expect(evaluatePromiseOnPayment({ promisedOn: '2026-11-15' }, at('2026-11-17T23:59:59.999Z'), s, true)).toBe('kept'); // GMT in November
    expect(evaluatePromiseOnPayment({ promisedOn: '2026-11-15' }, at('2026-11-18T00:00:00Z'), s, true)).toBe('not_kept');
    expect(evaluatePromiseOnPayment({ promisedOn: '2026-11-15' }, at('2026-11-01T10:00:00Z'), s, false)).toBe('still_active');
  });
  it('the exact deadline instant counts as kept; one millisecond later does not', () => {
    // 17 Jun 2026 is BST (UTC+1): the local end of day is 22:59:59.999Z.
    expect(evaluatePromiseOnPayment({ promisedOn: '2026-06-15' }, at('2026-06-17T22:59:59.999Z'), s, true)).toBe('kept');
    expect(evaluatePromiseOnPayment({ promisedOn: '2026-06-15' }, at('2026-06-17T23:00:00.000Z'), s, true)).toBe('not_kept');
  });
  it('across DST: London springs forward 29 Mar 2026, New York falls back 1 Nov 2026', () => {
    expect(evaluatePromiseOnPayment({ promisedOn: '2026-03-27' }, at('2026-03-29T22:59:59.999Z'), s, true)).toBe('kept'); // deadline 29 Mar BST
    expect(evaluatePromiseOnPayment({ promisedOn: '2026-03-27' }, at('2026-03-29T23:00:00Z'), s, true)).toBe('not_kept');
    const ny = { timezone: 'America/New_York', graceDays: 0 };
    expect(evaluatePromiseOnPayment({ promisedOn: '2026-11-01' }, at('2026-11-02T04:59:59.999Z'), ny, true)).toBe('kept'); // EST after fall-back
    expect(evaluatePromiseOnPayment({ promisedOn: '2026-11-01' }, at('2026-11-02T05:00:00Z'), ny, true)).toBe('not_kept');
  });
  it('half-hour zones: Asia/Kolkata is UTC+5:30, Asia/Karachi UTC+5 (from tz data)', () => {
    const kol = { timezone: 'Asia/Kolkata', graceDays: 0 };
    expect(evaluatePromiseOnPayment({ promisedOn: '2026-10-20' }, at('2026-10-20T18:29:59.999Z'), kol, true)).toBe('kept');
    expect(evaluatePromiseOnPayment({ promisedOn: '2026-10-20' }, at('2026-10-20T18:30:00Z'), kol, true)).toBe('not_kept');
    const kar = { timezone: 'Asia/Karachi', graceDays: 0 };
    expect(evaluatePromiseOnPayment({ promisedOn: '2026-10-20' }, at('2026-10-20T18:59:59.999Z'), kar, true)).toBe('kept');
    expect(evaluatePromiseOnPayment({ promisedOn: '2026-10-20' }, at('2026-10-20T19:00:00Z'), kar, true)).toBe('not_kept');
  });
});

describe('planPaymentOutcome: the outcome table', () => {
  it('full payment => paid via the state machine, PaymentConfirmed, reminders stop, receipt', () => {
    expect(planPaymentOutcome(input())).toEqual({
      rejected: null,
      applied: 125050,
      credit: 0,
      transition: { event: 'balance_reached_zero', from: 'overdue', to: 'paid' },
      promiseOutcome: 'none',
      events: ['PaymentConfirmed'],
      tasks: [],
      alerts: ['invoice_paid'],
      sendReceipt: true,
      stopReminders: true,
    });
  });
  it('partial payment => balance reduced, status unchanged, PartialPaymentConfirmed, receipt', () => {
    expect(planPaymentOutcome(input({ receipt: { amountMinor: 50000, currency: 'GBP' } }))).toMatchObject({
      applied: 50000,
      credit: 0,
      transition: null,
      events: ['PartialPaymentConfirmed'],
      alerts: ['partial_payment'],
      sendReceipt: true,
      stopReminders: false,
    });
  });
  it('overpayment => paid + credit + task + alert', () => {
    expect(planPaymentOutcome(input({ receipt: { amountMinor: 200000, currency: 'GBP' } }))).toMatchObject({
      applied: 125050,
      credit: 74950,
      transition: { to: 'paid' },
      events: ['PaymentConfirmed', 'PaymentCreditCreated'],
      tasks: [{ type: 'overpayment_credit', urgent: false }],
      alerts: ['invoice_paid', 'overpayment'],
    });
  });
  it.each(['paid', 'written_off', 'cancelled'] as const)('payment on a %s invoice => applied 0, all credit, urgent task, no transition, no receipt', (status) => {
    expect(planPaymentOutcome(input({ invoice: { status, balanceMinor: status === 'paid' ? 0 : 125050, currency: 'GBP' } }))).toEqual({
      rejected: null,
      applied: 0,
      credit: 125050,
      transition: null,
      promiseOutcome: 'none',
      events: ['PaymentCreditCreated'],
      tasks: [{ type: 'payment_on_final_invoice', urgent: true }],
      alerts: ['payment_on_final_invoice'],
      sendReceipt: false,
      stopReminders: false,
    });
  });
  it('promise kept on time / not kept when late / still active on a partial payment', () => {
    const promised = { invoice: { status: 'promised' as const, balanceMinor: 125050, currency: 'GBP' }, promise: { promisedOn: '2026-10-25' } };
    expect(planPaymentOutcome(input({ ...promised, paidAt: at('2026-10-24T10:00:00Z') }))).toMatchObject({ promiseOutcome: 'kept', events: ['PaymentConfirmed', 'PromiseKept'] });
    expect(planPaymentOutcome(input({ ...promised, paidAt: at('2026-10-29T10:00:00Z') }))).toMatchObject({ promiseOutcome: 'not_kept', transition: { from: 'promised', to: 'paid' } });
    expect(planPaymentOutcome(input({ ...promised, receipt: { amountMinor: 1, currency: 'GBP' } }))).toMatchObject({ promiseOutcome: 'still_active', transition: null });
  });
  it('payment while disputed: paid per the state table, plus an alert (decision needed)', () => {
    expect(planPaymentOutcome(input({ invoice: { status: 'disputed', balanceMinor: 125050, currency: 'GBP' } }))).toMatchObject({
      transition: { from: 'disputed', to: 'paid' },
      alerts: ['invoice_paid', 'payment_while_disputed'],
    });
  });
  it('another currency or a non-positive amount => rejected, nothing applied (never silently converted)', () => {
    expect(planPaymentOutcome(input({ receipt: { amountMinor: 125050, currency: 'EUR' } }))).toMatchObject({ rejected: 'currency_mismatch', applied: 0, credit: 0, sendReceipt: false });
    expect(planPaymentOutcome(input({ receipt: { amountMinor: 0, currency: 'GBP' } }))).toMatchObject({ rejected: 'non_positive_amount', applied: 0 });
    expect(planPaymentOutcome(input({ receipt: { amountMinor: 1.5, currency: 'GBP' } }))).toMatchObject({ rejected: 'non_positive_amount' });
  });
  it('JPY (0 decimals), USD (2), KWD (3): amounts are integers in minor units, no scaling', () => {
    for (const [currency, balance, paid] of [['JPY', 15000, 15000], ['USD', 1099, 500], ['KWD', 12345, 20000]] as const) {
      const p = planPaymentOutcome(input({ invoice: { status: 'overdue', balanceMinor: balance, currency }, receipt: { amountMinor: paid, currency } }));
      expect(p.applied + p.credit).toBe(paid);
      expect(p.applied).toBe(Math.min(paid, balance));
    }
  });
});

describe('planPaymentOutcome: properties', () => {
  const arb: fc.Arbitrary<PaymentPlanInput> = fc.record({
    invoice: fc.record({ status: fc.constantFrom(...INVOICE_STATUSES), balanceMinor: fc.integer({ min: 0, max: 10_000_000 }), currency: fc.constantFrom('GBP', 'JPY', 'KWD') }),
    receipt: fc.record({ amountMinor: fc.integer({ min: -5, max: 20_000_000 }), currency: fc.constantFrom('GBP', 'JPY', 'KWD') }),
    promise: fc.option(fc.record({ promisedOn: fc.date({ min: new Date('2026-01-01'), max: new Date('2026-12-31'), noInvalidDate: true }).map((d) => d.toISOString().slice(0, 10)) })),
    paidAt: fc.date({ min: new Date('2026-01-01'), max: new Date('2027-01-31'), noInvalidDate: true }),
    timezone: fc.constantFrom('Europe/London', 'America/New_York', 'Asia/Kolkata', 'Asia/Karachi'),
    graceDays: fc.integer({ min: 0, max: 7 }),
  });

  it('accepted plans: applied + credit == amount, applied <= balance, balance never negative', () => {
    fc.assert(
      fc.property(arb, (i) => {
        const p = planPaymentOutcome(i);
        if (p.rejected) return p.applied === 0 && p.credit === 0;
        return p.applied + p.credit === i.receipt.amountMinor && p.applied <= i.invoice.balanceMinor && i.invoice.balanceMinor - p.applied >= 0 && p.applied >= 0 && p.credit >= 0;
      }),
    );
  });
  it('final invoices get applied 0 and are never moved', () => {
    fc.assert(
      fc.property(arb, (i) => {
        if (!['paid', 'written_off', 'cancelled'].includes(i.invoice.status)) return true;
        const p = planPaymentOutcome(i);
        return p.applied === 0 && p.transition === null;
      }),
    );
  });
  it('status becomes paid iff the balance reaches 0, and only through a legal state-machine transition', () => {
    fc.assert(
      fc.property(arb, (i) => {
        const p = planPaymentOutcome(i);
        const reachesZero = !p.rejected && p.applied > 0 && i.invoice.balanceMinor - p.applied === 0;
        if (!p.transition) return !reachesZero || !transition(i.invoice.status as InvoiceStatus, 'balance_reached_zero').ok;
        const t = transition(i.invoice.status as InvoiceStatus, p.transition.event);
        return reachesZero && t.ok && t.to === 'paid' && p.transition.to === 'paid';
      }),
    );
  });
  it('same input => same plan', () => {
    fc.assert(fc.property(arb, (i) => JSON.stringify(planPaymentOutcome(i)) === JSON.stringify(planPaymentOutcome(i))));
  });
});
