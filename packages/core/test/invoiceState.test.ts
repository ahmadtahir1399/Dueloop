import { describe, expect, it } from 'vitest';
import { INVOICE_EVENTS, TRANSITIONS, transition, type InvoiceEvent } from '../src/domain/invoiceState.ts';
import { INVOICE_STATUSES, type InvoiceStatus } from '../src/domain/types.ts';

// Hand-written from guide Section 3.3, independent of the TRANSITIONS table.
// null = rejected.
const E: Record<InvoiceStatus, Record<InvoiceEvent, InvoiceStatus | null>> = {
  open: {
    due_date_passed: 'overdue',
    promise_accepted: null,
    promise_broken: null,
    dispute_raised: 'disputed',
    escalation_triggered: null,
    balance_reached_zero: 'paid',
    written_off: null,
    voided: 'cancelled',
  },
  overdue: {
    due_date_passed: null,
    promise_accepted: 'promised',
    promise_broken: null,
    dispute_raised: 'disputed',
    escalation_triggered: 'escalated',
    balance_reached_zero: 'paid',
    written_off: null,
    voided: null,
  },
  promised: {
    due_date_passed: null,
    promise_accepted: null,
    promise_broken: 'overdue',
    dispute_raised: 'disputed',
    escalation_triggered: 'escalated',
    balance_reached_zero: 'paid',
    written_off: null,
    voided: null,
  },
  disputed: {
    due_date_passed: null,
    promise_accepted: null,
    promise_broken: null,
    dispute_raised: null,
    escalation_triggered: null,
    balance_reached_zero: 'paid',
    written_off: null,
    voided: null,
  },
  escalated: {
    due_date_passed: null,
    promise_accepted: null,
    promise_broken: null,
    dispute_raised: 'disputed',
    escalation_triggered: null,
    balance_reached_zero: 'paid',
    written_off: 'written_off',
    voided: null,
  },
  paid: {
    due_date_passed: null,
    promise_accepted: null,
    promise_broken: null,
    dispute_raised: null,
    escalation_triggered: null,
    balance_reached_zero: null,
    written_off: null,
    voided: null,
  },
  written_off: {
    due_date_passed: null,
    promise_accepted: null,
    promise_broken: null,
    dispute_raised: null,
    escalation_triggered: null,
    balance_reached_zero: null,
    written_off: null,
    voided: null,
  },
  cancelled: {
    due_date_passed: null,
    promise_accepted: null,
    promise_broken: null,
    dispute_raised: null,
    escalation_triggered: null,
    balance_reached_zero: null,
    written_off: null,
    voided: null,
  },
};

const pairs = INVOICE_STATUSES.flatMap((s) => INVOICE_EVENTS.map((e) => [s, e] as const));

describe('invoice state machine', () => {
  it('covers all 8 x 8 (status, event) pairs', () => {
    expect(pairs).toHaveLength(64);
  });

  it.each(pairs)('%s + %s', (status, event) => {
    const expected = E[status][event];
    const r = transition(status, event);
    if (expected === null) {
      expect(r.ok).toBe(false);
    } else {
      expect(r).toEqual({ ok: true, from: status, to: expected });
    }
  });

  it.each(['paid', 'written_off', 'cancelled'] as const)('final state %s has no outgoing transitions', (status) => {
    for (const event of INVOICE_EVENTS) {
      expect(transition(status, event)).toEqual({ ok: false, reason: 'final_state', from: status, event });
    }
    expect(TRANSITIONS.some((t) => t.from.includes(status))).toBe(false);
  });

  it('rejects a non-final illegal pair with reason not_allowed', () => {
    expect(transition('open', 'promise_accepted')).toEqual({
      ok: false,
      reason: 'not_allowed',
      from: 'open',
      event: 'promise_accepted',
    });
  });

  it('the table is deterministic: each (status, event) matches at most one rule', () => {
    for (const [s, e] of pairs) {
      expect(TRANSITIONS.filter((t) => t.event === e && t.from.includes(s)).length).toBeLessThanOrEqual(1);
    }
  });

  it('documents current behaviour: disputed can only leave via payment (no human-resolution event yet)', () => {
    const exits = INVOICE_EVENTS.filter((e) => transition('disputed', e).ok);
    expect(exits).toEqual(['balance_reached_zero']);
  });
});
