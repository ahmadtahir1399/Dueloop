import type { DateTime } from 'luxon';
import type { QuietHours, Settings } from './domain/types.ts';

/**
 * Quiet hours are the half-open local-hour interval [startHour, endHour).
 * start < end: no wrap (1,5 => 01:00-04:59). start > end: wraps midnight
 * (20,9 => 20:00-08:59). start === end: empty, i.e. no quiet hours.
 */
export function isQuietHour(hour: number, q: QuietHours): boolean {
  const { startHour: s, endHour: e } = q;
  if (s === e) return false;
  return s < e ? hour >= s && hour < e : hour >= s || hour < e;
}

export type SendWindow =
  | { readonly ok: true; readonly at: DateTime }
  | { readonly ok: false; readonly reason: 'invalid_input' | 'no_window_found' };

/**
 * Earliest instant >= t (in the tenant zone) that is outside quiet hours and not a holiday.
 *
 * Each step moves strictly forward in absolute time: a holiday jumps to the next
 * local midnight; a quiet instant moves to the next local hour boundary. Stepping
 * by real instants (never set({hour})) means a non-existent local time (spring
 * forward) is simply never produced, and a repeated hour (fall back) is just two
 * different instants with the same local hour.
 *
 * Termination: the loop is bounded. With valid settings each non-holiday local day
 * has at least one allowed hour, except possibly a DST day whose only allowed hour
 * is skipped, so a window is always found within H holiday steps plus at most 3
 * non-holiday days of <= 27 steps each. The bound (H + 3) * 30 covers that; hitting
 * it (only possible with invalid settings) returns no_window_found instead of a
 * wrong time.
 */
export function nextSendWindow(t: DateTime, s: Settings): SendWindow {
  let cur = t.setZone(s.timezone);
  if (!cur.isValid) return { ok: false, reason: 'invalid_input' };
  const holidays = new Set(s.holidays);
  const maxSteps = (holidays.size + 3) * 30;
  for (let i = 0; i < maxSteps; i++) {
    if (holidays.has(cur.toISODate() ?? '')) {
      cur = cur.plus({ days: 1 }).startOf('day');
    } else if (isQuietHour(cur.hour, s.quietHours)) {
      cur = cur.plus({ minutes: 60 - cur.minute }).startOf('minute');
    } else {
      return { ok: true, at: cur };
    }
  }
  return { ok: false, reason: 'no_window_found' };
}
