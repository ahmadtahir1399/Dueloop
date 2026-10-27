-- 0007_sending_schema.sql: outbox, templates, channel accounts (Vault secrets), consents, approvals,
-- dead letters, alert log, global flags. Role matrix: ADR 0012. Send protocol: ADR 0013.

-- Global switches, reachable only by the worker's trusted connection (not exposed, no API grants).
create table private.system_flags (
  key text primary key check (key in ('outbound_paused', 'cron_enabled')),
  enabled boolean not null,
  updated_at timestamptz not null default now()
);
insert into private.system_flags (key, enabled) values ('outbound_paused', false), ('cron_enabled', true);

-- Tenants: bank text for templates. monthly_message_budget_minor meaning: ADR 0018 (paid channels only).
alter table public.tenants add column bank_instructions text check (bank_instructions is null or length(bank_instructions) <= 2000);

-- Outbox (issue A): the mutable messages row carries the idempotency key and the send state; events are
-- appended afterwards with derived keys (<key>:sent, <key>:failed, <key>:skipped).
alter table public.messages
  add column send_state text check (send_state in ('pending', 'sent', 'retry', 'failed_permanent', 'unknown', 'skipped')),
  add column attempt integer not null default 0 check (attempt >= 0),
  add column cost_minor bigint not null default 0 check (cost_minor >= 0),
  add column failed_reason text check (failed_reason is null or length(failed_reason) <= 200),
  add column pending_since timestamptz,
  add column sent_at timestamptz,
  add column step_id text,
  add column subject text,
  -- Our own RFC 5322 Message-ID for email (derived from the idempotency key; prompt 4 threads replies on it).
  add column rfc_message_id text,
  add constraint messages_out_has_state check (direction = 'in' or send_state is not null);
create unique index messages_rfc_message_id_key on public.messages (tenant_id, rfc_message_id) where rfc_message_id is not null;
create index messages_customer_out_idx on public.messages (tenant_id, customer_id, pending_since) where direction = 'out';
create index messages_pending_idx on public.messages (pending_since) where send_state = 'pending';

create table public.templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  template_key text not null check (template_key ~ '^[a-z0-9_]{1,40}$'),
  channel text not null check (channel in ('email', 'whatsapp', 'sms')),
  locale text not null default 'en' check (locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$'),
  tone text not null check (tone in ('friendly', 'neutral', 'firm')),
  subject text check (subject is null or length(subject) <= 200),
  body text not null check (length(body) between 1 and 5000),
  -- WhatsApp: the pre-approved template's name and language code, and its review status (no Meta sync yet).
  provider_template_name text,
  provider_language text,
  provider_status text check (provider_status in ('approved', 'pending', 'rejected', 'paused', 'disabled')),
  updated_at timestamptz not null default now(),
  check (channel <> 'email' or subject is not null),
  check (channel <> 'whatsapp' or (provider_template_name is not null and provider_language is not null)),
  unique (tenant_id, id),
  unique (tenant_id, template_key, channel, locale)
);

-- Non-secret config only; secrets live in Vault and are referenced by secret_id.
create table public.channel_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  channel text not null check (channel in ('email', 'whatsapp', 'sms', 'slack')),
  config jsonb not null default '{}' check (jsonb_typeof(config) = 'object'),
  secret_id uuid,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, channel)
);

create table public.customer_consents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  customer_id uuid not null,
  channel text not null check (channel in ('email', 'whatsapp', 'sms')),
  granted_at timestamptz not null,
  source text not null check (length(btrim(source)) > 0),
  revoked_at timestamptz,
  check (revoked_at is null or revoked_at >= granted_at),
  unique (tenant_id, id),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id) on delete cascade
);
create unique index customer_consents_one_active on public.customer_consents (tenant_id, customer_id, channel) where revoked_at is null;

-- Issue E: one approval per idempotency key; it authorises that key only (rule 16).
create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  invoice_id uuid not null,
  idempotency_key text not null,
  step_id text not null,
  channel text not null check (channel in ('email', 'whatsapp', 'sms')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired', 'superseded')),
  version integer not null default 1 check (version >= 1), -- bumped when an expired approval is requested again
  requested_at timestamptz not null,
  decided_at timestamptz,
  decided_by text check (decided_by is null or length(decided_by) <= 100),
  decision_note text check (decision_note is null or length(decision_note) <= 500),
  subject_override text check (subject_override is null or length(subject_override) <= 200),
  body_override text check (body_override is null or length(body_override) <= 5000),
  unique (tenant_id, id),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, invoice_id) references public.invoices (tenant_id, id)
);
create index approvals_pending_idx on public.approvals (tenant_id, status, requested_at);

-- Jobs that failed too often. Ids and a reason code only: never bodies, contacts or secrets.
create table public.dead_letters (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  invoice_id uuid,
  source text not null check (source in ('followup_actions')),
  reason text not null check (length(reason) <= 200),
  attempts integer not null check (attempts >= 0),
  payload jsonb not null default '{}' check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, invoice_id) references public.invoices (tenant_id, id)
);

-- Alert de-duplication: one alert per (tenant, cause, period).
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  dedupe_key text not null check (length(dedupe_key) <= 200),
  period text not null check (length(period) <= 40),
  kind text not null check (length(kind) <= 60),
  created_at timestamptz not null,
  unique (tenant_id, dedupe_key, period)
);

-- New event types (append to the 0001 list; packages/db/src/events.ts must match: drift test).
alter table public.invoice_events drop constraint invoice_events_type_check;
alter table public.invoice_events add constraint invoice_events_type_check check (type in (
  'ReminderScheduled', 'ReminderSent', 'ReminderFailed', 'ReplyReceived', 'ReplyClassified',
  'PromiseRecorded', 'PromiseBroken', 'DisputeRaised', 'ProofSubmitted', 'ProofVerified',
  'PaymentConfirmed', 'PartialPaymentConfirmed', 'InvoiceEscalated', 'InvoiceWrittenOff',
  'OptOutRecorded', 'ApprovalRequested', 'ApprovalGranted', 'ApprovalRejected',
  'InvoiceImported', 'InvoiceImportUpdated',
  'InvoiceOverdue', 'ReminderSkipped', 'ReminderParked', 'ApprovalExpired', 'ApprovalSuperseded',
  'MessageStateUnknown', 'MessageReconciled'
));

-- RLS (ADR 0012).
do $$
declare t text;
begin
  foreach t in array array['templates', 'channel_accounts', 'customer_consents', 'approvals', 'dead_letters', 'notifications'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated, service_role', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;
grant select, insert, update, delete on table public.templates to authenticated;
grant select, insert, update, delete on table public.channel_accounts to authenticated;
grant select, insert, update on table public.customer_consents to authenticated;
grant select on table public.approvals, public.dead_letters, public.notifications to authenticated;

create policy templates_select on public.templates for select to authenticated
  using (tenant_id in (select private.my_tenant_ids()));
create policy templates_insert on public.templates for insert to authenticated
  with check (tenant_id in (select private.my_tenant_ids(array['owner', 'accountant'])));
create policy templates_update on public.templates for update to authenticated
  using (tenant_id in (select private.my_tenant_ids(array['owner', 'accountant'])))
  with check (tenant_id in (select private.my_tenant_ids(array['owner', 'accountant'])));
create policy templates_delete on public.templates for delete to authenticated
  using (tenant_id in (select private.my_tenant_ids(array['owner'])));

create policy channel_accounts_select on public.channel_accounts for select to authenticated
  using (tenant_id in (select private.my_tenant_ids()));
create policy channel_accounts_insert on public.channel_accounts for insert to authenticated
  with check (tenant_id in (select private.my_tenant_ids(array['owner'])));
create policy channel_accounts_update on public.channel_accounts for update to authenticated
  using (tenant_id in (select private.my_tenant_ids(array['owner'])))
  with check (tenant_id in (select private.my_tenant_ids(array['owner'])));
create policy channel_accounts_delete on public.channel_accounts for delete to authenticated
  using (tenant_id in (select private.my_tenant_ids(array['owner'])));

create policy customer_consents_select on public.customer_consents for select to authenticated
  using (tenant_id in (select private.my_tenant_ids()));
create policy customer_consents_insert on public.customer_consents for insert to authenticated
  with check (tenant_id in (select private.my_tenant_ids(array['owner', 'accountant'])));
create policy customer_consents_update on public.customer_consents for update to authenticated
  using (tenant_id in (select private.my_tenant_ids(array['owner', 'accountant'])))
  with check (tenant_id in (select private.my_tenant_ids(array['owner', 'accountant'])));

create policy approvals_select on public.approvals for select to authenticated
  using (tenant_id in (select private.my_tenant_ids()));
create policy dead_letters_select on public.dead_letters for select to authenticated
  using (tenant_id in (select private.my_tenant_ids(array['owner', 'accountant'])));
create policy notifications_select on public.notifications for select to authenticated
  using (tenant_id in (select private.my_tenant_ids(array['owner', 'accountant'])));

-- Is this call trusted server code? If the request carries JWT claims (the Data API always sets them),
-- only the service role counts. Without claims it is a direct database session; that is trusted unless it is
-- PostgREST's own 'authenticator' login (worker and CLIs connect directly with the database URL).
create function private.is_trusted_caller() returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when nullif(current_setting('request.jwt.claims', true), '') is not null
      then coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
    else session_user <> 'authenticator'
  end
$$;
revoke all on function private.is_trusted_caller() from public, anon, authenticated, service_role;

-- Approve / reject (owner, accountant, or trusted CLI). Approval never sends: it only lets the invoice
-- re-enter the normal pipeline, which re-runs decide() and every gate (rule 16).
create function private.decide_approval_impl(p_approval_id uuid, p_decision text, p_note text, p_actor text, p_as_of timestamptz)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  a public.approvals%rowtype;
  inv_status text;
  actor text := coalesce(p_actor, (select auth.uid())::text, 'unknown');
begin
  if p_decision not in ('approve', 'reject') then
    raise exception using errcode = '22023', message = 'decision must be approve or reject';
  end if;
  select * into a from public.approvals where id = p_approval_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'approval not found'; end if;
  if not private.is_trusted_caller() and not exists (
    select 1 from public.memberships m
    where m.tenant_id = a.tenant_id and m.user_id = (select auth.uid()) and m.role in ('owner', 'accountant')
  ) then
    raise exception using errcode = '42501', message = 'only an owner or accountant may decide approvals';
  end if;
  if a.status <> 'pending' then
    raise exception using errcode = '55000', message = format('approval is %s, not pending', a.status);
  end if;
  select status into inv_status from public.invoices where tenant_id = a.tenant_id and id = a.invoice_id;

  if p_decision = 'approve' and inv_status in ('paid', 'written_off', 'cancelled', 'disputed') then
    update public.approvals set status = 'superseded', decided_at = p_as_of, decided_by = actor, decision_note = p_note where id = a.id;
    insert into public.invoice_events (tenant_id, invoice_id, type, payload, idempotency_key)
    values (a.tenant_id, a.invoice_id, 'ApprovalSuperseded', jsonb_build_object('approvalId', a.id, 'reason', 'invoice_' || inv_status),
            format('%s:approval-superseded:v%s', a.idempotency_key, a.version))
    on conflict (tenant_id, idempotency_key) do nothing;
    return 'superseded';
  end if;

  update public.approvals
  set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
      decided_at = p_as_of, decided_by = actor, decision_note = p_note
  where id = a.id;
  insert into public.invoice_events (tenant_id, invoice_id, type, payload, idempotency_key)
  values (a.tenant_id, a.invoice_id, case when p_decision = 'approve' then 'ApprovalGranted' else 'ApprovalRejected' end,
          jsonb_build_object('approvalId', a.id, 'stepId', a.step_id, 'channel', a.channel, 'by', actor),
          format('%s:approval-%s:v%s', a.idempotency_key, p_decision, a.version))
  on conflict (tenant_id, idempotency_key) do nothing;

  if p_decision = 'reject' then
    -- A rejected step is recorded as skipped so decide() never proposes it again (issue E).
    insert into public.messages (tenant_id, customer_id, channel, direction, idempotency_key, send_state, step_id, failed_reason, pending_since)
    select a.tenant_id, i.customer_id, a.channel, 'out', a.idempotency_key, 'skipped', a.step_id, 'approval_rejected', p_as_of
    from public.invoices i where i.tenant_id = a.tenant_id and i.id = a.invoice_id
    on conflict (tenant_id, idempotency_key) do nothing;
    insert into public.message_invoices (tenant_id, message_id, invoice_id)
    select m.tenant_id, m.id, a.invoice_id from public.messages m where m.tenant_id = a.tenant_id and m.idempotency_key = a.idempotency_key
    on conflict do nothing;
    insert into public.invoice_events (tenant_id, invoice_id, type, payload, idempotency_key)
    values (a.tenant_id, a.invoice_id, 'ReminderSkipped', jsonb_build_object('stepId', a.step_id, 'reason', 'approval_rejected'),
            a.idempotency_key || ':skipped')
    on conflict (tenant_id, idempotency_key) do nothing;
  end if;

  -- Re-enter the pipeline now: the worker re-runs decide() with fresh context.
  update public.invoices set next_action_at = p_as_of, enqueued_at = null where tenant_id = a.tenant_id and id = a.invoice_id;
  return case when p_decision = 'approve' then 'approved' else 'rejected' end;
end $$;
revoke all on function private.decide_approval_impl(uuid, text, text, text, timestamptz) from public, anon;
grant execute on function private.decide_approval_impl(uuid, text, text, text, timestamptz) to authenticated;

create function public.decide_approval(p_approval_id uuid, p_decision text, p_note text default null)
returns text language sql security invoker set search_path = '' as $$
  select private.decide_approval_impl(p_approval_id, p_decision, p_note, null, now())
$$;
revoke all on function public.decide_approval(uuid, text, text) from public, anon;
grant execute on function public.decide_approval(uuid, text, text) to authenticated;

-- Edit the text of a pending approval. The opt-out footer is appended after this at send time.
create function private.edit_approval_impl(p_approval_id uuid, p_subject text, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.approvals%rowtype;
begin
  select * into a from public.approvals where id = p_approval_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'approval not found'; end if;
  if not private.is_trusted_caller() and not exists (
    select 1 from public.memberships m
    where m.tenant_id = a.tenant_id and m.user_id = (select auth.uid()) and m.role in ('owner', 'accountant')
  ) then
    raise exception using errcode = '42501', message = 'only an owner or accountant may edit approvals';
  end if;
  if a.status <> 'pending' then raise exception using errcode = '55000', message = 'only a pending approval can be edited'; end if;
  update public.approvals set subject_override = p_subject, body_override = p_body where id = a.id;
end $$;
revoke all on function private.edit_approval_impl(uuid, text, text) from public, anon;
grant execute on function private.edit_approval_impl(uuid, text, text) to authenticated;

create function public.edit_approval(p_approval_id uuid, p_subject text, p_body text)
returns void language sql security invoker set search_path = '' as $$
  select private.edit_approval_impl(p_approval_id, p_subject, p_body)
$$;
revoke all on function public.edit_approval(uuid, text, text) from public, anon;
grant execute on function public.edit_approval(uuid, text, text) to authenticated;

-- Tenant kill switch: owner (or trusted CLI).
create function private.set_outbound_paused_impl(p_tenant_id uuid, p_paused boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_trusted_caller() and not exists (
    select 1 from public.memberships m where m.tenant_id = p_tenant_id and m.user_id = (select auth.uid()) and m.role = 'owner'
  ) then
    raise exception using errcode = '42501', message = 'only the owner may pause or resume sending';
  end if;
  update public.tenants set outbound_paused = p_paused where id = p_tenant_id;
  if not found then raise exception using errcode = 'P0002', message = 'tenant not found'; end if;
end $$;
revoke all on function private.set_outbound_paused_impl(uuid, boolean) from public, anon;
grant execute on function private.set_outbound_paused_impl(uuid, boolean) to authenticated;

create function public.set_outbound_paused(p_tenant_id uuid, p_paused boolean)
returns void language sql security invoker set search_path = '' as $$
  select private.set_outbound_paused_impl(p_tenant_id, p_paused)
$$;
revoke all on function public.set_outbound_paused(uuid, boolean) from public, anon;
grant execute on function public.set_outbound_paused(uuid, boolean) to authenticated;

-- Secrets: stored with Vault (vault.create_secret / update_secret, Supabase Vault docs). Trusted callers only.
create function private.set_channel_secret(p_tenant_id uuid, p_channel text, p_secret text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  acc public.channel_accounts%rowtype;
  sid uuid;
begin
  if not private.is_trusted_caller() then
    raise exception using errcode = '42501', message = 'secrets can only be set by trusted server code';
  end if;
  select * into acc from public.channel_accounts where tenant_id = p_tenant_id and channel = p_channel for update;
  if not found then raise exception using errcode = 'P0002', message = 'channel account not found'; end if;
  if acc.secret_id is null then
    sid := vault.create_secret(p_secret, format('dueloop:%s:%s', p_tenant_id, p_channel), 'channel credential');
    update public.channel_accounts set secret_id = sid where id = acc.id;
  else
    perform vault.update_secret(acc.secret_id, p_secret);
    sid := acc.secret_id;
  end if;
  return sid;
end $$;
revoke all on function private.set_channel_secret(uuid, text, text) from public, anon, authenticated, service_role;

create function private.channel_secret(p_tenant_id uuid, p_channel text)
returns text language sql stable security definer set search_path = '' as $$
  select s.decrypted_secret
  from public.channel_accounts a join vault.decrypted_secrets s on s.id = a.secret_id
  where a.tenant_id = p_tenant_id and a.channel = p_channel
$$;
revoke all on function private.channel_secret(uuid, text) from public, anon, authenticated, service_role;
