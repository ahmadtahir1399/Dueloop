// Shared by the demos: a moment inside Demo Agency's send window (09:00-20:00 London) — now if it is inside
// the window on a weekday, else 10:00 on the next weekday. Demos pass it to the CLIs as --now.
import { DateTime } from 'luxon';

export const DEMO_ZONE = 'Europe/London';

export function demoNow(real: DateTime = DateTime.utc()): DateTime {
  const local = real.setZone(DEMO_ZONE);
  if (local.hour >= 9 && local.hour < 19 && local.weekday <= 5) return local;
  let at = local.plus({ days: local.hour >= 19 ? 1 : 0 }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
  while (at.weekday > 5) at = at.plus({ days: 1 });
  return at;
}
