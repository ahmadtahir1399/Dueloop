import { describe, expect, it } from 'vitest';
import { decide } from '../src/decide.ts';
import type { Action } from '../src/domain/types.ts';
import { at, ctx, local, policy } from './fixtures.ts';

const [s1, s2, s3] = policy.steps;

/** Renders wait_until dates as tenant-local ISO strings so expectations read naturally. */
const show = (actions: Action[]) => actions.map((a) => (a.kind === 'wait_until' ? { kind: a.kind, at: local(a.at) } : a));

// Due 2026-06-01 (Europe/London, BST +01:00). Quiet 20 -> 9. Steps on day 1, 7, 14.
// Escalate after 21 days. Grace 2 days. Cap 3 per week.
describe('decide(): the 12 guide scenarios (guide Section 7.1 table)', () => {
  it('1. invoice not yet due -> only wait_until', () => {
    const r = decide(ctx({ now: at('2026-05-30T10:30'), invoice: { status: 'open' } }));
    expect(show(r)).toEqual([{ kind: 'wait_until', at: '2026-06-02T00:00:00.000+01:00' }]);
  });

  it('2. one day overdue, 10:30 local -> mark_overdue, then send_reminder with key invoice:step:channel', () => {
    const r = decide(ctx({ now: at('2026-06-02T10:30'), invoice: { status: 'open' } }));
    expect(r).toEqual([{ kind: 'mark_overdue' }, { kind: 'send_reminder', step: s1, idempotencyKey: 'inv-1:s1:email' }]);
  });

  it('3. same input evaluated twice -> identical output (purity)', () => {
    const input = ctx({ invoice: { status: 'open' } });
    expect(decide(input)).toEqual(decide(input));
  });

  it('4. step 1 already sent -> does not resend; waits for step 2', () => {
    const r = decide(ctx({ now: at('2026-06-03T10:30'), history: { sentStepIds: ['s1'], sentAt: [at('2026-06-02T10:30')] } }));
    expect(show(r)).toEqual([{ kind: 'wait_until', at: '2026-06-08T10:00:00.000+01:00' }]);
  });

  it('5. 21:30 local (quiet hours) -> no send; wait until 09:00 local next day', () => {
    const r = decide(ctx({ now: at('2026-06-02T21:30') }));
    expect(show(r)).toEqual([{ kind: 'wait_until', at: '2026-06-03T09:00:00.000+01:00' }]);
  });

  it('6. tenant holiday -> no send; wait until next day 09:00 local', () => {
    const r = decide(ctx({ now: at('2026-06-02T10:30'), settings: { holidays: ['2026-06-02'] } }));
    expect(show(r)).toEqual([{ kind: 'wait_until', at: '2026-06-03T09:00:00.000+01:00' }]);
  });

  it('7. promise date is today -> wait, no message', () => {
    const r = decide(ctx({ now: at('2026-06-10T10:30'), invoice: { status: 'promised', promisedOn: '2026-06-10' }, history: { sentStepIds: ['s1'] } }));
    // deadline = promisedOn + 2 grace days, end of day; wake one minute after it.
    expect(show(r)).toEqual([{ kind: 'wait_until', at: '2026-06-13T00:00:59.999+01:00' }]);
  });

  it('8. promise date plus grace has passed -> mark_promise_broken, then send next reminder', () => {
    const r = decide(
      ctx({
        now: at('2026-06-08T10:30'),
        invoice: { status: 'promised', promisedOn: '2026-06-05' },
        history: { sentStepIds: ['s1'], sentAt: [at('2026-06-02T10:30')] },
      }),
    );
    expect(r).toEqual([{ kind: 'mark_promise_broken' }, { kind: 'send_reminder', step: s2, idempotencyKey: 'inv-1:s2:whatsapp' }]);
  });

  it('9. customer opted out -> never a send_reminder; escalates to a human', () => {
    expect(decide(ctx({ customer: { optedOut: true } }))).toEqual([{ kind: 'escalate', reason: 'customer_opted_out' }]);
    expect(decide(ctx({ customer: { optedOut: true }, history: { escalated: true } }))).toEqual([]);
  });

  it('10. invoice paid -> no actions', () => {
    expect(decide(ctx({ invoice: { status: 'paid' } }))).toEqual([]);
  });

  it('11. weekly cap reached -> no send', () => {
    const r = decide(
      ctx({
        now: at('2026-06-08T10:30'),
        policy: { maxMessagesPerWeek: 1 },
        history: { sentStepIds: ['s1'], sentAt: [at('2026-06-07T10:30')] },
      }),
    );
    expect(r.some((a) => a.kind === 'send_reminder')).toBe(false);
    expect(show(r)).toEqual([{ kind: 'wait_until', at: '2026-06-09T10:00:00.000+01:00' }]);
  });

  it('12. sequence exhausted and past threshold -> escalate once; no repeat once escalated', () => {
    const sent = { sentStepIds: ['s1', 's2', 's3'], sentAt: [at('2026-06-02T10:30'), at('2026-06-08T10:30'), at('2026-06-15T10:30')] };
    const now = at('2026-06-22T10:30'); // 21 days overdue
    expect(decide(ctx({ now, history: sent }))).toEqual([{ kind: 'escalate', reason: 'sequence_exhausted_unpaid' }]);
    expect(decide(ctx({ now, history: { ...sent, escalated: true } }))).toEqual([]);
  });
});

describe('decide(): other pinned behaviour', () => {
  it.each(['written_off', 'cancelled', 'disputed'] as const)('%s -> no actions', (status) => {
    expect(decide(ctx({ invoice: { status } }))).toEqual([]);
  });

  it('open invoice first seen in quiet hours -> mark_overdue, then wait (no send)', () => {
    const r = decide(ctx({ now: at('2026-06-02T22:00'), invoice: { status: 'open' } }));
    expect(show(r)).toEqual([{ kind: 'mark_overdue' }, { kind: 'wait_until', at: '2026-06-03T09:00:00.000+01:00' }]);
  });

  it('non-wrapping quiet hours 1->5 at 02:00 on a due step -> waits until 05:00 the SAME day', () => {
    const r = decide(ctx({ now: at('2026-06-02T02:00'), settings: { quietHours: { startHour: 1, endHour: 5 } } }));
    expect(show(r)).toEqual([{ kind: 'wait_until', at: '2026-06-02T05:00:00.000+01:00' }]);
  });

  it('fall-back repeated hour: a step sent at 01:30 EDT is not resent at 01:30 EST', () => {
    const NY = 'America/New_York';
    const base = { settings: { timezone: NY, quietHours: { startHour: 20, endHour: 1 } }, invoice: { dueOn: '2026-10-31' } };
    const first = decide(ctx({ ...base, now: new Date('2026-11-01T05:30:00Z') }));
    expect(first).toEqual([{ kind: 'send_reminder', step: s1, idempotencyKey: 'inv-1:s1:email' }]);
    const second = decide(
      ctx({ ...base, now: new Date('2026-11-01T06:30:00Z'), history: { sentStepIds: ['s1'], sentAt: [new Date('2026-11-01T05:30:00Z')] } }),
    );
    expect(second.some((a) => a.kind === 'send_reminder')).toBe(false);
  });

  it('DST: the weekly cap is a rolling 168 hours, not 7 calendar days (found by the simulator)', () => {
    const NY = 'America/New_York';
    // Two sends on 2026-03-03 10:00 EST. 2026-03-10 10:00 EDT is only 167 hours later (spring forward on 03-08).
    const base = {
      invoice: { dueOn: '2026-02-20' },
      settings: { timezone: NY },
      policy: { maxMessagesPerWeek: 2 },
      history: { sentStepIds: ['s1', 's2'], sentAt: [at('2026-03-03T10:00', NY), at('2026-03-03T10:00', NY)] },
    };
    const r = decide(ctx({ ...base, now: at('2026-03-10T10:00', NY) }));
    expect(r.some((a) => a.kind === 'send_reminder')).toBe(false);
    // One hour later, 168 hours have passed: the old sends no longer count.
    const later = decide(ctx({ ...base, now: at('2026-03-10T11:00', NY) }));
    expect(later).toEqual([{ kind: 'send_reminder', step: s3, idempotencyKey: 'inv-1:s3:email' }]);
  });

  it('DST: days overdue are counted in calendar days across spring-forward (New York)', () => {
    const NY = 'America/New_York';
    // Due 2026-03-07; 2026-03-08 is the 23-hour day. On 03-14 10:30 it is 7 days overdue -> step 2.
    const r = decide(
      ctx({
        now: at('2026-03-14T10:30', NY),
        invoice: { dueOn: '2026-03-07' },
        settings: { timezone: NY },
        history: { sentStepIds: ['s1'], sentAt: [at('2026-03-08T10:30', NY)] },
      }),
    );
    expect(r).toEqual([{ kind: 'send_reminder', step: s2, idempotencyKey: 'inv-1:s2:whatsapp' }]);
  });
});

describe('decide(): documents current behaviour (DECISIONS NEEDED in the report)', () => {
  it('documents current behaviour: 5a escalated invoices keep receiving remaining reminders', () => {
    const r = decide(ctx({ invoice: { status: 'escalated' }, history: { escalated: true } }));
    expect(r).toEqual([{ kind: 'send_reminder', step: s1, idempotencyKey: 'inv-1:s1:email' }]);
  });

  it('documents current behaviour: 5b promised with promisedOn undefined falls through to reminders (no mark_promise_broken)', () => {
    const r = decide(ctx({ invoice: { status: 'promised' } }));
    expect(r).toEqual([{ kind: 'send_reminder', step: s1, idempotencyKey: 'inv-1:s1:email' }]);
  });

  it('documents current behaviour: 5c weekly-cap wait is "tomorrow 10:00" even when tomorrow is a holiday or 10:00 is quiet', () => {
    const r = decide(
      ctx({
        now: at('2026-06-08T10:30'),
        policy: { maxMessagesPerWeek: 1 },
        settings: { holidays: ['2026-06-09'], quietHours: { startHour: 20, endHour: 11 } },
        history: { sentStepIds: ['s1'], sentAt: [at('2026-06-07T10:30')] },
      }),
    );
    // 2026-06-09 is a holiday AND 10:00 is inside quiet hours (20 -> 11). Still the wake-up time.
    expect(show(r)).toEqual([{ kind: 'wait_until', at: '2026-06-09T10:00:00.000+01:00' }]);
  });

  it('documents current behaviour: 5d opted-out customer on a not-yet-due invoice -> only wait_until (no escalation yet)', () => {
    const r = decide(ctx({ now: at('2026-05-30T10:30'), invoice: { status: 'open' }, customer: { optedOut: true } }));
    expect(show(r)).toEqual([{ kind: 'wait_until', at: '2026-06-02T00:00:00.000+01:00' }]);
  });

  it('documents current behaviour: 5e due date equals today -> not overdue; wait until the next local midnight', () => {
    const r = decide(ctx({ now: at('2026-06-01T23:59'), invoice: { status: 'open' } }));
    expect(show(r)).toEqual([{ kind: 'wait_until', at: '2026-06-02T00:00:00.000+01:00' }]);
    // At 00:00 the next day it is 1 day overdue: mark_overdue + first step.
    const next = decide(ctx({ now: at('2026-06-02T09:00'), invoice: { status: 'open' } }));
    expect(next[0]).toEqual({ kind: 'mark_overdue' });
  });

  it('documents current behaviour: 5f steps sharing daysAfterDue are sent in policy order, one per evaluation', () => {
    const twin = {
      steps: [
        { id: 'a', daysAfterDue: 1, channel: 'email' as const, templateKey: 't' },
        { id: 'b', daysAfterDue: 1, channel: 'sms' as const, templateKey: 't' },
      ],
    };
    expect(decide(ctx({ policy: twin }))).toEqual([{ kind: 'send_reminder', step: twin.steps[0], idempotencyKey: 'inv-1:a:email' }]);
    const after = decide(ctx({ policy: twin, history: { sentStepIds: ['a'], sentAt: [at('2026-06-02T10:30')] } }));
    expect(after).toEqual([{ kind: 'send_reminder', step: twin.steps[1], idempotencyKey: 'inv-1:b:sms' }]);
  });

  it('documents current behaviour: 5g clock goes backwards -> a sentAt in the future still counts toward the weekly cap', () => {
    const r = decide(
      ctx({
        now: at('2026-06-08T10:30'),
        policy: { maxMessagesPerWeek: 1 },
        history: { sentStepIds: ['s1'], sentAt: [at('2026-06-20T10:30')] },
      }),
    );
    expect(show(r)).toEqual([{ kind: 'wait_until', at: '2026-06-09T10:00:00.000+01:00' }]);
  });

  it('documents current behaviour: 5h sequence exhausted but below the escalation threshold -> [] with NO wait_until', () => {
    const r = decide(
      ctx({
        now: at('2026-06-16T10:30'), // 15 days overdue, threshold 21
        history: { sentStepIds: ['s1', 's2', 's3'], sentAt: [at('2026-06-15T10:30')] },
      }),
    );
    expect(r).toEqual([]);
  });
});

describe('decide(): wake-ups', () => {
  it('at 00:00 on the due date the wake-up is the next midnight, never in the past', () => {
    const r = decide(ctx({ now: at('2026-06-01T00:00'), invoice: { status: 'open' } }));
    expect(show(r)).toEqual([{ kind: 'wait_until', at: '2026-06-02T00:00:00.000+01:00' }]);
  });
});

describe('decide(): step 3 waits until day 14 (the guide note on scenario 6)', () => {
  it('after s1 and s2, on day 10 -> wait for s3 at day 14 10:00', () => {
    const r = decide(ctx({ now: at('2026-06-11T10:30'), history: { sentStepIds: ['s1', 's2'], sentAt: [at('2026-06-08T10:30')] } }));
    expect(show(r)).toEqual([{ kind: 'wait_until', at: '2026-06-15T10:00:00.000+01:00' }]);
    expect(s3?.daysAfterDue).toBe(14);
  });
});
