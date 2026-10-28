# 0041: KPI definitions (prompt 5, issue P)

**Context.** The guide names KPIs ("recovered", "average days to pay", "promise-kept rate", ageing buckets,
"this week") without defining them, and warns about grouping by UTC. Migration 0015 implements the
definitions below as SECURITY INVOKER SQL functions and views. They read through RLS, so nobody sees
another tenant's numbers (tested). Tests: `supabase/tests/payments/kpi.test.sql`. Its fixtures are worked
out by hand for a tenant in Asia/Kolkata at an instant that is already the next day there.

**Decision.**
- **Local day.** Every date is the tenant's local calendar date: `(timestamp at time zone tenants.timezone)::date`.
  A period `[from, to]` is a pair of inclusive local dates, applied in each tenant's own zone.
- **Money.** Per currency, in minor units. There is no FX. A credit is never counted as recovered.
- **Ageing** (`kpi_ageing(as_of)`). Covers open invoices (not paid, written off or cancelled) with a balance
  above 0. `days_past_due = local_today - due_on`. Buckets: `not_due` (≤ 0), `1-30`, `31-60`, `61-90`,
  `91+`. The guide's "0-30" becomes `1-30`, because an invoice due today is not overdue.
- **Overdue total** (`kpi_overdue_total(as_of)`). Count and sum of balances in every bucket except `not_due`.
- **Recovered** (`kpi_recovered(from, to)`). Money applied to invoices (payment slices) from receipts whose
  local `received_at` date falls in the period. Receipt count and unapplied credit are reported alongside.
- **Days to pay** (`kpi_days_to_pay(from, to)`). Covers paid invoices whose last applied payment has a local
  date in the period. `paid_on - issued_on`, plus `paid_on - due_on` (negative means early). Both are
  averages rounded to 1 decimal.
- **Promise-kept rate** (`kpi_promise_kept_rate(from, to)`). Promises resolved as kept or broken, with a local
  resolution date in the period. The rate is kept / (kept + broken). Superseded and cancelled promises are
  excluded. With no resolved promises there is no row: the rate is undefined, never 0.
- **Messages and cost** (`kpi_messages(from, to)`). Outbound messages in state `sent`, with a local `sent_at`
  date in the period, grouped by purpose (reminder / receipt) and channel. `cost_minor` is in the tenant's
  budget currency. Unknown and pending messages are not counted as sent.
- **This week** (`kpi_this_week`). The tenant's local ISO week, Monday to Sunday, containing now.
  `kpi_ageing_now` and `kpi_overdue_now` are the as-of-now views.

**Consequences.** These numbers are fixed by the tests. Changing a definition means changing the ADR and
the fixtures together. All of them are listed under DECISIONS NEEDED in the prompt 5 report.
