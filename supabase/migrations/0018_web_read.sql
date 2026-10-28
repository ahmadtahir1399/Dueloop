-- Prompt 6 step 3: read-side views for the dashboard lists (issue R). Both are SECURITY INVOKER, so RLS on the
-- base tables decides what a user sees. Lists are keyset-paginated by the app on (due_on, id) / (last_at, ...).

-- Invoice list: one row per invoice with its balance and the tenant-local ageing bucket (same formula as
-- kpi_ageing, ADR 0041). The balance is a LATERAL sum, so a page of 50 rows sums 50 invoices' payments instead of
-- grouping the whole tenant first (invoice_balances groups everything before filtering).
create view public.invoice_list with (security_invoker = true) as
select
  i.tenant_id, i.id, i.number, i.status, i.issued_on, i.due_on, i.currency::text as currency,
  i.amount_total, coalesce(p.paid, 0)::bigint as amount_paid, (i.amount_total - coalesce(p.paid, 0))::bigint as balance,
  i.customer_id, c.display_name as customer_name, i.promised_on, i.next_action_at, i.parked_reason,
  lower(i.number || ' ' || c.display_name) as search,
  ((now() at time zone t.timezone)::date - i.due_on) as days_past_due,
  case
    when i.status in ('paid', 'written_off', 'cancelled') or i.amount_total - coalesce(p.paid, 0) <= 0 then 'closed'
    when (now() at time zone t.timezone)::date - i.due_on <= 0 then 'not_due'
    when (now() at time zone t.timezone)::date - i.due_on <= 30 then '1-30'
    when (now() at time zone t.timezone)::date - i.due_on <= 60 then '31-60'
    when (now() at time zone t.timezone)::date - i.due_on <= 90 then '61-90'
    else '91+'
  end as bucket
from public.invoices i
join public.tenants t on t.id = i.tenant_id
join public.customers c on c.tenant_id = i.tenant_id and c.id = i.customer_id
left join lateral (
  select sum(pm.amount) as paid from public.payments pm where pm.tenant_id = i.tenant_id and pm.invoice_id = i.id
) p on true;
revoke all on public.invoice_list from anon, authenticated;
grant select on public.invoice_list to authenticated, service_role;

-- Inbox threads: inbound messages grouped per customer + channel (the inbox list). Bodies are not included;
-- the thread page reads messages under RLS.
create view public.inbox_threads with (security_invoker = true) as
select m.tenant_id, m.customer_id, m.channel, c.display_name as customer_name,
       max(m.created_at) as last_at, count(*) as messages,
       count(*) filter (where m.processed_at is null) as unprocessed
from public.messages m
left join public.customers c on c.tenant_id = m.tenant_id and c.id = m.customer_id
where m.direction = 'in'
group by m.tenant_id, m.customer_id, m.channel, c.display_name;
revoke all on public.inbox_threads from anon, authenticated;
grant select on public.inbox_threads to authenticated, service_role;

-- Keyset indexes for the default sorts and the status filter.
create index invoices_tenant_due_idx on public.invoices (tenant_id, due_on, id);
create index invoices_tenant_status_due_idx on public.invoices (tenant_id, status, due_on, id);
create index invoices_tenant_number_idx on public.invoices (tenant_id, number);
create index customers_tenant_name_idx on public.customers (tenant_id, display_name, id);
create index approvals_tenant_status_requested_idx on public.approvals (tenant_id, status, requested_at, id);
create index payment_proofs_tenant_status_created_idx on public.payment_proofs (tenant_id, status, created_at, id);
