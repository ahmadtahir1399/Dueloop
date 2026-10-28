-- Prompt 5, issue P: KPI definitions (ADR 0041). SQL only. Every "day" is the TENANT'S local calendar day
-- (timestamps converted with the tenant's IANA zone), never a UTC day. Period arguments are inclusive local
-- dates [p_from, p_to], interpreted in each tenant's own zone. Money is per currency, in minor units (no FX).
-- All functions are SECURITY INVOKER: they read through RLS, so a user only ever sees their own tenants.

-- Ageing of open receivables as of an instant. days_past_due = local_today - due_on.
-- Buckets: not_due (<= 0), 1-30, 31-60, 61-90, 91+. Open = not paid/written_off/cancelled, balance > 0.
create function public.kpi_ageing(p_as_of timestamptz default now())
returns table (tenant_id uuid, currency text, bucket text, invoices bigint, balance bigint)
language sql stable security invoker set search_path = '' as $$
  with open as (
    select i.tenant_id, i.currency::text as currency, b.balance,
           ((p_as_of at time zone t.timezone)::date - i.due_on) as days_past_due
    from public.invoices i
    join public.invoice_balances b on b.tenant_id = i.tenant_id and b.invoice_id = i.id
    join public.tenants t on t.id = i.tenant_id
    where i.status not in ('paid', 'written_off', 'cancelled') and b.balance > 0
  )
  select o.tenant_id, o.currency,
         case when o.days_past_due <= 0 then 'not_due' when o.days_past_due <= 30 then '1-30' when o.days_past_due <= 60 then '31-60'
              when o.days_past_due <= 90 then '61-90' else '91+' end as bucket,
         count(*), sum(o.balance)::bigint
  from open o group by 1, 2, 3
$$;

-- Overdue total: open receivables at least one local day past due (every bucket except not_due).
create function public.kpi_overdue_total(p_as_of timestamptz default now())
returns table (tenant_id uuid, currency text, invoices bigint, balance bigint)
language sql stable security invoker set search_path = '' as $$
  select a.tenant_id, a.currency, sum(a.invoices)::bigint, sum(a.balance)::bigint
  from public.kpi_ageing(p_as_of) a where a.bucket <> 'not_due' group by 1, 2
$$;

-- Recovered: money APPLIED to invoices (payments slices) whose payment local date is in the period. Credits
-- (money not applied) are reported separately and never count as recovered.
create function public.kpi_recovered(p_from date, p_to date)
returns table (tenant_id uuid, currency text, recovered bigint, receipts bigint, credit bigint)
language sql stable security invoker set search_path = '' as $$
  with r as (
    select r.tenant_id, r.currency::text as currency, r.id,
           coalesce((select sum(p.amount) from public.payments p where p.tenant_id = r.tenant_id and p.receipt_id = r.id), 0) as applied,
           coalesce((select sum(c.amount) from public.credits c where c.tenant_id = r.tenant_id and c.receipt_id = r.id), 0) as credit
    from public.receipts r join public.tenants t on t.id = r.tenant_id
    where (r.received_at at time zone t.timezone)::date between p_from and p_to
  )
  select r.tenant_id, r.currency, sum(r.applied)::bigint, count(*), sum(r.credit)::bigint from r group by 1, 2
$$;

-- Days to pay, over invoices that are paid and whose LAST applied payment (the one that took the balance to
-- zero) has a local date in the period: days_to_pay = paid_on - issued_on; days_after_due = paid_on - due_on
-- (negative = early). Averages rounded to one decimal.
create function public.kpi_days_to_pay(p_from date, p_to date)
returns table (tenant_id uuid, invoices bigint, avg_days_to_pay numeric, avg_days_after_due numeric)
language sql stable security invoker set search_path = '' as $$
  with paid as (
    select i.tenant_id, i.issued_on, i.due_on, max((p.paid_at at time zone t.timezone)::date) as paid_on
    from public.invoices i
    join public.payments p on p.tenant_id = i.tenant_id and p.invoice_id = i.id
    join public.tenants t on t.id = i.tenant_id
    where i.status = 'paid'
    group by i.tenant_id, i.id, i.issued_on, i.due_on
  )
  select tenant_id, count(*), round(avg(paid_on - issued_on), 1), round(avg(paid_on - due_on), 1)
  from paid where paid_on between p_from and p_to group by 1
$$;

-- Promise-kept rate: promises RESOLVED (kept or broken) with a local resolution date in the period;
-- rate = kept / (kept + broken), null when none. Superseded and cancelled promises are not counted.
create function public.kpi_promise_kept_rate(p_from date, p_to date)
returns table (tenant_id uuid, kept bigint, broken bigint, rate numeric)
language sql stable security invoker set search_path = '' as $$
  select pr.tenant_id,
         count(*) filter (where pr.status = 'kept'),
         count(*) filter (where pr.status = 'broken'),
         round(count(*) filter (where pr.status = 'kept')::numeric / nullif(count(*), 0), 4)
  from public.promises pr join public.tenants t on t.id = pr.tenant_id
  where pr.status in ('kept', 'broken') and (pr.resolved_at at time zone t.timezone)::date between p_from and p_to
  group by 1
$$;

-- Messages sent and their cost: outbound messages in state 'sent' with a local sent date in the period, by
-- purpose (reminder / receipt) and channel. Cost is in the tenant's budget currency, minor units.
create function public.kpi_messages(p_from date, p_to date)
returns table (tenant_id uuid, purpose text, channel text, sent bigint, cost_minor bigint)
language sql stable security invoker set search_path = '' as $$
  select m.tenant_id, m.purpose, m.channel, count(*), sum(m.cost_minor)::bigint
  from public.messages m join public.tenants t on t.id = m.tenant_id
  where m.direction = 'out' and m.send_state = 'sent' and (m.sent_at at time zone t.timezone)::date between p_from and p_to
  group by 1, 2, 3
$$;

-- "This week" = the tenant's local ISO week (Monday..Sunday) containing now. Pass it to the period functions.
create view public.kpi_this_week with (security_invoker = true) as
  select t.id as tenant_id, w.week_start, w.week_start + 6 as week_end
  from public.tenants t
  cross join lateral (select date_trunc('week', now() at time zone t.timezone)::date as week_start) w;

-- Convenience views as of now (RLS applies through security_invoker).
create view public.kpi_ageing_now with (security_invoker = true) as select * from public.kpi_ageing(now());
create view public.kpi_overdue_now with (security_invoker = true) as select * from public.kpi_overdue_total(now());

do $$
declare f text;
begin
  foreach f in array array[
    'public.kpi_ageing(timestamptz)', 'public.kpi_overdue_total(timestamptz)', 'public.kpi_recovered(date, date)',
    'public.kpi_days_to_pay(date, date)', 'public.kpi_promise_kept_rate(date, date)', 'public.kpi_messages(date, date)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
revoke all on table public.kpi_this_week, public.kpi_ageing_now, public.kpi_overdue_now from anon, authenticated, service_role;
grant select on table public.kpi_this_week, public.kpi_ageing_now, public.kpi_overdue_now to authenticated, service_role;
