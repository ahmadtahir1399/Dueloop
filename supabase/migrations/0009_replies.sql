-- Prompt 4: replies + promises. Inbound provider events (raw, PII, purged), inbound messages, promises,
-- human tasks, tenant-level events, and the inbound queue. Role matrix: ADR 0022 (written before this file).

-- Tenant settings (issue E) and the per-tenant daily classification cap (pipeline step 7).
alter table public.tenants
  add column promise_acceptance text not null default 'auto' check (promise_acceptance in ('auto', 'review')),
  add column classification_daily_cap integer not null default 500 check (classification_daily_cap >= 0);

-- One provider account id belongs to ONE tenant, globally (the WhatsApp phone-number id, the IMAP mailbox).
alter table public.channel_accounts add column external_account_id text check (external_account_id is null or length(external_account_id) between 1 and 200);
create unique index channel_accounts_external_unique on public.channel_accounts (channel, external_account_id) where external_account_id is not null;

-- Inbound messages. An unknown sender has no customer (pipeline step 4), so customer_id is optional for 'in'.
alter table public.messages alter column customer_id drop not null;
alter table public.messages add constraint messages_out_has_customer check (direction = 'in' or customer_id is not null);
alter table public.messages
  add column in_reply_to text check (in_reply_to is null or length(in_reply_to) <= 1000),
  add column thread_refs text[] not null default '{}',
  add column provider_timestamp timestamptz,
  add column received_at timestamptz,
  add column body_new_text text check (body_new_text is null or length(body_new_text) <= 20000),
  add column attachments jsonb not null default '[]' check (jsonb_typeof(attachments) = 'array'),
  add column sender_ref text check (sender_ref is null or length(sender_ref) <= 320), -- normalised sender, only for 'in'
  add column matched_by text check (matched_by in ('thread', 'context_id', 'single_open_invoice', 'none')),
  add column processed_at timestamptz,
  add column prefilter text check (prefilter in ('bounce', 'auto_reply', 'delivery_receipt', 'own_address', 'empty', 'opt_out_keyword', 'none')),
  add column model_id text check (model_id is null or length(model_id) <= 200),
  add column prompt_version text check (prompt_version is null or length(prompt_version) <= 50),
  add column classify_latency_ms integer check (classify_latency_ms is null or classify_latency_ms >= 0),
  add column tokens_in integer check (tokens_in is null or tokens_in >= 0),
  add column tokens_out integer check (tokens_out is null or tokens_out >= 0),
  add column delivery_status_at timestamptz,
  add column inbound_event_id bigint;
create index messages_in_reply_idx on public.messages (tenant_id, rfc_message_id) where rfc_message_id is not null;
create index messages_inbound_customer_idx on public.messages (tenant_id, customer_id, created_at) where direction = 'in';

-- Raw provider events: the logbook of every envelope. PII: no client role can read them; purged on schedule.
create table public.inbound_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  channel_account_id uuid not null,
  provider text not null check (provider in ('whatsapp', 'imap')),
  provider_event_id text not null check (length(provider_event_id) between 1 and 500),
  kind text not null check (kind in ('message', 'status')),
  payload jsonb check (payload is null or jsonb_typeof(payload) = 'object'),
  raw_mime text check (raw_mime is null or octet_length(raw_mime) <= 10485760),
  received_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'processed', 'dead')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text check (last_error is null or length(last_error) <= 200), -- a code, never provider text
  processed_at timestamptz,
  purge_after timestamptz not null,
  check (payload is not null or raw_mime is not null),
  unique (tenant_id, id),
  unique (tenant_id, provider, provider_event_id),
  foreign key (tenant_id, channel_account_id) references public.channel_accounts (tenant_id, id) on delete cascade
);
create index inbound_events_purge_idx on public.inbound_events (purge_after);
alter table public.messages add constraint messages_inbound_event_fk
  foreign key (tenant_id, inbound_event_id) references public.inbound_events (tenant_id, id) on delete set null (inbound_event_id);

-- Promises (issue D, G): at most one active promise per invoice.
create table public.promises (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  invoice_id uuid not null,
  customer_id uuid not null,
  source_message_id uuid,
  promised_on date not null,
  -- When the customer wrote it (issue K); an older message never supersedes a newer promise.
  reference_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'kept', 'broken', 'superseded', 'cancelled')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text check (resolved_by is null or length(resolved_by) <= 100),
  resolution_note text check (resolution_note is null or length(resolution_note) <= 500),
  superseded_by uuid,
  check ((status = 'active') = (resolved_at is null)),
  unique (tenant_id, id),
  unique (tenant_id, source_message_id),
  foreign key (tenant_id, invoice_id) references public.invoices (tenant_id, id),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id),
  foreign key (tenant_id, source_message_id) references public.messages (tenant_id, id),
  foreign key (tenant_id, superseded_by) references public.promises (tenant_id, id)
);
create unique index promises_one_active on public.promises (tenant_id, invoice_id) where status = 'active';

-- Human tasks (issue D). Every reply that is not a clear, legal, trusted effect becomes one of these.
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  type text not null check (type in (
    'review_promise', 'verify_payment_claim', 'dispute', 'info_request', 'human_review',
    'ambiguous_invoice', 'unmatched_inbound', 'unprocessed_inbound', 'delivery_failed', 'invalid_contact'
  )),
  reason text check (reason is null or reason ~ '^[a-z_]{1,60}$'), -- a typed reason code (core ReviewReason)
  status text not null default 'open' check (status in ('open', 'resolved')),
  assignee uuid references auth.users (id) on delete set null,
  invoice_id uuid,
  customer_id uuid,
  message_id uuid,
  -- Candidates for 'ambiguous_invoice' (ids and numbers only).
  details jsonb not null default '{}' check (jsonb_typeof(details) = 'object'),
  -- A DRAFT for a human to edit and send themselves. Never sent automatically (rule 22).
  draft_reply text check (draft_reply is null or length(draft_reply) <= 5000),
  blocks_reminders_until timestamptz,
  block_expiry_alerted boolean not null default false,
  -- Exactly-once effects: one task per (source, type), so a re-delivered event cannot create a second one.
  dedupe_key text not null check (length(dedupe_key) between 1 and 300),
  created_at timestamptz not null,
  resolved_at timestamptz,
  resolved_by text check (resolved_by is null or length(resolved_by) <= 100),
  resolution_note text check (resolution_note is null or length(resolution_note) <= 500),
  check ((status = 'open') = (resolved_at is null)),
  unique (tenant_id, id),
  unique (tenant_id, dedupe_key),
  foreign key (tenant_id, invoice_id) references public.invoices (tenant_id, id),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id),
  foreign key (tenant_id, message_id) references public.messages (tenant_id, id)
);
create index tasks_open_blocking_idx on public.tasks (tenant_id, invoice_id, blocks_reminders_until) where status = 'open';
create index tasks_open_idx on public.tasks (tenant_id, status, created_at);

-- Tenant- and customer-level events (issue H): same immutability as invoice_events.
create table public.tenant_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  customer_id uuid,
  message_id uuid,
  type text not null check (type in (
    'OptOutRecorded', 'ReplyUnmatched', 'ReplyAmbiguous', 'DeliveryFailed', 'InboundDeadLettered', 'AutoReplyReceived'
  )),
  payload jsonb not null default '{}' check (jsonb_typeof(payload) = 'object'),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id),
  foreign key (tenant_id, message_id) references public.messages (tenant_id, id)
);
create index tenant_events_tenant_idx on public.tenant_events (tenant_id, created_at);

create function private.guard_tenant_events() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' and current_setting('dueloop.purging_tenant', true) = old.tenant_id::text then
    return old;
  end if;
  raise exception using errcode = '23514', message = format('tenant_events is append-only: %s is not allowed', tg_op);
end $$;
create trigger tenant_events_no_update_delete before update or delete on public.tenant_events
  for each row execute function private.guard_tenant_events();
create trigger tenant_events_no_truncate before truncate on public.tenant_events
  for each statement execute function private.guard_tenant_events();

-- New invoice event types (packages/db/src/events.ts must match: drift test).
alter table public.invoice_events drop constraint invoice_events_type_check;
alter table public.invoice_events add constraint invoice_events_type_check check (type in (
  'ReminderScheduled', 'ReminderSent', 'ReminderFailed', 'ReplyReceived', 'ReplyClassified',
  'PromiseRecorded', 'PromiseBroken', 'DisputeRaised', 'ProofSubmitted', 'ProofVerified',
  'PaymentConfirmed', 'PartialPaymentConfirmed', 'InvoiceEscalated', 'InvoiceWrittenOff',
  'OptOutRecorded', 'ApprovalRequested', 'ApprovalGranted', 'ApprovalRejected',
  'InvoiceImported', 'InvoiceImportUpdated',
  'InvoiceOverdue', 'ReminderSkipped', 'ReminderParked', 'ApprovalExpired', 'ApprovalSuperseded',
  'MessageStateUnknown', 'MessageReconciled',
  'PromiseSuperseded', 'PromiseCancelled', 'PaymentClaimReceived', 'ReplyNeedsReview', 'DeliveryFailed',
  'RemindersBlocked', 'RemindersResumed'
));

-- RLS (ADR 0022).
do $$
declare t text;
begin
  foreach t in array array['inbound_events', 'promises', 'tasks', 'tenant_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated, service_role', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;
grant select on table public.promises, public.tasks, public.tenant_events to authenticated;
-- inbound_events: no grant and no policy for authenticated. Raw payloads are PII (rule 25).

create policy promises_select on public.promises for select to authenticated
  using (tenant_id in (select private.my_tenant_ids()));
create policy tasks_select on public.tasks for select to authenticated
  using (tenant_id in (select private.my_tenant_ids()));
create policy tenant_events_select on public.tenant_events for select to authenticated
  using (tenant_id in (select private.my_tenant_ids()));

-- Task and promise RPCs: the only client writes (ADR 0022). Security definer in private, invoker wrappers.
create function private.resolve_task_impl(p_task_id uuid, p_resolve boolean, p_note text, p_actor text, p_as_of timestamptz)
returns text language plpgsql security definer set search_path = '' as $$
declare t public.tasks%rowtype;
begin
  select * into t from public.tasks where id = p_task_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'task not found'; end if;
  if not private.is_trusted_caller() and not exists (
    select 1 from public.memberships m where m.tenant_id = t.tenant_id and m.user_id = (select auth.uid())
  ) then
    raise exception using errcode = '42501', message = 'only a member of the tenant may work its tasks';
  end if;
  if p_resolve then
    if t.status = 'resolved' then return 'already_resolved'; end if;
    if p_note is null or length(btrim(p_note)) = 0 then
      raise exception using errcode = '22023', message = 'resolving a task needs a note (who and why is recorded)';
    end if;
    update public.tasks set status = 'resolved', resolved_at = p_as_of,
      resolved_by = coalesce(p_actor, (select auth.uid())::text, 'unknown'), resolution_note = p_note,
      blocks_reminders_until = null
    where id = t.id;
    -- A resolved task no longer blocks reminders: the invoice re-enters decide() now.
    if t.invoice_id is not null and t.blocks_reminders_until is not null then
      update public.invoices set next_action_at = p_as_of, enqueued_at = null
      where tenant_id = t.tenant_id and id = t.invoice_id and parked_reason is null;
    end if;
    return 'resolved';
  end if;
  if t.status = 'open' then return 'already_open'; end if;
  update public.tasks set status = 'open', resolved_at = null, resolved_by = null,
    resolution_note = coalesce(p_note, resolution_note)
  where id = t.id;
  return 'reopened';
end $$;
revoke all on function private.resolve_task_impl(uuid, boolean, text, text, timestamptz) from public, anon;
grant execute on function private.resolve_task_impl(uuid, boolean, text, text, timestamptz) to authenticated;

create function public.resolve_task(p_task_id uuid, p_note text)
returns text language sql security invoker set search_path = '' as $$
  select private.resolve_task_impl(p_task_id, true, p_note, null, now())
$$;
create function public.reopen_task(p_task_id uuid, p_note text default null)
returns text language sql security invoker set search_path = '' as $$
  select private.resolve_task_impl(p_task_id, false, p_note, null, now())
$$;
revoke all on function public.resolve_task(uuid, text), public.reopen_task(uuid, text) from public, anon;
grant execute on function public.resolve_task(uuid, text), public.reopen_task(uuid, text) to authenticated;

create function private.cancel_promise_impl(p_promise_id uuid, p_note text, p_actor text, p_as_of timestamptz)
returns text language plpgsql security definer set search_path = '' as $$
declare p public.promises%rowtype;
begin
  select * into p from public.promises where id = p_promise_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'promise not found'; end if;
  if not private.is_trusted_caller() and not exists (
    select 1 from public.memberships m where m.tenant_id = p.tenant_id and m.user_id = (select auth.uid()) and m.role in ('owner', 'accountant')
  ) then
    raise exception using errcode = '42501', message = 'only an owner or accountant may cancel a promise';
  end if;
  if p.status <> 'active' then return 'not_active'; end if;
  update public.promises set status = 'cancelled', resolved_at = p_as_of,
    resolved_by = coalesce(p_actor, (select auth.uid())::text, 'unknown'), resolution_note = p_note
  where id = p.id;
  insert into public.invoice_events (tenant_id, invoice_id, type, payload, idempotency_key)
  values (p.tenant_id, p.invoice_id, 'PromiseCancelled', jsonb_build_object('promiseId', p.id), format('promise:%s:cancelled', p.id))
  on conflict (tenant_id, idempotency_key) do nothing;
  -- The invoice stays 'promised' until decide() sees promisedOn + grace pass (promise_broken). Re-decide now.
  update public.invoices set next_action_at = p_as_of, enqueued_at = null where tenant_id = p.tenant_id and id = p.invoice_id;
  return 'cancelled';
end $$;
revoke all on function private.cancel_promise_impl(uuid, text, text, timestamptz) from public, anon;
grant execute on function private.cancel_promise_impl(uuid, text, text, timestamptz) to authenticated;

create function public.cancel_promise(p_promise_id uuid, p_note text default null)
returns text language sql security invoker set search_path = '' as $$
  select private.cancel_promise_impl(p_promise_id, p_note, null, now())
$$;
revoke all on function public.cancel_promise(uuid, text) from public, anon;
grant execute on function public.cancel_promise(uuid, text) to authenticated;

-- Inbound queue (same pattern as followup_actions). Storing an event and queueing it is one transaction.
select pgmq.create('inbound_events');

-- Store a VERIFIED raw event. The tenant comes from the channel account, never from the payload (step 1).
-- Returns the new event id, or null when the provider event id was already stored (provider retries).
create function private.store_inbound_event(
  p_channel_account_id uuid, p_provider text, p_provider_event_id text, p_kind text,
  p_payload jsonb, p_raw_mime text, p_received_at timestamptz, p_retention interval default interval '90 days'
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  acct public.channel_accounts%rowtype;
  new_id bigint;
begin
  select * into acct from public.channel_accounts where id = p_channel_account_id and enabled;
  if not found then raise exception using errcode = 'P0002', message = 'channel account not found'; end if;
  insert into public.inbound_events (tenant_id, channel_account_id, provider, provider_event_id, kind, payload, raw_mime, received_at, purge_after)
  values (acct.tenant_id, acct.id, p_provider, p_provider_event_id, p_kind, p_payload, p_raw_mime, p_received_at, p_received_at + p_retention)
  on conflict (tenant_id, provider, provider_event_id) do nothing
  returning id into new_id;
  if new_id is not null then
    perform pgmq.send('inbound_events', jsonb_build_object('event_id', new_id, 'tenant_id', acct.tenant_id));
  end if;
  return new_id;
end $$;

create function private.claim_inbound(p_n integer, p_vt integer, p_filter jsonb default '{}')
returns table (msg_id bigint, read_ct integer, event_id bigint, tenant_id uuid)
language sql security definer set search_path = '' as $$
  select r.msg_id, r.read_ct, (r.message ->> 'event_id')::bigint, (r.message ->> 'tenant_id')::uuid
  from pgmq.read('inbound_events', p_vt, p_n, p_filter) r
$$;
create function private.ack_inbound(p_msg_id bigint) returns boolean
language sql security definer set search_path = '' as $$ select pgmq.archive('inbound_events', p_msg_id) $$;
create function private.release_inbound(p_msg_id bigint, p_delay integer) returns void
language sql security definer set search_path = '' as $$ select pgmq.set_vt('inbound_events', p_msg_id, p_delay); $$;

-- Purge raw payloads past retention (rule 25). Messages keep the normalised text; the raw source goes.
create function private.purge_inbound(p_as_of timestamptz default now()) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  delete from public.inbound_events where purge_after < p_as_of and status <> 'pending';
  get diagnostics n = row_count;
  return n;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'private.store_inbound_event(uuid, text, text, text, jsonb, text, timestamptz, interval)',
    'private.claim_inbound(integer, integer, jsonb)',
    'private.ack_inbound(bigint)',
    'private.release_inbound(bigint, integer)',
    'private.purge_inbound(timestamptz)',
    'private.guard_tenant_events()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;
end $$;

-- Gated by cron_enabled like the other jobs (tests own the clock and turn cron off).
select cron.schedule('dueloop-purge-inbound', '23 3 * * *', $$select private.purge_inbound(now()) where private.flag('cron_enabled')$$);
