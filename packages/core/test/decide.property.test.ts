import fc from 'fast-check';
import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { decide } from '../src/decide.ts';
import { validateSettings } from '../src/domain/settings.ts';
import { CHANNELS, INVOICE_STATUSES, type Ctx, type PolicyStep, type Settings } from '../src/domain/types.ts';
import { nextSendWindow } from '../src/time.ts';

// Includes whole, half and quarter-hour offsets, DST in both hemispheres and a 30-minute DST shift.
const ZONES = [
  'Europe/London',
  'America/New_York',
  'Asia/Kolkata',
  'Asia/Kathmandu',
  'Asia/Karachi',
  'Asia/Tokyo',
  'America/Sao_Paulo',
  'Australia/Lord_Howe',
  'UTC',
] as const;

/** Independent oracle for quiet hours, written separately from src/time.ts on purpose. */
function oracleQuiet(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  if (start < end) return start <= hour && hour < end;
  return hour >= start || hour < end;
}

function oracleAllowed(t: DateTime, s: Settings): boolean {
  const l = t.setZone(s.timezone);
  return !oracleQuiet(l.hour, s.quietHours.startHour, s.quietHours.endHour) && !s.holidays.includes(l.toFormat('yyyy-MM-dd'));
}

const NOW_MIN = new Date('2026-01-01T00:00:00Z');
const NOW_MAX = new Date('2027-12-31T00:00:00Z');

// Arbitraries are built once (no .chain): dates relative to `now` are resolved in .map().
const nowArb = fc.date({ min: NOW_MIN, max: NOW_MAX, noInvalidDate: true });

interface RawSettings {
  timezone: string;
  startHour: number;
  endHour: number;
  holidayOffsets: number[];
}

const rawSettingsArb: fc.Arbitrary<RawSettings> = fc.record({
  timezone: fc.constantFrom(...ZONES),
  startHour: fc.integer({ min: 0, max: 23 }),
  endHour: fc.integer({ min: 0, max: 23 }),
  holidayOffsets: fc.uniqueArray(fc.integer({ min: -3, max: 40 }), { maxLength: 25 }),
});

function toSettings(now: Date, r: RawSettings): Settings {
  const today = DateTime.fromJSDate(now).setZone(r.timezone).startOf('day');
  return {
    timezone: r.timezone,
    quietHours: { startHour: r.startHour, endHour: r.endHour },
    holidays: r.holidayOffsets.map((d) => today.plus({ days: d }).toFormat('yyyy-MM-dd')),
  };
}

const stepsArb = fc
  .array(fc.record({ daysAfterDue: fc.integer({ min: 0, max: 30 }), channel: fc.constantFrom(...CHANNELS) }), { maxLength: 5 })
  .map((xs): PolicyStep[] => xs.map((x, i) => ({ id: `s${i}`, templateKey: `t${i}`, ...x })));

const ctxArb: fc.Arbitrary<Ctx> = fc
  .record({
      now: nowArb,
      rawSettings: rawSettingsArb,
      steps: stepsArb,
      status: fc.constantFrom(...INVOICE_STATUSES),
      dueOffset: fc.integer({ min: -60, max: 30 }),
      promiseOffset: fc.option(fc.integer({ min: -20, max: 20 }), { nil: undefined }),
      optedOut: fc.boolean(),
      escalated: fc.boolean(),
      sentMask: fc.array(fc.boolean(), { minLength: 5, maxLength: 5 }),
      sentAtOffsetsMin: fc.array(fc.integer({ min: -14 * 24 * 60, max: 60 }), { maxLength: 6 }),
      escalateAfterDays: fc.integer({ min: 0, max: 60 }),
      graceDaysAfterPromise: fc.integer({ min: 0, max: 10 }),
      maxMessagesPerWeek: fc.integer({ min: 0, max: 5 }),
      invoiceId: fc.stringMatching(/^[a-z0-9-]{1,12}$/),
  })
  .map((g): Ctx => {
    const settings = toSettings(g.now, g.rawSettings);
    const today = DateTime.fromJSDate(g.now).setZone(settings.timezone).startOf('day');
    const iso = (days: number) => today.plus({ days }).toFormat('yyyy-MM-dd');
    return {
      now: g.now,
      invoice: {
        id: g.invoiceId,
        status: g.status,
        dueOn: iso(g.dueOffset),
        ...(g.promiseOffset === undefined ? {} : { promisedOn: iso(g.promiseOffset) }),
      },
      customer: { optedOut: g.optedOut },
      history: {
        sentStepIds: g.steps.filter((_, i) => g.sentMask[i]).map((s) => s.id),
        // Offsets up to +60 min include sentAt slightly after now (clock skew).
        sentAt: g.sentAtOffsetsMin.map((m) => new Date(g.now.getTime() + m * 60_000)),
        escalated: g.escalated,
      },
      policy: {
        steps: g.steps,
        escalateAfterDays: g.escalateAfterDays,
        graceDaysAfterPromise: g.graceDaysAfterPromise,
        maxMessagesPerWeek: g.maxMessagesPerWeek,
      },
      settings,
    };
  });

const RUNS = { numRuns: 2000 };

describe('decide() properties', () => {
  it('generated settings are valid (precondition of every property below)', () => {
    fc.assert(fc.property(ctxArb, (c) => validateSettings(c.settings).ok), { numRuns: 500 });
  });

  it('never throws on valid input', () => {
    fc.assert(fc.property(ctxArb, (c) => {
      decide(c);
    }), RUNS);
  });

  it('never send_reminder inside quiet hours or on a tenant holiday', () => {
    fc.assert(
      fc.property(ctxArb, (c) => {
        const sends = decide(c).filter((a) => a.kind === 'send_reminder');
        return sends.length === 0 || oracleAllowed(DateTime.fromJSDate(c.now), c.settings);
      }),
      RUNS,
    );
  });

  it('never send_reminder for paid / written_off / cancelled / disputed', () => {
    fc.assert(
      fc.property(ctxArb, (c) => {
        const blocked = ['paid', 'written_off', 'cancelled', 'disputed'].includes(c.invoice.status);
        return !blocked || decide(c).every((a) => a.kind !== 'send_reminder');
      }),
      RUNS,
    );
  });

  it('never send_reminder for an opted-out customer', () => {
    fc.assert(
      fc.property(ctxArb, (c) => !c.customer.optedOut || decide(c).every((a) => a.kind !== 'send_reminder')),
      RUNS,
    );
  });

  it('same input twice => deep-equal output', () => {
    fc.assert(fc.property(ctxArb, (c) => {
      expect(decide(c)).toEqual(decide(c));
    }), RUNS);
  });

  it('idempotency key is stable and equals invoice:step:channel', () => {
    fc.assert(
      fc.property(ctxArb, (c) => {
        for (const a of decide(c)) {
          if (a.kind !== 'send_reminder') continue;
          if (a.idempotencyKey !== `${c.invoice.id}:${a.step.id}:${a.step.channel}`) return false;
          if (c.history.sentStepIds.includes(a.step.id)) return false; // never a step already sent
        }
        return true;
      }),
      RUNS,
    );
  });

  it('wait_until is never in the past relative to now (strictly later)', () => {
    fc.assert(
      fc.property(ctxArb, (c) => decide(c).every((a) => a.kind !== 'wait_until' || a.at.getTime() > c.now.getTime())),
      RUNS,
    );
  });

  it('at most one send_reminder per evaluation', () => {
    fc.assert(fc.property(ctxArb, (c) => decide(c).filter((a) => a.kind === 'send_reminder').length <= 1), RUNS);
  });
});

describe('nextSendWindow() properties', () => {
  const arb = fc.tuple(nowArb, rawSettingsArb).map(([now, r]) => [now, toSettings(now, r)] as const);

  it('returns the earliest allowed instant >= t (checked at every local hour boundary in between)', () => {
    fc.assert(
      fc.property(arb, ([now, s]) => {
        const t = DateTime.fromJSDate(now).setZone(s.timezone);
        const r = nextSendWindow(t, s);
        if (!r.ok) return false;
        if (r.at < t || !oracleAllowed(r.at, s)) return false;
        if (r.at.equals(t)) return true;
        if (oracleAllowed(t, s)) return false;
        // Every hour boundary strictly between t and the result must be disallowed.
        // Quarter-hour UTC steps hit every local hour boundary (all offsets are multiples
        // of 15 min); whole holiday days are skipped since nothing in them is allowed.
        let c = t.startOf('hour').plus({ hours: 1 });
        while (c < r.at) {
          if (s.holidays.includes(c.toFormat('yyyy-MM-dd'))) {
            c = c.plus({ days: 1 }).startOf('day');
            continue;
          }
          if (c.minute === 0 && oracleAllowed(c, s)) return false;
          c = c.plus({ minutes: 15 });
        }
        return true;
      }),
      { numRuns: 1000 },
    );
  });
});
