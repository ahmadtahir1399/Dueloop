-- Prompt 7 step 11 (issue P): KPI snapshots, so a pilot has a stored baseline to compare against later.
-- A snapshot freezes the prompt 5 KPI functions (ADR 0041: tenant-local days, per currency, no FX) for one tenant and
-- one inclusive local-date period. Money is stored as TEXT inside the JSON so no amount can lose precision.
-- Service-only writes (`pnpm pilot:snapshot`); owners and accountants of the tenant can read them.

create table public.kpi_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  taken_at timestamptz not null,
  kind text not null check (kind in ('baseline', 'periodic')),
  period_from date not null,
  period_to date not null,
  kpis jsonb not null,
  -- Numbers the system cannot know (e.g. staff hours spent chasing), typed in by the client: always labelled so.
  client_reported jsonb not null default '{}'::jsonb check (jsonb_typeof(client_reported) = 'object'),
  notes text check (notes is null or length(notes) <= 2000),
  created_by text not null check (length(btrim(created_by)) between 1 and 200),
  check (period_to >= period_from)
);
create unique index kpi_snapshots_one_baseline on public.kpi_snapshots (tenant_id) where kind = 'baseline';
create index kpi_snapshots_tenant_taken on public.kpi_snapshots (tenant_id, taken_at desc);

alter table public.kpi_snapshots enable row level security;
revoke all on table public.kpi_snapshots from anon, authenticated;
grant select on table public.kpi_snapshots to authenticated;
grant all on table public.kpi_snapshots to service_role;
create policy kpi_snapshots_read on public.kpi_snapshots for select to authenticated
  using (tenant_id in (select private.my_tenant_ids(array['owner', 'accountant'])));

create function private.kpi_snapshot(p_tenant uuid, p_kind text, p_from date, p_to date, p_now timestamptz, p_actor text, p_notes text, p_client jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_kpis jsonb;
begin
  if not exists (select 1 from public.tenants where id = p_tenant) then
    raise exception using errcode = 'P0002', message = 'tenant not found';
  end if;
  select jsonb_build_object(
    'as_of', p_now,
    'overdue', coalesce((select jsonb_agg(jsonb_build_object('currency', currency, 'invoices', invoices, 'balance', balance::text) order by currency)
                         from public.kpi_overdue_total(p_now) where tenant_id = p_tenant), '[]'::jsonb),
    'ageing', coalesce((select jsonb_agg(jsonb_build_object('currency', currency, 'bucket', bucket, 'invoices', invoices, 'balance', balance::text) order by currency, bucket)
                        from public.kpi_ageing(p_now) where tenant_id = p_tenant), '[]'::jsonb),
    'recovered', coalesce((select jsonb_agg(jsonb_build_object('currency', currency, 'recovered', recovered::text, 'receipts', receipts, 'credit', credit::text) order by currency)
                           from public.kpi_recovered(p_from, p_to) where tenant_id = p_tenant), '[]'::jsonb),
    'days_to_pay', (select jsonb_build_object('invoices', invoices, 'avg_days_to_pay', avg_days_to_pay, 'avg_days_after_due', avg_days_after_due)
                    from public.kpi_days_to_pay(p_from, p_to) where tenant_id = p_tenant),
    'promises', (select jsonb_build_object('kept', kept, 'broken', broken, 'rate', rate) from public.kpi_promise_kept_rate(p_from, p_to) where tenant_id = p_tenant),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('purpose', purpose, 'channel', channel, 'sent', sent, 'cost_minor', cost_minor::text) order by purpose, channel)
                          from public.kpi_messages(p_from, p_to) where tenant_id = p_tenant), '[]'::jsonb)
  ) into v_kpis;
  insert into public.kpi_snapshots (tenant_id, taken_at, kind, period_from, period_to, kpis, client_reported, notes, created_by)
  values (p_tenant, p_now, p_kind, p_from, p_to, v_kpis, coalesce(p_client, '{}'::jsonb), p_notes, p_actor)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function private.kpi_snapshot(uuid, text, date, date, timestamptz, text, text, jsonb) from public, anon, authenticated, service_role;
