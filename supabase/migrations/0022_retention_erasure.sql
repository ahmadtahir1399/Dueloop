-- Prompt 7 step 3 (ADR 0051): retention, customer erasure and export logging, and the suppression list.
-- Service-only: every function is in `private` and is executable by no API role (the CLIs use the trusted
-- connection). The ledger (receipts, payments, credits), invoices and append-only events are KEPT on erasure.

alter table public.tenant_events drop constraint tenant_events_type_check;
alter table public.tenant_events add constraint tenant_events_type_check check (type in (
  'OptOutRecorded', 'ReplyUnmatched', 'ReplyAmbiguous', 'DeliveryFailed', 'InboundDeadLettered', 'AutoReplyReceived',
  'PaymentUnmatched', 'PaymentEventDeadLettered',
  'AuditExported', 'MemberRoleChanged', 'MemberRemoved',
  'RetentionRun', 'CustomerErased', 'CustomerExported'
));

-- ---------------------------------------------------------------------------------------------------------
-- Suppression list: a salted one-way hash of every opted-out or erased contact, so an import (or the API, or a
-- hand edit) cannot silently re-add and message that person. The salt is per tenant and never leaves the database.
create table private.tenant_salts (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  salt bytea not null default extensions.gen_random_bytes(16)
);
revoke all on table private.tenant_salts from public, anon, authenticated, service_role;

create table private.suppressions (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  contact_hash text not null check (contact_hash ~ '^[0-9a-f]{64}$'),
  kind text not null check (kind in ('email', 'phone')),
  reason text not null check (reason in ('opt_out', 'erasure')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, contact_hash)
);
revoke all on table private.suppressions from public, anon, authenticated, service_role;

create function private.contact_hash(p_tenant uuid, p_contact text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_salt bytea;
begin
  if p_contact is null or btrim(p_contact) = '' then return null; end if;
  insert into private.tenant_salts (tenant_id) values (p_tenant) on conflict do nothing;
  select salt into v_salt from private.tenant_salts where tenant_id = p_tenant;
  return encode(extensions.digest(v_salt || convert_to(lower(btrim(p_contact)), 'UTF8'), 'sha256'), 'hex');
end $$;
revoke all on function private.contact_hash(uuid, text) from public, anon, authenticated, service_role;

create function private.suppress(p_tenant uuid, p_email text, p_phone text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_email is not null then
    insert into private.suppressions (tenant_id, contact_hash, kind, reason) values (p_tenant, private.contact_hash(p_tenant, p_email), 'email', p_reason) on conflict do nothing;
  end if;
  if p_phone is not null then
    insert into private.suppressions (tenant_id, contact_hash, kind, reason) values (p_tenant, private.contact_hash(p_tenant, p_phone), 'phone', p_reason) on conflict do nothing;
  end if;
end $$;
revoke all on function private.suppress(uuid, text, text, text) from public, anon, authenticated, service_role;

-- Every path that opts a customer out (STOP reply, opt-out page, staff) is recorded in the list.
-- A customer whose email or phone is on the list is (re)created or updated as opted out.
create function private.suppression_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.opted_out then
    perform private.suppress(new.tenant_id, new.email, new.phone_e164, 'opt_out');
    return new;
  end if;
  if exists (
    select 1 from private.suppressions s
    where s.tenant_id = new.tenant_id
      and s.contact_hash in (private.contact_hash(new.tenant_id, new.email), private.contact_hash(new.tenant_id, new.phone_e164))
  ) then
    new.opted_out := true;
  end if;
  return new;
end $$;
revoke all on function private.suppression_guard() from public, anon, authenticated, service_role;
create trigger customers_suppression before insert or update of email, phone_e164, opted_out on public.customers
  for each row execute function private.suppression_guard();

-- Existing opt-outs join the list now (so the rule holds from this migration on).
select private.suppress(tenant_id, email, phone_e164, 'opt_out') from public.customers where opted_out;

-- ---------------------------------------------------------------------------------------------------------
-- Retention (one call per run; the CLI also removes proof files from Storage). Counts only are logged.
create function private.retention_run(p_now timestamptz, p_import_rows_days integer, p_links_days integer, p_rate_days integer)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_inbound integer;
  v_payment integer;
  v_import integer;
  v_links integer;
  v_rate integer;
  v_idem integer;
  t record;
begin
  v_inbound := private.purge_inbound(p_now);
  v_payment := private.purge_payment_events(p_now);
  update public.import_rows set raw = '[]'::jsonb, normalised = null
    where raw <> '[]'::jsonb and batch_id in (select id from public.import_batches where created_at < p_now - make_interval(days => p_import_rows_days));
  get diagnostics v_import = row_count;
  delete from public.public_links where coalesce(revoked_at, expires_at) < p_now - make_interval(days => p_links_days);
  get diagnostics v_links = row_count;
  v_rate := private.purge_rate_limits(p_now - make_interval(days => p_rate_days));
  delete from public.api_idempotency where expires_at < p_now;
  get diagnostics v_idem = row_count;
  -- One tenant event per tenant that exists (counts are system-wide; nothing identifies a person).
  for t in select id from public.tenants loop
    insert into public.tenant_events (tenant_id, type, payload, idempotency_key, created_at)
    values (t.id, 'RetentionRun', jsonb_build_object('inbound_events', v_inbound, 'payment_events', v_payment, 'import_rows', v_import,
            'public_links', v_links, 'rate_limit_windows', v_rate, 'idempotency_records', v_idem), format('retention:%s', p_now), p_now)
    on conflict do nothing;
  end loop;
  return jsonb_build_object('inbound_events', v_inbound, 'payment_events', v_payment, 'import_rows', v_import, 'public_links', v_links, 'rate_limit_windows', v_rate, 'idempotency_records', v_idem);
end $$;
revoke all on function private.retention_run(timestamptz, integer, integer, integer) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------
-- Erasure. Refuses while the customer has non-final invoices (DECISION NEEDED: the operator may want otherwise).
-- Keeps invoices, receipts, payments, credits and events (they hold no contact details; tested).
create function private.erase_customer(p_tenant uuid, p_customer uuid, p_actor text, p_now timestamptz)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.customers%rowtype;
  v_msgs integer;
  v_events integer;
  v_proofs integer;
  v_tasks integer;
  v_open integer;
begin
  select * into c from public.customers where tenant_id = p_tenant and id = p_customer for update;
  if not found then raise exception using errcode = 'P0002', message = 'customer not found'; end if;
  select count(*) into v_open from public.invoices where tenant_id = p_tenant and customer_id = p_customer and status not in ('paid', 'written_off', 'cancelled');
  if v_open > 0 then
    raise exception using errcode = '55000', message = format('the customer has %s open invoice(s); close or write them off first', v_open);
  end if;
  perform private.suppress(p_tenant, c.email, c.phone_e164, 'erasure');
  update public.customers set display_name = 'Erased customer ' || left(p_customer::text, 8), email = null, phone_e164 = null,
    external_id = null, opted_out = true where tenant_id = p_tenant and id = p_customer;
  with m as (
    update public.messages set body = null, body_new_text = null, subject = null, attachments = '[]'::jsonb, analysis = null, sender_ref = null
    where tenant_id = p_tenant and customer_id = p_customer returning inbound_event_id
  ) select count(*) into v_msgs from m;
  delete from public.inbound_events e where e.tenant_id = p_tenant and e.id in (select inbound_event_id from public.messages where tenant_id = p_tenant and customer_id = p_customer and inbound_event_id is not null);
  get diagnostics v_events = row_count;
  update public.payment_proofs set hints = '{}'::jsonb, original_name = null where tenant_id = p_tenant and customer_id = p_customer;
  get diagnostics v_proofs = row_count;
  update public.tasks set draft_reply = null, details = '{}'::jsonb where tenant_id = p_tenant and customer_id = p_customer;
  get diagnostics v_tasks = row_count;
  insert into public.tenant_events (tenant_id, type, payload, idempotency_key, created_at)
  values (p_tenant, 'CustomerErased', jsonb_build_object('by', p_actor, 'messages_redacted', v_msgs, 'raw_events_deleted', v_events, 'proofs_redacted', v_proofs, 'tasks_redacted', v_tasks),
          format('erase:%s', p_customer), p_now)
  on conflict (tenant_id, idempotency_key) do nothing; -- re-runnable after a failed storage call
  return jsonb_build_object('messages_redacted', v_msgs, 'raw_events_deleted', v_events, 'proofs_redacted', v_proofs, 'tasks_redacted', v_tasks);
end $$;
revoke all on function private.erase_customer(uuid, uuid, text, timestamptz) from public, anon, authenticated, service_role;

create function private.log_customer_export(p_tenant uuid, p_customer uuid, p_actor text, p_counts jsonb, p_now timestamptz) returns void
language sql security definer set search_path = '' as $$
  insert into public.tenant_events (tenant_id, type, payload, idempotency_key, created_at)
  values (p_tenant, 'CustomerExported', jsonb_build_object('by', p_actor, 'counts', p_counts), format('export:%s:%s', p_customer, gen_random_uuid()), p_now)
$$;
revoke all on function private.log_customer_export(uuid, uuid, text, jsonb, timestamptz) from public, anon, authenticated, service_role;
