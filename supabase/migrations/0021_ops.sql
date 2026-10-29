-- Prompt 7 step 2: operations. Everything here is service-only (private schema); no API role can reach it.
-- 1. schema version: the latest applied migration, for the start-up guard (rule 45).
-- 2. service heartbeats, written by the worker, processor, webhook runtime and web on every loop / readiness check.
-- 3. ops alert de-duplication for the watchdog.
-- 4. ops_status(): every number the maintainer needs, in one call.

create function private.schema_version() returns text
language sql stable security definer set search_path = '' as $$
  select max(version) from supabase_migrations.schema_migrations
$$;
revoke all on function private.schema_version() from public, anon, authenticated, service_role;

create table private.service_heartbeats (
  service text not null check (service in ('web', 'worker', 'processor', 'webhooks', 'payments')),
  instance_id text not null check (length(instance_id) between 1 and 100),
  version text not null check (length(version) <= 40),
  started_at timestamptz not null,
  last_seen_at timestamptz not null,
  last_ok_at timestamptz,
  details jsonb not null default '{}' check (jsonb_typeof(details) = 'object'),
  primary key (service, instance_id)
);
revoke all on table private.service_heartbeats from public, anon, authenticated, service_role;

create function private.heartbeat(p_service text, p_instance text, p_version text, p_ok boolean, p_details jsonb, p_now timestamptz)
returns void language sql security definer set search_path = '' as $$
  insert into private.service_heartbeats (service, instance_id, version, started_at, last_seen_at, last_ok_at, details)
  values (p_service, p_instance, p_version, p_now, p_now, case when p_ok then p_now end, coalesce(p_details, '{}'))
  on conflict (service, instance_id) do update set version = excluded.version, last_seen_at = excluded.last_seen_at,
    last_ok_at = case when p_ok then excluded.last_seen_at else private.service_heartbeats.last_ok_at end, details = excluded.details
$$;
revoke all on function private.heartbeat(text, text, text, boolean, jsonb, timestamptz) from public, anon, authenticated, service_role;

create table private.ops_alerts (
  dedupe_key text not null check (length(dedupe_key) between 1 and 200),
  period text not null,
  created_at timestamptz not null default now(),
  primary key (dedupe_key, period)
);
revoke all on table private.ops_alerts from public, anon, authenticated, service_role;

create function private.ops_status(p_now timestamptz) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'schema_version', private.schema_version(),
    'queue_depth', (select count(*) from pgmq.q_followup_actions),
    'queue_oldest_seconds', (select coalesce(extract(epoch from p_now - min(enqueued_at))::int, 0) from pgmq.q_followup_actions),
    'due_not_enqueued', (select count(*) from public.invoices i join public.tenants t on t.id = i.tenant_id
                         where i.status in ('open', 'overdue', 'promised', 'escalated') and i.next_action_at <= p_now
                           and i.enqueued_at is null and i.parked_reason is null and not t.outbound_paused),
    'parked_invoices', (select count(*) from public.invoices where parked_reason is not null),
    'unknown_messages', (select count(*) from public.messages where send_state = 'unknown'),
    'dead_letters_24h', (select count(*) from public.dead_letters where created_at > p_now - interval '24 hours'),
    'pending_approvals', (select count(*) from public.approvals where status = 'pending'),
    'oldest_pending_approval_hours', (select coalesce(extract(epoch from p_now - min(requested_at))::int / 3600, 0) from public.approvals where status = 'pending'),
    'unprocessed_inbound', (select count(*) from public.inbound_events where processed_at is null),
    'unprocessed_payment_events', (select count(*) from public.payment_events where processed_at is null),
    'paused_tenants', (select count(*) from public.tenants where outbound_paused),
    'global_paused', private.flag('outbound_paused'),
    'heartbeats', (select coalesce(jsonb_agg(jsonb_build_object('service', service, 'instance', instance_id, 'version', version,
                     'seen_seconds_ago', extract(epoch from p_now - last_seen_at)::int,
                     'ok_seconds_ago', case when last_ok_at is null then null else extract(epoch from p_now - last_ok_at)::int end) order by service, instance_id), '[]')
                   from private.service_heartbeats)
  )
$$;
revoke all on function private.ops_status(timestamptz) from public, anon, authenticated, service_role;
