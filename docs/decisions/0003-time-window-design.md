# 0003: Send-window design and DST handling

**Context.** The guide's `nextSendWindow` returned 05:00 the *next* day for non-wrapping quiet
hours (1 -> 5 at 02:00). It jumped to `endHour` after a holiday even when midnight was already
allowed. It stopped after 400 iterations and silently returned a time that was still a holiday.
It also used `set({ hour })`, which on a spring-forward day silently moves to another hour.

**Decision.**
- Quiet hours are the half-open local-hour interval `[startHour, endHour)`. `start > end` wraps
  midnight, `start < end` does not, and `start === end` means no quiet hours. Zones are IANA
  names only; offset strings like `+05:00`, which Node 24's Intl accepts, are rejected by
  `validateSettings`.
- The search walks forward in **absolute time**. On a holiday it jumps to the next local
  midnight; in quiet hours it moves to the next local hour boundary
  (`plus({ minutes: 60 - minute }).startOf('minute')`). It never uses `set({ hour })`, so it
  never produces a non-existent local time. A repeated fall-back hour is simply two different
  instants; the idempotency key stops a second send.
- The loop is bounded by `(holidays + 3) * 30` steps. Every step strictly advances. With valid
  settings each non-holiday day has an allowed hour, unless a DST gap removes the only one, so
  the answer is found within the bound. Hitting the bound returns `{ ok: false }`, never a wrong
  time.
- `decide()` measures the weekly cap over a rolling **168 hours**, not `minus({ days: 7 })`. The
  calendar version is only 167 h across spring-forward, and the simulator caught a customer
  getting cap + 1 messages that way.

**Consequences.** Tests cover New York and London transitions in 2026, +05:30, +05:45, the 30-min
Lord Howe shift (in property tests) and 5000 consecutive holidays. Day counts (`daysOverdue`)
stay calendar-based in the tenant zone, which is what humans mean by "7 days overdue".
