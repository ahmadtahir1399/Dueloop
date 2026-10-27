import type { DateTime } from 'luxon';
import type { Settings } from './domain/types.ts';

// VERBATIM PORT of guide Section 7.1 (before fixes). Kept only to record which tests fail.

/** Earliest moment (>= t) when sending is allowed: outside quiet hours and not a holiday. */
export function nextSendWindow(t: DateTime, s: Settings): DateTime {
  let cur = t;
  for (let i = 0; i < 400; i++) {
    const h = cur.hour;
    const { startHour, endHour } = s.quietHours;
    const inQuiet = startHour > endHour ? h >= startHour || h < endHour : h >= startHour && h < endHour;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- verbatim guide code; removed in the fix
    const isHoliday = s.holidays.includes(cur.toISODate()!);
    if (!inQuiet && !isHoliday) return cur;
    if (isHoliday) cur = cur.plus({ days: 1 }).startOf('day').set({ hour: endHour });
    else if (h >= startHour) cur = cur.plus({ days: 1 }).startOf('day').set({ hour: endHour });
    else cur = cur.startOf('day').set({ hour: endHour });
  }
  return cur;
}
