import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { transition } from '../src/domain/invoiceState.ts';
import { INVOICE_STATUSES, type InvoiceStatus } from '../src/domain/types.ts';
import {
  DEFAULT_REPLY_RULES,
  EFFECT_KINDS,
  REPLY_INTENTS,
  planReplyOutcome,
  validatePromiseDate,
  type Proposal,
  type ReplyPlanInput,
  type StatedAmount,
} from '../src/reply.ts';

const at = (iso: string) => new Date(iso);

describe('validatePromiseDate (rule 26)', () => {
  const ref = at('2026-10-20T10:00:00Z'); // 20 Oct, 11:00 London
  const v = (d: string | null, r = ref, tz = 'Europe/London') => validatePromiseDate(d, r, tz, 90);

  it('"the 15th" said on the 20th: next month is fine, this month is in the past', () => {
    expect(v('2026-11-15')).toEqual({ ok: true, date: '2026-11-15' });
    expect(v('2026-10-15')).toEqual({ ok: false, reason: 'before_reference' });
  });
  it('same day is allowed; yesterday is not', () => {
    expect(v('2026-10-20')).toMatchObject({ ok: true });
    expect(v('2026-10-19')).toEqual({ ok: false, reason: 'before_reference' });
  });
  it('horizon edge: +90 days ok, +91 beyond; wrong year far away', () => {
    expect(v('2027-01-18')).toMatchObject({ ok: true }); // 20 Oct + 90 days
    expect(v('2027-01-19')).toEqual({ ok: false, reason: 'beyond_horizon' });
    expect(v('2027-11-15')).toEqual({ ok: false, reason: 'beyond_horizon' });
    expect(v('2025-11-15')).toEqual({ ok: false, reason: 'before_reference' });
  });
  it('Feb 29 exists only in leap years; malformed and missing dates are rejected', () => {
    expect(v('2028-02-29', at('2028-02-01T12:00:00Z'))).toMatchObject({ ok: true });
    expect(v('2027-02-29', at('2027-02-01T12:00:00Z'))).toEqual({ ok: false, reason: 'invalid' });
    for (const bad of ['2026-13-01', '2026-11-5', 'next friday', '2026-11-15T00:00:00Z', '', ' 2026-11-15']) expect(v(bad)).toEqual({ ok: false, reason: 'invalid' });
    expect(v(null)).toEqual({ ok: false, reason: 'missing' });
  });
  it('the reference LOCAL date decides, across DST days', () => {
    // London springs forward 29 Mar 2026 01:00 UTC; New York falls back 1 Nov 2026 06:00 UTC.
    expect(v('2026-03-29', at('2026-03-29T00:30:00Z'))).toMatchObject({ ok: true });
    expect(v('2026-03-28', at('2026-03-29T01:30:00Z'))).toEqual({ ok: false, reason: 'before_reference' });
    expect(v('2026-11-01', at('2026-11-01T05:30:00Z'), 'America/New_York')).toMatchObject({ ok: true });
    expect(v('2026-10-31', at('2026-11-01T07:00:00Z'), 'America/New_York')).toEqual({ ok: false, reason: 'before_reference' });
  });
  it('half-hour zones: the customer\'s date is already tomorrow in Kolkata and Karachi', () => {
    // 19:00Z on 27 Oct = 00:30 IST on 28 Oct; 19:30Z = 00:30 PKT on 28 Oct.
    expect(v('2026-10-27', at('2026-10-27T19:00:00Z'), 'Asia/Kolkata')).toEqual({ ok: false, reason: 'before_reference' });
    expect(v('2026-10-28', at('2026-10-27T19:00:00Z'), 'Asia/Kolkata')).toMatchObject({ ok: true });
    expect(v('2026-10-27', at('2026-10-27T19:30:00Z'), 'Asia/Karachi')).toEqual({ ok: false, reason: 'before_reference' });
    expect(v('2026-10-27', at('2026-10-27T18:30:00Z'), 'Asia/Karachi')).toMatchObject({ ok: true }); // 23:30 PKT on 27 Oct
  });
});

const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  intent: 'promise_to_pay',
  confidence: 0.95,
  promisedDate: '2026-11-15',
  dateIsVague: false,
  statedAmountText: null,
  ...over,
});
const input = (over: Partial<ReplyPlanInput> = {}): ReplyPlanInput => ({
  proposal: proposal(),
  invoice: { status: 'overdue', balanceMinor: 125050, currency: 'GBP' },
  reference: at('2026-10-20T10:00:00Z'),
  timezone: 'Europe/London',
  senderTrusted: true,
  statedAmount: { kind: 'none' },
  activePromise: null,
  renewalCount: 0,
  rules: DEFAULT_REPLY_RULES,
  ...over,
});
const kinds = (i: ReplyPlanInput) => planReplyOutcome(i).effects.map((e) => e.kind);
const task = (i: ReplyPlanInput) => planReplyOutcome(i).effects.find((e) => e.kind === 'create_task');

describe('planReplyOutcome: the outcome table', () => {
  it('clear, trusted, high-confidence promise on an overdue invoice -> promised + promise + instant alert', () => {
    expect(planReplyOutcome(input()).effects).toEqual([
      { kind: 'transition', event: 'promise_accepted', from: 'overdue', to: 'promised' },
      { kind: 'set_promise', promisedOn: '2026-11-15' },
      { kind: 'notify', urgency: 'instant', topic: 'promise_recorded' },
    ]);
  });

  it.each<[string, Partial<ReplyPlanInput>, string]>([
    ['vague date', { proposal: proposal({ dateIsVague: true }) }, 'vague_date'],
    ['no date', { proposal: proposal({ promisedDate: null }) }, 'date_missing'],
    ['past date', { proposal: proposal({ promisedDate: '2026-10-01' }) }, 'date_before_reference'],
    ['date beyond horizon', { proposal: proposal({ promisedDate: '2027-06-01' }) }, 'date_beyond_horizon'],
    ['garbage date', { proposal: proposal({ promisedDate: 'soonish' }) }, 'date_invalid'],
    ['low confidence', { proposal: proposal({ confidence: 0.4 }) }, 'low_confidence'],
    ['partial amount', { statedAmount: { kind: 'parsed', minor: 50000, currency: 'GBP' } }, 'partial_amount'],
    ['amount in another currency', { statedAmount: { kind: 'parsed', minor: 125050, currency: 'EUR' } }, 'currency_mismatch'],
    ['amount not parseable', { statedAmount: { kind: 'unparsed' } }, 'amount_unparsed'],
    ['spoofable sender (email without thread match)', { senderTrusted: false }, 'unverified_sender'],
    ['renewal cap reached', { renewalCount: DEFAULT_REPLY_RULES.maxRenewals }, 'renewal_cap'],
    ['promise while already promised (state table allows overdue only)', { invoice: { status: 'promised', balanceMinor: 1, currency: 'GBP' } }, 'promise_not_allowed_in_status'],
    ['promise on a not-yet-due invoice', { invoice: { status: 'open', balanceMinor: 1, currency: 'GBP' } }, 'promise_not_allowed_in_status'],
    ['tenant reviews every promise', { rules: { ...DEFAULT_REPLY_RULES, promiseAcceptance: 'review' } }, 'promise_acceptance_review'],
  ])('promise -> review_promise task, status unchanged: %s', (_n, over, reason) => {
    const i = input(over);
    expect(kinds(i)).not.toContain('transition');
    expect(kinds(i)).not.toContain('set_promise');
    expect(task(i)).toEqual({ kind: 'create_task', type: 'review_promise', reason, blocksRemindersDays: 0 });
  });

  it('a stated amount equal to the balance is fine', () => {
    expect(kinds(input({ statedAmount: { kind: 'parsed', minor: 125050, currency: 'GBP' } }))).toContain('transition');
  });

  it('already_paid -> verification task that pauses reminders; NEVER a transition', () => {
    const p = planReplyOutcome(input({ proposal: proposal({ intent: 'already_paid' }) }));
    expect(p.effects).toEqual([
      { kind: 'create_task', type: 'verify_payment_claim', reason: null, blocksRemindersDays: 3 },
      { kind: 'notify', urgency: 'instant', topic: 'payment_claim' },
    ]);
    // Spoofable sender: still a task (a human looks), but no pause.
    expect(task(input({ proposal: proposal({ intent: 'already_paid' }), senderTrusted: false }))).toEqual({
      kind: 'create_task',
      type: 'verify_payment_claim',
      reason: 'unverified_sender',
      blocksRemindersDays: 0,
    });
  });

  it('dispute -> disputed + task + instant alert; untrusted or illegal -> task only', () => {
    expect(planReplyOutcome(input({ proposal: proposal({ intent: 'dispute' }) })).effects).toEqual([
      { kind: 'transition', event: 'dispute_raised', from: 'overdue', to: 'disputed' },
      { kind: 'create_task', type: 'dispute', reason: null, blocksRemindersDays: 0 },
      { kind: 'notify', urgency: 'instant', topic: 'dispute' },
    ]);
    expect(kinds(input({ proposal: proposal({ intent: 'dispute' }), senderTrusted: false }))).toEqual(['create_task', 'notify']);
    expect(task(input({ proposal: proposal({ intent: 'dispute' }), invoice: { status: 'disputed', balanceMinor: 1, currency: 'GBP' } }))).toMatchObject({ reason: 'illegal_transition' });
  });

  it('needs_info -> info_request task that pauses reminders', () => {
    expect(task(input({ proposal: proposal({ intent: 'needs_info' }) }))).toEqual({ kind: 'create_task', type: 'info_request', reason: null, blocksRemindersDays: 3 });
  });

  it.each(['payment_plan_request', 'wrong_person', 'unclear', 'abusive'] as const)('%s -> typed human_review task', (intent) => {
    const p = planReplyOutcome(input({ proposal: proposal({ intent }) }));
    expect(p.effects[0]).toEqual({ kind: 'create_task', type: 'human_review', reason: intent, blocksRemindersDays: 0 });
    expect(p.effects.some((e) => e.kind === 'notify' && e.urgency === 'instant')).toBe(intent === 'abusive');
  });

  it('opt_out is honoured from any matched sender, even without an invoice', () => {
    const expected = [{ kind: 'record_opt_out' }, { kind: 'notify', urgency: 'instant', topic: 'opt_out' }];
    expect(planReplyOutcome(input({ proposal: proposal({ intent: 'opt_out' }), senderTrusted: false })).effects).toEqual(expected);
    expect(planReplyOutcome(input({ proposal: proposal({ intent: 'opt_out' }), invoice: null })).effects).toEqual(expected);
  });

  it('final invoice: only opt-out and dispute-as-task are honoured', () => {
    for (const status of ['paid', 'written_off', 'cancelled'] as const) {
      const inv = { status, balanceMinor: 0, currency: 'GBP' };
      expect(kinds(input({ invoice: inv }))).toEqual([]);
      expect(kinds(input({ invoice: inv, proposal: proposal({ intent: 'already_paid' }) }))).toEqual([]);
      expect(kinds(input({ invoice: inv, proposal: proposal({ intent: 'dispute' }) }))).toEqual(['create_task', 'notify']);
      expect(kinds(input({ invoice: inv, proposal: proposal({ intent: 'opt_out' }) }))).toEqual(['record_opt_out', 'notify']);
    }
  });

  it('no invoice matched: nothing but opt-out (the pipeline creates the ambiguous/unmatched task)', () => {
    expect(kinds(input({ invoice: null }))).toEqual([]);
  });
});

describe('planReplyOutcome: properties', () => {
  const arbProposal = fc.record({
    intent: fc.constantFrom(...REPLY_INTENTS),
    confidence: fc.double({ min: 0, max: 1, noNaN: true }),
    promisedDate: fc.option(
      fc.oneof(
        fc.date({ min: new Date('2024-01-01'), max: new Date('2028-12-31'), noInvalidDate: true }).map((d) => d.toISOString().slice(0, 10)),
        fc.string({ maxLength: 12 }),
      ),
    ),
    dateIsVague: fc.boolean(),
    statedAmountText: fc.option(fc.string({ maxLength: 10 })),
  });
  const arbAmount: fc.Arbitrary<StatedAmount> = fc.oneof(
    fc.constant({ kind: 'none' as const }),
    fc.constant({ kind: 'unparsed' as const }),
    fc.record({ kind: fc.constant('parsed' as const), minor: fc.integer({ min: 0, max: 10_000_000 }), currency: fc.constantFrom('GBP', 'EUR') }),
  );
  const arbInput: fc.Arbitrary<ReplyPlanInput> = fc.record({
    proposal: arbProposal,
    invoice: fc.option(fc.record({ status: fc.constantFrom(...INVOICE_STATUSES), balanceMinor: fc.integer({ min: 0, max: 10_000_000 }), currency: fc.constant('GBP') })),
    reference: fc.date({ min: new Date('2025-01-01'), max: new Date('2027-12-31'), noInvalidDate: true }),
    timezone: fc.constantFrom('Europe/London', 'America/New_York', 'Asia/Kolkata', 'Asia/Karachi', 'UTC'),
    senderTrusted: fc.boolean(),
    statedAmount: arbAmount,
    activePromise: fc.constant(null),
    renewalCount: fc.integer({ min: 0, max: 10 }),
    rules: fc.record({
      promiseAcceptance: fc.constantFrom('auto' as const, 'review' as const),
      autoAcceptConfidence: fc.double({ min: 0, max: 1, noNaN: true }),
      horizonDays: fc.integer({ min: 1, max: 365 }),
      maxRenewals: fc.integer({ min: 0, max: 5 }),
      paymentClaimBlockDays: fc.integer({ min: 0, max: 14 }),
      infoRequestBlockDays: fc.integer({ min: 0, max: 14 }),
    }),
  });

  it('every transition in any plan is legal per the state table', () => {
    fc.assert(
      fc.property(arbInput, (i) => {
        for (const e of planReplyOutcome(i).effects) {
          if (e.kind !== 'transition') continue;
          const t = transition(i.invoice?.status as InvoiceStatus, e.event);
          if (!t.ok || t.to !== e.to || e.from !== i.invoice?.status) return false;
        }
        return true;
      }),
    );
  });

  it('already_paid never transitions (and nothing ever moves to paid)', () => {
    fc.assert(
      fc.property(arbInput, (i) => {
        const effects = planReplyOutcome(i).effects;
        if (effects.some((e) => e.kind === 'transition' && e.to === 'paid')) return false;
        return i.proposal.intent !== 'already_paid' || !effects.some((e) => e.kind === 'transition');
      }),
    );
  });

  it('no plan can send: effect kinds are a closed set without any send', () => {
    expect(EFFECT_KINDS).toEqual(['transition', 'set_promise', 'create_task', 'record_opt_out', 'notify']);
    fc.assert(fc.property(arbInput, (i) => planReplyOutcome(i).effects.every((e) => (EFFECT_KINDS as readonly string[]).includes(e.kind))));
  });

  it('a plan never changes a final invoice', () => {
    fc.assert(
      fc.property(arbInput, (i) => {
        if (!i.invoice || !['paid', 'written_off', 'cancelled'].includes(i.invoice.status)) return true;
        return planReplyOutcome(i).effects.every((e) => e.kind !== 'transition' && e.kind !== 'set_promise');
      }),
    );
  });

  it('same input => same plan', () => {
    fc.assert(fc.property(arbInput, (i) => JSON.stringify(planReplyOutcome(i)) === JSON.stringify(planReplyOutcome(i))));
  });

  it('renewals at or beyond the cap never auto-accept a promise', () => {
    fc.assert(
      fc.property(arbInput, (i) => {
        if (i.renewalCount < i.rules.maxRenewals) return true;
        return !planReplyOutcome(i).effects.some((e) => e.kind === 'set_promise');
      }),
    );
  });

  it('any accepted promise date passed validatePromiseDate against the reference', () => {
    fc.assert(
      fc.property(arbInput, (i) => {
        for (const e of planReplyOutcome(i).effects) {
          if (e.kind === 'set_promise' && !validatePromiseDate(e.promisedOn, i.reference, i.timezone, i.rules.horizonDays).ok) return false;
        }
        return true;
      }),
    );
  });
});
