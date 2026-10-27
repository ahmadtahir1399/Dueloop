-- 0008_queue.sql: the follow-up job queue (pgmq, available in the local Supabase image), the due-invoice
-- enqueue with an injectable as_of (issue G), sweeps, and cron that only says "wake up". ADR 0013, 0017.
-- Function signatures checked against the installed pgmq 1.5.1 / pg_cron 1.6.4 (\df) and Supabase docs.

create extension if not exists pgmq;
create extension if not exists pg_cron;
select pgmq.create('followup_actions');

-- Parking keeps next_action_at NOT NULL (prompt 2, issue H): a parked invoice waits at 'infinity' with a
-- reason, and an operator command sets it back to now.
alter table public.invoices add column parked_reason text check (parked_reason is null or length(parked_reason) <= 100);

create function private.flag(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select enabled from private.system_flags where key = p_key), false)
$$;

-- Enqueue invoices whose next action is due at p_as_of. A job is re-enqueued only after the stale period
-- (a crashed worker never ack'd it). SKIP LOCKED + the enqueued_at stamp in the same transaction mean two
-- concurrent calls never enqueue the same invoice twice.
create function private.enqueue_due_actions(p_batch integer default 500, p_as_of timestamptz default now())
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  n integer := 0;
  r record;
begin
  if private.flag('outbound_paused') then
    return 0; -- global kill switch: nothing new is queued (the worker also checks at send time)
  end if;
  for r in
    select i.id, i.tenant_id
    from public.invoices i
    join public.tenants t on t.id = i.tenant_id and not t.outbound_paused
    where i.status in ('open', 'overdue', 'promised', 'escalated')
      and i.next_action_at <= p_as_of
      and (i.enqueued_at is null or i.enqueued_at < p_as_of - interval '15 minutes')
    order by i.next_action_at
    limit p_batch
    for update of i skip locked
  loop
    perform pgmq.send('followup_actions', jsonb_build_object('invoice_id', r.id, 'tenant_id', r.tenant_id));
    update public.invoices set enqueued_at = p_as_of where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Claim up to p_n jobs, invisible to other workers for p_vt seconds. p_filter uses pgmq's conditional
-- read (jsonb containment, verified on 1.5.1), e.g. {"tenant_id": "..."} for a per-tenant worker.
create function private.claim_actions(p_n integer, p_vt_seconds integer, p_filter jsonb default '{}')
returns table (msg_id bigint, read_ct integer, invoice_id uuid, tenant_id uuid)
language sql security definer set search_path = '' as $$
  select m.msg_id, m.read_ct, (m.message ->> 'invoice_id')::uuid, (m.message ->> 'tenant_id')::uuid
  from pgmq.read('followup_actions', p_vt_seconds, p_n, p_filter) m
$$;

-- Ack: the job is done (archived for audit).
create function private.ack_action(p_msg_id bigint) returns boolean
language sql security definer set search_path = '' as $$
  select pgmq.archive('followup_actions', p_msg_id)
$$;

-- Release: make the job visible again after p_delay_seconds (also used for retry backoff).
create function private.release_action(p_msg_id bigint, p_delay_seconds integer) returns void
language sql security definer set search_path = '' as $$
  select from pgmq.set_vt('followup_actions', p_msg_id, p_delay_seconds)
$$;

-- Too many attempts: dead letter (ids and reason only), archive the job, park the invoice.
create function private.dead_letter_action(p_msg_id bigint, p_reason text, p_attempts integer)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  msg jsonb;
  inv uuid;
  ten uuid;
begin
  select q.message into msg from pgmq.q_followup_actions q where q.msg_id = p_msg_id;
  if msg is null then return; end if;
  inv := (msg ->> 'invoice_id')::uuid;
  ten := (msg ->> 'tenant_id')::uuid;
  insert into public.dead_letters (tenant_id, invoice_id, source, reason, attempts, payload)
  values (ten, inv, 'followup_actions', left(p_reason, 200), p_attempts, jsonb_build_object('msgId', p_msg_id, 'invoiceId', inv));
  update public.invoices set next_action_at = 'infinity', parked_reason = 'dead_letter', enqueued_at = null
  where tenant_id = ten and id = inv;
  perform pgmq.archive('followup_actions', p_msg_id);
end $$;

-- Stale sweep: a message pending longer than the threshold is in an UNKNOWN state (it may have been
-- delivered). Never resent automatically (rule 17): park the invoice for a human to reconcile.
create function private.sweep_stale_messages(p_threshold interval, p_as_of timestamptz default now())
returns table (tenant_id uuid, invoice_id uuid, message_id uuid)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  return query
  with stale as (
    update public.messages m set send_state = 'unknown', failed_reason = 'stale_pending'
    where m.send_state = 'pending' and m.pending_since < p_as_of - p_threshold
    returning m.tenant_id, m.id, m.idempotency_key
  ), linked as (
    select s.tenant_id, mi.invoice_id, s.id as message_id, s.idempotency_key
    from stale s join public.message_invoices mi on mi.tenant_id = s.tenant_id and mi.message_id = s.id
  ), events as (
    insert into public.invoice_events (tenant_id, invoice_id, type, payload, idempotency_key)
    select l.tenant_id, l.invoice_id, 'MessageStateUnknown', jsonb_build_object('messageId', l.message_id), l.idempotency_key || ':unknown'
    from linked l
    on conflict (tenant_id, idempotency_key) do nothing
  ), parked as (
    update public.invoices i set next_action_at = 'infinity', parked_reason = 'message_unknown', enqueued_at = null
    from linked l where i.tenant_id = l.tenant_id and i.id = l.invoice_id
  )
  select l.tenant_id, l.invoice_id, l.message_id from linked l;
end $$;

-- Approvals pending too long expire and the invoice re-enters decide() (issue E). ADR 0015.
create function private.expire_approvals(p_max_age interval, p_as_of timestamptz default now())
returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  with expired as (
    update public.approvals a set status = 'expired', decided_at = p_as_of, decided_by = 'system'
    where a.status = 'pending' and a.requested_at < p_as_of - p_max_age
    returning a.tenant_id, a.invoice_id, a.idempotency_key, a.version
  ), events as (
    insert into public.invoice_events (tenant_id, invoice_id, type, payload, idempotency_key)
    select e.tenant_id, e.invoice_id, 'ApprovalExpired', jsonb_build_object('version', e.version),
           format('%s:approval-expired:v%s', e.idempotency_key, e.version)
    from expired e
    on conflict (tenant_id, idempotency_key) do nothing
  ), resumed as (
    update public.invoices i set next_action_at = p_as_of, parked_reason = null, enqueued_at = null
    from expired e where i.tenant_id = e.tenant_id and i.id = e.invoice_id
  )
  select count(*) into n from expired;
  return n;
end $$;

-- Operator command: un-park an invoice (after fixing a template, account, budget or reconciling a message).
create function private.unpark_invoice(p_invoice_id uuid, p_as_of timestamptz default now()) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.invoices set next_action_at = p_as_of, parked_reason = null, enqueued_at = null
  where id = p_invoice_id and parked_reason is not null;
  return found;
end $$;

-- Cron entry point: only "wake up". Disabled by private.system_flags('cron_enabled') (tests use a fake clock).
create function private.cron_tick(p_kind text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.flag('cron_enabled') then return; end if;
  if p_kind = 'enqueue' then
    perform private.enqueue_due_actions(500, now());
  elsif p_kind = 'sweep' then
    perform private.sweep_stale_messages(interval '15 minutes', now());
  elsif p_kind = 'expire' then
    perform private.expire_approvals(interval '7 days', now());
  end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'private.flag(text)',
    'private.enqueue_due_actions(integer, timestamptz)',
    'private.claim_actions(integer, integer, jsonb)',
    'private.ack_action(bigint)',
    'private.release_action(bigint, integer)',
    'private.dead_letter_action(bigint, text, integer)',
    'private.sweep_stale_messages(interval, timestamptz)',
    'private.expire_approvals(interval, timestamptz)',
    'private.unpark_invoice(uuid, timestamptz)',
    'private.cron_tick(text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;
end $$;

-- pg_cron runs in UTC. Cron only wakes things up; decide() decides what is allowed (guide 6.3).
select cron.schedule('dueloop-enqueue', '* * * * *', $$select private.cron_tick('enqueue')$$);
select cron.schedule('dueloop-sweep', '*/5 * * * *', $$select private.cron_tick('sweep')$$);
select cron.schedule('dueloop-expire-approvals', '17 * * * *', $$select private.cron_tick('expire')$$);
