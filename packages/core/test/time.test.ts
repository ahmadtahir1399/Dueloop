import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { nextSendWindow } from '../src/time.ts';
import type { Settings } from '../src/domain/types.ts';

const settings = (timezone: string, startHour: number, endHour: number, holidays: string[] = []): Settings => ({
  timezone,
  quietHours: { startHour, endHour },
  holidays,
});

/** Local wall time in `zone` -> DateTime in that zone. */
const local = (iso: string, zone: string): DateTime => DateTime.fromISO(iso, { zone });

/** Adapter over the nextSendWindow API; returns the window as an ISO string with offset. */
function win(t: DateTime, s: Settings): string | null {
  const r = nextSendWindow(t, s);
  return r.ok ? r.at.toISO() : null;
}

const LDN = 'Europe/London';
const NY = 'America/New_York';

describe('nextSendWindow: non-wrapping quiet hours (1 -> 5)', () => {
  const s = settings(LDN, 1, 5);
  it('02:00 local -> 05:00 the SAME day (guide bug: returned next day)', () => {
    expect(win(local('2026-06-10T02:00', LDN), s)).toBe('2026-06-10T05:00:00.000+01:00');
  });
  it('04:59 -> 05:00 same day', () => {
    expect(win(local('2026-06-10T04:59', LDN), s)).toBe('2026-06-10T05:00:00.000+01:00');
  });
  it('00:30 is allowed (before the window)', () => {
    expect(win(local('2026-06-10T00:30', LDN), s)).toBe('2026-06-10T00:30:00.000+01:00');
  });
  it('05:00 exactly is allowed (end is exclusive)', () => {
    expect(win(local('2026-06-10T05:00', LDN), s)).toBe('2026-06-10T05:00:00.000+01:00');
  });
  it('01:00 exactly is quiet (start is inclusive)', () => {
    expect(win(local('2026-06-10T01:00', LDN), s)).toBe('2026-06-10T05:00:00.000+01:00');
  });
});

describe('nextSendWindow: wrapping quiet hours (20 -> 9)', () => {
  const s = settings(LDN, 20, 9);
  it('21:30 -> 09:00 next day', () => {
    expect(win(local('2026-06-10T21:30', LDN), s)).toBe('2026-06-11T09:00:00.000+01:00');
  });
  it('03:00 -> 09:00 same day', () => {
    expect(win(local('2026-06-10T03:00', LDN), s)).toBe('2026-06-10T09:00:00.000+01:00');
  });
  it('09:00 exactly is allowed', () => {
    expect(win(local('2026-06-10T09:00', LDN), s)).toBe('2026-06-10T09:00:00.000+01:00');
  });
  it('19:59 is allowed', () => {
    expect(win(local('2026-06-10T19:59', LDN), s)).toBe('2026-06-10T19:59:00.000+01:00');
  });
  it('20:00 exactly -> 09:00 next day', () => {
    expect(win(local('2026-06-10T20:00', LDN), s)).toBe('2026-06-11T09:00:00.000+01:00');
  });
});

describe('nextSendWindow: startHour === endHour means no quiet hours', () => {
  it.each(['00:00', '09:00', '23:59'])('%s is allowed', (hm) => {
    expect(win(local(`2026-06-10T${hm}`, LDN), settings(LDN, 9, 9))).toBe(`2026-06-10T${hm}:00.000+01:00`);
  });
});

describe('nextSendWindow: holidays', () => {
  it('holiday today (wrapping 20->9) -> 09:00 next day', () => {
    expect(win(local('2026-12-25T12:00', LDN), settings(LDN, 20, 9, ['2026-12-25']))).toBe('2026-12-26T09:00:00.000+00:00');
  });
  it('holiday today AND tomorrow -> 09:00 the day after', () => {
    const s = settings(LDN, 20, 9, ['2026-12-25', '2026-12-26']);
    expect(win(local('2026-12-25T12:00', LDN), s)).toBe('2026-12-27T09:00:00.000+00:00');
  });
  it('quiet evening before a holiday -> skips the holiday', () => {
    expect(win(local('2026-12-24T21:30', LDN), settings(LDN, 20, 9, ['2026-12-25']))).toBe('2026-12-26T09:00:00.000+00:00');
  });
  it('holiday with NON-wrapping window (1->5): next day 00:00 is already allowed', () => {
    expect(win(local('2026-12-25T12:00', LDN), settings(LDN, 1, 5, ['2026-12-25']))).toBe('2026-12-26T00:00:00.000+00:00');
  });
  it('holiday with no quiet hours -> next day 00:00', () => {
    expect(win(local('2026-12-25T12:00', LDN), settings(LDN, 0, 0, ['2026-12-25']))).toBe('2026-12-26T00:00:00.000+00:00');
  });
});

describe('nextSendWindow: DST (2026 transitions verified from tz data)', () => {
  // America/New_York: spring forward 2026-03-08 02:00 EST -> 03:00 EDT; fall back 2026-11-01 02:00 EDT -> 01:00 EST.
  // Europe/London: spring forward 2026-03-29 01:00 GMT -> 02:00 BST; fall back 2026-10-25 02:00 BST -> 01:00 GMT.
  it('NY spring-forward day: quiet 20->9 at 03:00 EDT -> 09:00 EDT', () => {
    expect(win(local('2026-03-08T03:00', NY), settings(NY, 20, 9))).toBe('2026-03-08T09:00:00.000-04:00');
  });
  it('NY spring-forward: window opens at non-existent 02:00 -> first real instant 03:00 EDT', () => {
    expect(win(local('2026-03-08T01:30', NY), settings(NY, 22, 2))).toBe('2026-03-08T03:00:00.000-04:00');
  });
  it('NY spring-forward: the only allowed hour (02) does not exist that day -> next day 02:00', () => {
    expect(win(local('2026-03-08T00:00', NY), settings(NY, 3, 2))).toBe('2026-03-09T02:00:00.000-04:00');
  });
  it('NY fall-back day: quiet 20->9 at 00:30 EDT -> 09:00 EST', () => {
    expect(win(local('2026-11-01T00:30', NY), settings(NY, 20, 9))).toBe('2026-11-01T09:00:00.000-05:00');
  });
  it('NY fall-back: both 01:30 instants are allowed with quiet 2->6 (dedupe is the idempotency key\'s job)', () => {
    const s = settings(NY, 2, 6);
    const first = DateTime.fromISO('2026-11-01T05:30:00Z').setZone(NY); // 01:30 EDT
    const second = DateTime.fromISO('2026-11-01T06:30:00Z').setZone(NY); // 01:30 EST
    expect(first.hour).toBe(1);
    expect(second.hour).toBe(1);
    expect(win(first, s)).toBe('2026-11-01T01:30:00.000-04:00');
    expect(win(second, s)).toBe('2026-11-01T01:30:00.000-05:00');
  });
  it('NY fall-back: quiet 1->2 covers BOTH repeated 01:xx hours -> 02:00 EST', () => {
    const first = DateTime.fromISO('2026-11-01T05:30:00Z').setZone(NY); // 01:30 EDT
    expect(win(first, settings(NY, 1, 2))).toBe('2026-11-01T02:00:00.000-05:00');
  });
  it('London spring-forward: window opens at non-existent 01:00 -> 02:00 BST', () => {
    expect(win(local('2026-03-29T00:30', LDN), settings(LDN, 22, 1))).toBe('2026-03-29T02:00:00.000+01:00');
  });
  it('London fall-back: quiet 20->9 at 00:30 BST -> 09:00 GMT', () => {
    expect(win(local('2026-10-25T00:30', LDN), settings(LDN, 20, 9))).toBe('2026-10-25T09:00:00.000+00:00');
  });
});

describe('nextSendWindow: non-whole-hour and whole-hour offsets (verified: Kolkata +05:30, Kathmandu +05:45, Karachi +05:00)', () => {
  const at = DateTime.fromISO('2026-06-10T15:00:00Z');
  it('Asia/Kolkata 20:30 IST -> 09:00 IST next day', () => {
    const r = win(at.setZone('Asia/Kolkata'), settings('Asia/Kolkata', 20, 9));
    expect(r).toBe('2026-06-11T09:00:00.000+05:30');
  });
  it('Asia/Kathmandu 20:45 NPT -> 09:00 NPT next day', () => {
    expect(win(at.setZone('Asia/Kathmandu'), settings('Asia/Kathmandu', 20, 9))).toBe('2026-06-11T09:00:00.000+05:45');
  });
  it('Asia/Karachi 20:00 PKT -> 09:00 PKT next day', () => {
    expect(win(at.setZone('Asia/Karachi'), settings('Asia/Karachi', 20, 9))).toBe('2026-06-11T09:00:00.000+05:00');
  });
  it('Asia/Kolkata mid-hour instant inside a non-wrapping window -> window end', () => {
    // 2026-06-10T08:00Z = 13:30 IST; quiet 13 -> 15
    expect(win(DateTime.fromISO('2026-06-10T08:00:00Z').setZone('Asia/Kolkata'), settings('Asia/Kolkata', 13, 15))).toBe(
      '2026-06-10T15:00:00.000+05:30',
    );
  });
});

describe('nextSendWindow: termination', () => {
  const run = (from: string, n: number) => {
    const start = DateTime.fromISO(from, { zone: LDN });
    const days = Array.from({ length: n }, (_, i) => start.plus({ days: i }).toISODate() ?? '');
    return win(start.set({ hour: 12 }), settings(LDN, 20, 9, days));
  };
  it('500 consecutive holidays -> first day after them at 09:00 (guide capped at 400 iterations)', () => {
    expect(run('2026-01-01', 500)).toBe(DateTime.fromISO('2026-01-01', { zone: LDN }).plus({ days: 500 }).set({ hour: 9 }).toISO());
  });
  it('5000 consecutive holidays still terminate with a correct answer', () => {
    expect(run('2026-01-01', 5000)).toBe(DateTime.fromISO('2026-01-01', { zone: LDN }).plus({ days: 5000 }).set({ hour: 9 }).toISO());
  });
  it('settings with no allowed hour (invalid, -1..24) end in no_window_found, not a wrong time', () => {
    expect(nextSendWindow(local('2026-06-10T12:00', LDN), settings(LDN, -1, 24))).toEqual({ ok: false, reason: 'no_window_found' });
  });
  it('an invalid zone gives invalid_input', () => {
    expect(nextSendWindow(local('2026-06-10T12:00', LDN), settings('Fantasia/Castle', 20, 9))).toEqual({ ok: false, reason: 'invalid_input' });
  });
  it('converts t into the tenant zone before checking', () => {
    // 2026-06-10T20:30Z is 21:30 in London (quiet) but 16:30 in New York (allowed).
    const t = DateTime.fromISO('2026-06-10T20:30:00Z', { zone: 'UTC' });
    expect(win(t, settings(NY, 20, 9))).toBe('2026-06-10T16:30:00.000-04:00');
    expect(win(t, settings(LDN, 20, 9))).toBe('2026-06-11T09:00:00.000+01:00');
  });
});
