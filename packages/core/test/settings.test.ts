import { describe, expect, it } from 'vitest';
import { validateSettings } from '../src/domain/settings.ts';
import type { Settings } from '../src/domain/types.ts';

const base: Settings = { timezone: 'Europe/London', quietHours: { startHour: 20, endHour: 9 }, holidays: ['2026-12-25'] };

function fields(s: Settings): string[] {
  const r = validateSettings(s);
  return r.ok ? [] : r.errors.map((e) => e.field);
}

describe('validateSettings', () => {
  it('accepts valid settings and returns them unchanged', () => {
    expect(validateSettings(base)).toEqual({ ok: true, value: base });
  });

  it.each(['America/New_York', 'Asia/Kolkata', 'Asia/Karachi', 'Asia/Kathmandu', 'UTC'])('accepts IANA zone %s', (tz) => {
    expect(fields({ ...base, timezone: tz })).toEqual([]);
  });

  it.each(['Fantasia/Castle', 'UTC+5', '+05:00', '-0300', '', 'GMT+0530', 'UTC+05:30'])('rejects non-IANA zone %j', (tz) => {
    expect(fields({ ...base, timezone: tz })).toEqual(['timezone']);
  });

  it.each([-1, 24, 1.5, Number.NaN])('rejects hour %d', (h) => {
    expect(fields({ ...base, quietHours: { startHour: h, endHour: 9 } })).toEqual(['quietHours.startHour']);
    expect(fields({ ...base, quietHours: { startHour: 20, endHour: h } })).toEqual(['quietHours.endHour']);
  });

  it('accepts the hour bounds 0 and 23', () => {
    expect(fields({ ...base, quietHours: { startHour: 0, endHour: 23 } })).toEqual([]);
  });

  it('accepts startHour === endHour, which means "no quiet hours"', () => {
    expect(fields({ ...base, quietHours: { startHour: 9, endHour: 9 } })).toEqual([]);
  });

  it.each(['2026-02-30', '2026-2-3', '2026-02-03T10:00', 'tomorrow', '20261225'])('rejects holiday %j', (d) => {
    expect(fields({ ...base, holidays: ['2026-01-01', d] })).toEqual(['holidays[1]']);
  });

  it('reports every problem at once', () => {
    expect(fields({ timezone: 'nope', quietHours: { startHour: 99, endHour: -3 }, holidays: ['x'] })).toEqual([
      'timezone',
      'quietHours.startHour',
      'quietHours.endHour',
      'holidays[0]',
    ]);
  });
});
