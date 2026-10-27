-- 0002_integrity.sql: database-enforced invariants (issues A, D, E, G, I). See ADRs 0006, 0007, 0009.

-- D. Legal status transitions, as data. MUST equal packages/core TRANSITIONS (drift test in packages/db).
create table private.invoice_status_transitions (
  event text not null,
  from_status text not null,
  to_status text not null,
  primary key (from_status, to_status, event)
);
insert into private.invoice_status_transitions (event, from_status, to_status) values
  ('due_date_passed', 'open', 'overdue'),
  ('promise_accepted', 'overdue', 'promised'),
  ('promise_broken', 'promised', 'overdue'),
  ('dispute_raised', 'open', 'disputed'),
  ('dispute_raised', 'overdue', 'disputed'),
  ('dispute_raised', 'promised', 'disputed'),
  ('dispute_raised', 'escalated', 'disputed'),
  ('escalation_triggered', 'overdue', 'escalated'),
  ('escalation_triggered', 'promised', 'escalated'),
  ('balance_reached_zero', 'open', 'paid'),
  ('balance_reached_zero', 'overdue', 'paid'),
  ('balance_reached_zero', 'promised', 'paid'),
  ('balance_reached_zero', 'disputed', 'paid'),
  ('balance_reached_zero', 'escalated', 'paid'),
  ('written_off', 'escalated', 'written_off'),
  ('voided', 'open', 'cancelled');

create function private.guard_invoice_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  paid bigint;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'open' then
      raise exception using errcode = '23514',
        message = format('a new invoice must start as open, not %s', new.status);
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if old.status in ('paid', 'written_off', 'cancelled') then
      raise exception using errcode = '23514',
        message = format('invoice %s is %s, a final state; its status can never change', old.id, old.status);
    end if;
    if not exists (
      select 1 from private.invoice_status_transitions t
      where t.from_status = old.status and t.to_status = new.status
    ) then
      raise exception using errcode = '23514',
        message = format('illegal invoice status transition %s -> %s', old.status, new.status);
    end if;
  end if;

  -- The total may never drop below what has already been confirmed paid.
  if new.amount_total < old.amount_total then
    select coalesce(sum(p.amount), 0) into paid
    from public.payments p where p.tenant_id = new.tenant_id and p.invoice_id = new.id;
    if new.amount_total < paid then
      raise exception using errcode = '23514',
        message = format('amount_total %s is below the confirmed payments %s', new.amount_total, paid);
    end if;
  end if;

  new.updated_at := now();
  return new;
end $$;

create trigger invoices_guard
  before insert or update on public.invoices
  for each row execute function private.guard_invoice_write();

-- E. invoice_events is append-only. No UPDATE ever; DELETE only while purging a whole tenant (ADR 0009).
create function private.guard_invoice_events() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' and current_setting('dueloop.purging_tenant', true) = old.tenant_id::text then
    return old;
  end if;
  raise exception using errcode = '23514',
    message = format('invoice_events is append-only: %s is not allowed', tg_op);
end $$;

create trigger invoice_events_no_update_delete
  before update or delete on public.invoice_events
  for each row execute function private.guard_invoice_events();
create trigger invoice_events_no_truncate
  before truncate on public.invoice_events
  for each statement execute function private.guard_invoice_events();

-- Tenant removal: the only way events disappear. Not exposed (private schema); run by an operator as postgres.
create function private.purge_tenant(p_tenant uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('dueloop.purging_tenant', p_tenant::text, true);
  delete from public.tenants where id = p_tenant;
  perform set_config('dueloop.purging_tenant', '', true);
end $$;
revoke all on function private.purge_tenant(uuid) from public, anon, authenticated, service_role;

-- I. tenants.timezone must be an IANA zone name. Mirrors core isIanaZone(): Postgres zone names minus
-- offset-shaped names and 'Factory', which core rejects (checked against all 598 names by a drift test).
create function private.guard_tenant_timezone() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.timezone ~* '^[+-]|^(UTC|GMT)[+-]'
     or new.timezone = 'Factory'
     or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = new.timezone) then
    raise exception using errcode = '23514',
      message = format('not a valid IANA time zone: %s', new.timezone);
  end if;
  return new;
end $$;

create trigger tenants_timezone_guard
  before insert or update of timezone on public.tenants
  for each row execute function private.guard_tenant_timezone();

-- A. The balance is derived, never stored: total minus the sum of confirmed payments.
-- security_invoker: callers see only rows their own RLS policies allow.
create view public.invoice_balances with (security_invoker = true) as
select
  i.tenant_id,
  i.id as invoice_id,
  i.currency,
  i.amount_total,
  coalesce(sum(p.amount), 0)::bigint as amount_paid,
  (i.amount_total - coalesce(sum(p.amount), 0))::bigint as balance
from public.invoices i
left join public.payments p on p.tenant_id = i.tenant_id and p.invoice_id = i.id
group by i.tenant_id, i.id;

-- H. The due-invoice rule for the scheduler (prompt 3). Statuses decide() may still act on; the tenant
-- kill switch excludes a whole tenant.
create view public.invoices_due with (security_invoker = true) as
select i.id, i.tenant_id, i.status, i.next_action_at
from public.invoices i
join public.tenants t on t.id = i.tenant_id
where i.status in ('open', 'overdue', 'promised', 'escalated')
  and i.next_action_at <= now()
  and not t.outbound_paused;
