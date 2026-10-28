-- Prompt 6, Part A (ADR 0042): what the staff dashboard needs from the database.
-- 1. Last-owner protection on memberships (issue M), serialised per tenant so concurrent demotions cannot race.
-- 2. Member listing with emails, role change and removal (owner only, checked inside the function).
-- 3. nav_counters: cheap counts for the nav (RLS applies: security invoker).
-- 4. is_globally_paused(): the global kill switch as a boolean only (system_flags stays service-only).
-- 5. audit_export: owner/accountant, capped, logs AuditExported in the same transaction (issue Q).
-- Pattern (issue F test): security definer code lives in `private`; `public` has invoker wrappers; anon gets nothing.

-- ---------------------------------------------------------------------------------------------------------
-- Tenant events added in this phase.
alter table public.tenant_events drop constraint tenant_events_type_check;
alter table public.tenant_events add constraint tenant_events_type_check check (type in (
  'OptOutRecorded', 'ReplyUnmatched', 'ReplyAmbiguous', 'DeliveryFailed', 'InboundDeadLettered', 'AutoReplyReceived',
  'PaymentUnmatched', 'PaymentEventDeadLettered',
  'AuditExported', 'MemberRoleChanged', 'MemberRemoved'
));

-- ---------------------------------------------------------------------------------------------------------
-- 1. Last owner. The tenant row is locked first, so two transactions demoting the last two owners run one after
-- the other and the second sees the first's change. A cascade from deleting the tenant itself (purge) is allowed:
-- the tenant row is already gone by then.
create function private.guard_last_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.role <> 'owner' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'UPDATE' and new.role = 'owner' and new.tenant_id = old.tenant_id then
    return new;
  end if;
  perform 1 from public.tenants where id = old.tenant_id for update;
  if not found then
    return case when tg_op = 'DELETE' then old else new end; -- tenant being deleted
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.tenant_id = old.tenant_id and m.role = 'owner' and m.user_id <> old.user_id
  ) then
    raise exception using errcode = '23514', message = 'a tenant must keep at least one owner';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function private.guard_last_owner() from public, anon, authenticated;

create trigger memberships_last_owner
  before update or delete on public.memberships
  for each row execute function private.guard_last_owner();

-- ---------------------------------------------------------------------------------------------------------
-- 2. Members. Emails live in auth.users, which no API role can read; this returns them for the caller's own
-- tenant only (any member may list, ADR 0042 members.view).
create function private.list_members_impl(p_tenant uuid)
returns table (user_id uuid, email text, role text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.memberships m where m.tenant_id = p_tenant and m.user_id = (select auth.uid())) then
    raise exception using errcode = '42501', message = 'not a member of this tenant';
  end if;
  return query
    select m.user_id, u.email::text, m.role, m.created_at
    from public.memberships m join auth.users u on u.id = m.user_id
    where m.tenant_id = p_tenant
    order by m.created_at, m.user_id;
end $$;
revoke all on function private.list_members_impl(uuid) from public, anon;
grant execute on function private.list_members_impl(uuid) to authenticated;

create function public.list_members(p_tenant uuid)
returns table (user_id uuid, email text, role text, created_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select * from private.list_members_impl(p_tenant)
$$;
revoke all on function public.list_members(uuid) from public, anon;
grant execute on function public.list_members(uuid) to authenticated;

create function private.require_owner(p_tenant uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.memberships m where m.tenant_id = p_tenant and m.user_id = (select auth.uid()) and m.role = 'owner'
  ) then
    raise exception using errcode = '42501', message = 'only an owner may do this';
  end if;
end $$;
revoke all on function private.require_owner(uuid) from public, anon;
grant execute on function private.require_owner(uuid) to authenticated;

create function private.set_member_role_impl(p_tenant uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_old text;
begin
  perform private.require_owner(p_tenant);
  if p_role not in ('owner', 'accountant', 'collector') then
    raise exception using errcode = '22023', message = 'unknown role';
  end if;
  select role into v_old from public.memberships where tenant_id = p_tenant and user_id = p_user;
  if not found then raise exception using errcode = 'P0002', message = 'member not found'; end if;
  if v_old = p_role then return; end if;
  update public.memberships set role = p_role where tenant_id = p_tenant and user_id = p_user; -- last-owner trigger
  insert into public.tenant_events (tenant_id, type, payload, idempotency_key)
  values (p_tenant, 'MemberRoleChanged',
          jsonb_build_object('user_id', p_user, 'from', v_old, 'to', p_role, 'by', (select auth.uid())),
          format('member-role:%s:%s', p_user, gen_random_uuid()));
end $$;
revoke all on function private.set_member_role_impl(uuid, uuid, text) from public, anon;
grant execute on function private.set_member_role_impl(uuid, uuid, text) to authenticated;

create function public.set_member_role(p_tenant uuid, p_user uuid, p_role text) returns void
language sql security invoker set search_path = '' as $$
  select private.set_member_role_impl(p_tenant, p_user, p_role)
$$;
revoke all on function public.set_member_role(uuid, uuid, text) from public, anon;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;

create function private.remove_member_impl(p_tenant uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_old text;
begin
  perform private.require_owner(p_tenant);
  delete from public.memberships where tenant_id = p_tenant and user_id = p_user returning role into v_old; -- trigger
  if not found then raise exception using errcode = 'P0002', message = 'member not found'; end if;
  insert into public.tenant_events (tenant_id, type, payload, idempotency_key)
  values (p_tenant, 'MemberRemoved', jsonb_build_object('user_id', p_user, 'role', v_old, 'by', (select auth.uid())),
          format('member-removed:%s:%s', p_user, gen_random_uuid()));
end $$;
revoke all on function private.remove_member_impl(uuid, uuid) from public, anon;
grant execute on function private.remove_member_impl(uuid, uuid) to authenticated;

create function public.remove_member(p_tenant uuid, p_user uuid) returns void
language sql security invoker set search_path = '' as $$
  select private.remove_member_impl(p_tenant, p_user)
$$;
revoke all on function public.remove_member(uuid, uuid) from public, anon;
grant execute on function public.remove_member(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- 3. Nav counters. Security invoker: RLS limits every count to the caller's tenants. Partial indexes keep them
-- cheap (the approvals and tasks ones exist from 0007/0009 for the CLIs; the rest are added here).
create index if not exists approvals_tenant_pending_idx on public.approvals (tenant_id) where status = 'pending';
create index if not exists tasks_tenant_open_idx on public.tasks (tenant_id) where status = 'open';
create index if not exists messages_tenant_unknown_idx on public.messages (tenant_id) where send_state = 'unknown';
create index if not exists payment_proofs_tenant_pending_idx on public.payment_proofs (tenant_id) where status = 'pending';

create function public.nav_counters(p_tenant uuid)
returns table (approvals bigint, tasks bigint, unknown_messages bigint, proofs bigint)
language sql stable security invoker set search_path = '' as $$
  select
    (select count(*) from public.approvals where tenant_id = p_tenant and status = 'pending'),
    (select count(*) from public.tasks where tenant_id = p_tenant and status = 'open'),
    (select count(*) from public.messages where tenant_id = p_tenant and send_state = 'unknown'),
    (select count(*) from public.payment_proofs where tenant_id = p_tenant and status = 'pending')
$$;
revoke all on function public.nav_counters(uuid) from public, anon;
grant execute on function public.nav_counters(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- 4. Global kill switch, as a boolean. private.system_flags stays unreachable from the API.
create function private.is_globally_paused_impl() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.flag('outbound_paused')
$$;
revoke all on function private.is_globally_paused_impl() from public, anon;
grant execute on function private.is_globally_paused_impl() to authenticated;

create function public.is_globally_paused() returns boolean
language sql stable security invoker set search_path = '' as $$
  select private.is_globally_paused_impl()
$$;
revoke all on function public.is_globally_paused() from public, anon;
grant execute on function public.is_globally_paused() to authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- 5. Audit export (issue Q). One call returns the rows (capped) and records who exported what range and how
-- many rows, in the same transaction. Payload keys that can carry contact details, message text, model text or
-- secrets are dropped (rules 19, 20, 25): the export is an audit trail of WHAT happened, not a data dump.
create function private.audit_safe_payload(p jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
  from jsonb_each(p) as e(k, v)
  where k !~* '(email|phone|body|text|summary|subject|token|secret|key|address|name|draft|note|url|hint|raw|content)'
$$;
revoke all on function private.audit_safe_payload(jsonb) from public, anon;
grant execute on function private.audit_safe_payload(jsonb) to authenticated;

create function private.audit_export_impl(p_tenant uuid, p_from timestamptz, p_to timestamptz, p_max integer)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_rows jsonb;
  v_count integer;
  v_total integer;
  v_cap integer := least(greatest(coalesce(p_max, 10000), 1), 50000);
begin
  if not exists (
    select 1 from public.memberships m
    where m.tenant_id = p_tenant and m.user_id = (select auth.uid()) and m.role in ('owner', 'accountant')
  ) then
    raise exception using errcode = '42501', message = 'only an owner or accountant may export the audit log';
  end if;
  if p_from is null or p_to is null or p_to <= p_from then
    raise exception using errcode = '22023', message = 'a valid time range is required';
  end if;

  with ev as (
    select e.created_at, 'invoice'::text as scope, i.number as invoice_number, e.type, e.idempotency_key,
           private.audit_safe_payload(e.payload) as payload
    from public.invoice_events e join public.invoices i on i.tenant_id = e.tenant_id and i.id = e.invoice_id
    where e.tenant_id = p_tenant and e.created_at >= p_from and e.created_at < p_to
    union all
    select t.created_at, 'tenant', null, t.type, t.idempotency_key, private.audit_safe_payload(t.payload)
    from public.tenant_events t
    where t.tenant_id = p_tenant and t.created_at >= p_from and t.created_at < p_to
  ), numbered as (
    select ev.*, count(*) over () as total from ev order by created_at, type, idempotency_key limit v_cap
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'at', created_at, 'scope', scope, 'invoice_number', invoice_number, 'type', type,
           'key', idempotency_key, 'payload', payload) order by created_at, type, idempotency_key), '[]'::jsonb),
         count(*), coalesce(max(total), 0)
    into v_rows, v_count, v_total
  from numbered;

  insert into public.tenant_events (tenant_id, type, payload, idempotency_key)
  values (p_tenant, 'AuditExported',
          jsonb_build_object('by', (select auth.uid()), 'from', p_from, 'to', p_to, 'rows', v_count, 'truncated', v_total > v_count),
          format('audit-export:%s', gen_random_uuid()));

  return jsonb_build_object('rows', v_rows, 'count', v_count, 'truncated', v_total > v_count);
end $$;
revoke all on function private.audit_export_impl(uuid, timestamptz, timestamptz, integer) from public, anon;
grant execute on function private.audit_export_impl(uuid, timestamptz, timestamptz, integer) to authenticated;

create function public.audit_export(p_tenant uuid, p_from timestamptz, p_to timestamptz, p_max integer default 10000)
returns jsonb
language sql security invoker set search_path = '' as $$
  select private.audit_export_impl(p_tenant, p_from, p_to, p_max)
$$;
revoke all on function public.audit_export(uuid, timestamptz, timestamptz, integer) from public, anon;
grant execute on function public.audit_export(uuid, timestamptz, timestamptz, integer) to authenticated;

-- List exports are recorded too (who exported which list, row count), through this small owner/accountant/collector
-- RPC called by the export route after it has streamed the file.
create function private.log_list_export_impl(p_tenant uuid, p_list text, p_rows integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.memberships m where m.tenant_id = p_tenant and m.user_id = (select auth.uid())) then
    raise exception using errcode = '42501', message = 'not a member of this tenant';
  end if;
  if p_list not in ('invoices', 'customers') then raise exception using errcode = '22023', message = 'unknown list'; end if;
  insert into public.tenant_events (tenant_id, type, payload, idempotency_key)
  values (p_tenant, 'AuditExported', jsonb_build_object('by', (select auth.uid()), 'list', p_list, 'rows', greatest(p_rows, 0)),
          format('list-export:%s', gen_random_uuid()));
end $$;
revoke all on function private.log_list_export_impl(uuid, text, integer) from public, anon;
grant execute on function private.log_list_export_impl(uuid, text, integer) to authenticated;

create function public.log_list_export(p_tenant uuid, p_list text, p_rows integer) returns void
language sql security invoker set search_path = '' as $$
  select private.log_list_export_impl(p_tenant, p_list, p_rows)
$$;
revoke all on function public.log_list_export(uuid, text, integer) from public, anon;
grant execute on function public.log_list_export(uuid, text, integer) to authenticated;
