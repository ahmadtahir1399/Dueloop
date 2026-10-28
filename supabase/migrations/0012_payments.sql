-- Prompt 5: payments + reconciliation. The money-in ledger (receipts -> applied payment slices + credits),
-- payment accounts (Vault secrets, opaque webhook tokens), payment requests, raw payment events, proofs in
-- private storage, the transactional-send queue, and the single application function. Role matrix: ADR 0032.

-- ---------------------------------------------------------------------------------------------------------
-- Ledger (issue B). RECEIPT = money in (the idempotency anchor). PAYMENT = the slice applied to the invoice
-- (the prompt 2 table; the balance view keeps working: balance = total - sum(payments)). CREDIT = remainder.
-- Invariant per receipt: amount = sum(applied) + credit (rule 28).
create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  invoice_id uuid not null,
  customer_id uuid not null,
  method text not null check (method in ('bank_transfer', 'stripe', 'fake')),
  source text not null check (source in ('gateway', 'poll', 'manual', 'proof', 'legacy')),
  provider_ref text not null check (length(btrim(provider_ref)) between 1 and 300),
  amount bigint not null check (amount > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  received_at timestamptz not null,
  confirmed_by uuid references auth.users (id) on delete set null,
  payment_event_id bigint,
  proof_id uuid,
  note text check (note is null or length(note) <= 500),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  -- Rule 29: the same money can never count twice.
  unique (tenant_id, method, provider_ref),
  foreign key (tenant_id, invoice_id, currency) references public.invoices (tenant_id, id, currency),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id)
);
create index receipts_invoice_idx on public.receipts (tenant_id, invoice_id);

alter table public.payments
  add column receipt_id uuid,
  add column source text not null default 'legacy' check (source in ('gateway', 'poll', 'manual', 'proof', 'legacy'));
alter table public.payments add constraint payments_receipt_fk foreign key (tenant_id, receipt_id) references public.receipts (tenant_id, id);
create unique index payments_one_slice_per_receipt on public.payments (tenant_id, receipt_id) where receipt_id is not null;

create table public.credits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  receipt_id uuid not null,
  customer_id uuid not null,
  invoice_id uuid not null,
  amount bigint not null check (amount > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, receipt_id),
  foreign key (tenant_id, receipt_id) references public.receipts (tenant_id, id),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id),
  foreign key (tenant_id, invoice_id) references public.invoices (tenant_id, id)
);

-- A payment inserted the prompt 2 way (seed, tests) gets its receipt automatically, so the ledger invariant
-- holds for every row. New money goes through private.apply_payment, which supplies receipt_id itself.
create function private.legacy_payment_receipt() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cust uuid;
begin
  if new.receipt_id is not null then return new; end if;
  select customer_id into cust from public.invoices where tenant_id = new.tenant_id and id = new.invoice_id;
  -- No such invoice in this tenant: let the payment's own composite FK reject the row (23503, issue B of prompt 2).
  if cust is null then return new; end if;
  insert into public.receipts (tenant_id, invoice_id, customer_id, method, source, provider_ref, amount, currency, received_at, confirmed_by)
  values (new.tenant_id, new.invoice_id, cust, case when new.method in ('bank_transfer', 'stripe', 'fake') then new.method else 'bank_transfer' end,
          'legacy', new.provider_ref, new.amount, new.currency, new.paid_at, new.confirmed_by)
  returning id into new.receipt_id;
  return new;
end $$;
create trigger payments_legacy_receipt before insert on public.payments for each row execute function private.legacy_payment_receipt();

-- Append-only money (like invoice_events): no UPDATE, no DELETE, except while purging a whole tenant.
create function private.guard_ledger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' and current_setting('dueloop.purging_tenant', true) = old.tenant_id::text then
    return old;
  end if;
  raise exception using errcode = '23514', message = format('%s is append-only: %s is not allowed', tg_table_name, tg_op);
end $$;
do $$
declare t text;
begin
  foreach t in array array['receipts', 'payments', 'credits'] loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function private.guard_ledger()', t || '_append_only', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function private.guard_ledger()', t || '_no_truncate', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Payment accounts: one per (tenant, provider). Secrets live in Vault; the webhook route carries an OPAQUE,
-- random token whose SHA-256 is stored here (issue H). Mode must match every event (issues G, O).
create table public.payment_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  provider text not null check (provider in ('stripe', 'fake')),
  mode text not null check (mode in ('test', 'live')),
  webhook_token_hash text not null unique check (webhook_token_hash ~ '^[0-9a-f]{64}$'),
  api_key_secret_id uuid,
  webhook_secret_id uuid,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, provider)
);

create function private.set_payment_secret(p_account_id uuid, p_kind text, p_secret text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  acc public.payment_accounts%rowtype;
  sid uuid;
begin
  if not private.is_trusted_caller() then raise exception using errcode = '42501', message = 'secrets can only be set by trusted server code'; end if;
  if p_kind not in ('api_key', 'webhook_secret') then raise exception using errcode = '22023', message = 'kind must be api_key or webhook_secret'; end if;
  select * into acc from public.payment_accounts where id = p_account_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'payment account not found'; end if;
  sid := case p_kind when 'api_key' then acc.api_key_secret_id else acc.webhook_secret_id end;
  if sid is null then
    sid := vault.create_secret(p_secret, format('dueloop:payment:%s:%s', acc.id, p_kind), 'payment credential');
    if p_kind = 'api_key' then update public.payment_accounts set api_key_secret_id = sid where id = acc.id;
    else update public.payment_accounts set webhook_secret_id = sid where id = acc.id; end if;
  else
    perform vault.update_secret(sid, p_secret);
  end if;
  return sid;
end $$;

create function private.payment_secret(p_account_id uuid, p_kind text) returns text
language sql stable security definer set search_path = '' as $$
  select s.decrypted_secret from public.payment_accounts a
  join vault.decrypted_secrets s on s.id = case p_kind when 'api_key' then a.api_key_secret_id else a.webhook_secret_id end
  where a.id = p_account_id
$$;

-- ---------------------------------------------------------------------------------------------------------
-- Payment requests (issue F): what we asked the customer to pay, and through which hosted object.
create table public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  invoice_id uuid not null,
  payment_account_id uuid,
  provider text not null check (provider in ('bank_transfer', 'stripe', 'fake')),
  provider_object_id text check (provider_object_id is null or length(provider_object_id) between 1 and 300),
  url text check (url is null or url ~ '^https://'),
  amount bigint not null check (amount > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'active' check (status in ('active', 'paid', 'deactivated', 'expired', 'failed')),
  expires_at timestamptz,
  deactivated_at timestamptz,
  deactivation_reason text check (deactivation_reason is null or deactivation_reason ~ '^[a-z_]{1,60}$'),
  idempotency_key text not null check (length(idempotency_key) between 1 and 300),
  created_at timestamptz not null,
  check ((status = 'active') = (deactivated_at is null)),
  unique (tenant_id, id),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, invoice_id, currency) references public.invoices (tenant_id, id, currency),
  foreign key (tenant_id, payment_account_id) references public.payment_accounts (tenant_id, id)
);
create unique index payment_requests_one_active on public.payment_requests (tenant_id, invoice_id, provider) where status = 'active';
-- A provider object id resolves to exactly one of OUR rows, globally (issue G).
create unique index payment_requests_provider_object on public.payment_requests (provider, provider_object_id) where provider_object_id is not null;

-- ---------------------------------------------------------------------------------------------------------
-- Raw provider events (PII: payer details). Stored only after signature verification; purged on schedule.
create table public.payment_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  payment_account_id uuid,
  provider text not null check (provider in ('stripe', 'fake', 'bank_transfer')),
  provider_event_id text not null check (length(provider_event_id) between 1 and 300),
  kind text not null check (kind in ('payment_confirmed', 'payment_failed', 'payment_processing', 'payment_reversed')),
  event jsonb not null check (jsonb_typeof(event) = 'object'), -- the normalised PaymentEvent
  raw jsonb check (raw is null or jsonb_typeof(raw) = 'object'),
  received_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'processed', 'dead')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text check (last_error is null or length(last_error) <= 200),
  processed_at timestamptz,
  purge_after timestamptz not null,
  unique (tenant_id, id),
  unique (provider, provider_event_id),
  foreign key (tenant_id, payment_account_id) references public.payment_accounts (tenant_id, id) on delete cascade
);
alter table public.receipts add constraint receipts_payment_event_fk foreign key (tenant_id, payment_event_id) references public.payment_events (tenant_id, id) on delete set null (payment_event_id);

-- ---------------------------------------------------------------------------------------------------------
-- Proof of payment (issue M): files in the private bucket at <tenant>/<proof id>; extracted values are
-- UNTRUSTED HINTS only (rule 31).
create table public.payment_proofs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  invoice_id uuid,
  customer_id uuid,
  message_id uuid,
  storage_path text not null unique,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes integer not null check (size_bytes > 0),
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  original_name text check (original_name is null or length(original_name) <= 200),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  duplicate_of uuid,
  hints jsonb not null default '{}' check (jsonb_typeof(hints) = 'object'),
  hints_model_id text,
  hints_prompt_version text,
  receipt_id uuid,
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  decision_note text check (decision_note is null or length(decision_note) <= 500),
  created_at timestamptz not null,
  check ((status = 'pending') = (decided_at is null)),
  check (storage_path = tenant_id::text || '/' || id::text),
  unique (tenant_id, id),
  foreign key (tenant_id, invoice_id) references public.invoices (tenant_id, id),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id),
  foreign key (tenant_id, message_id) references public.messages (tenant_id, id),
  foreign key (tenant_id, duplicate_of) references public.payment_proofs (tenant_id, id),
  foreign key (tenant_id, receipt_id) references public.receipts (tenant_id, id)
);
create index payment_proofs_sha_idx on public.payment_proofs (tenant_id, sha256);
alter table public.receipts add constraint receipts_proof_fk foreign key (tenant_id, proof_id) references public.payment_proofs (tenant_id, id);

-- Private bucket; every read is tenant-folder scoped, and no client role can write (ADR 0032).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
create policy payment_proofs_read on storage.objects for select to authenticated
  using (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] in (select t::text from private.my_tenant_ids() t));

-- ---------------------------------------------------------------------------------------------------------
-- Tenant settings, message purpose, task and event types.
alter table public.tenants
  add column proof_ai_extraction boolean not null default false,
  add column proof_storage_cap_bytes bigint not null default 524288000 check (proof_storage_cap_bytes >= 0);
alter table public.messages add column purpose text not null default 'reminder' check (purpose in ('reminder', 'receipt', 'reply'));
update public.messages set purpose = 'reply' where direction = 'in';

alter table public.tasks drop constraint tasks_type_check;
alter table public.tasks add constraint tasks_type_check check (type in (
  'review_promise', 'verify_payment_claim', 'dispute', 'info_request', 'human_review',
  'ambiguous_invoice', 'unmatched_inbound', 'unprocessed_inbound', 'delivery_failed', 'invalid_contact',
  'overpayment_credit', 'payment_on_final_invoice', 'payment_reversal', 'unmatched_payment',
  'payment_amount_mismatch', 'unprocessed_payment_event', 'review_proof', 'proof_limit_reached'
));
alter table public.tasks add column urgent boolean not null default false;
alter table public.tasks add column receipt_id uuid;
alter table public.tasks add constraint tasks_receipt_fk foreign key (tenant_id, receipt_id) references public.receipts (tenant_id, id);

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
  'RemindersBlocked', 'RemindersResumed',
  'PromiseKept', 'PaymentCreditCreated', 'PaymentReversed', 'PaymentFailed', 'PaymentRequestCreated',
  'PaymentRequestDeactivated', 'ProofRejected', 'ReminderAfterPayment', 'ReceiptSkipped'
));
alter table public.tenant_events drop constraint tenant_events_type_check;
alter table public.tenant_events add constraint tenant_events_type_check check (type in (
  'OptOutRecorded', 'ReplyUnmatched', 'ReplyAmbiguous', 'DeliveryFailed', 'InboundDeadLettered', 'AutoReplyReceived',
  'PaymentUnmatched', 'PaymentEventDeadLettered'
));
alter table public.dead_letters drop constraint dead_letters_source_check;
alter table public.dead_letters add constraint dead_letters_source_check check (source in ('followup_actions', 'inbound_events', 'payment_events', 'transactional_sends'));

-- ---------------------------------------------------------------------------------------------------------
-- RLS (ADR 0032).
do $$
declare t text;
begin
  foreach t in array array['receipts', 'credits', 'payment_accounts', 'payment_requests', 'payment_events', 'payment_proofs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated, service_role', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;
grant select on table public.receipts, public.credits, public.payment_requests, public.payment_proofs to authenticated;
grant select (id, tenant_id, provider, mode, enabled, created_at) on table public.payment_accounts to authenticated;

create policy receipts_select on public.receipts for select to authenticated using (tenant_id in (select private.my_tenant_ids()));
create policy credits_select on public.credits for select to authenticated using (tenant_id in (select private.my_tenant_ids()));
create policy payment_requests_select on public.payment_requests for select to authenticated using (tenant_id in (select private.my_tenant_ids()));
create policy payment_proofs_select on public.payment_proofs for select to authenticated using (tenant_id in (select private.my_tenant_ids()));
create policy payment_accounts_select on public.payment_accounts for select to authenticated
  using (tenant_id in (select private.my_tenant_ids(array['owner', 'accountant'])));
-- payment_events: no grant, no policy. Raw payloads are PII.

-- ---------------------------------------------------------------------------------------------------------
-- Queues: raw payment events, and transactional sends (receipts) enqueued in the payment's transaction (K).
select pgmq.create('payment_events');
select pgmq.create('transactional_sends');

create function private.store_payment_event(
  p_account_id uuid, p_provider text, p_provider_event_id text, p_kind text, p_event jsonb, p_raw jsonb,
  p_received_at timestamptz, p_retention interval default interval '400 days'
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  acc public.payment_accounts%rowtype;
  new_id bigint;
begin
  select * into acc from public.payment_accounts where id = p_account_id and enabled;
  if not found then raise exception using errcode = 'P0002', message = 'payment account not found'; end if;
  insert into public.payment_events (tenant_id, payment_account_id, provider, provider_event_id, kind, event, raw, received_at, purge_after)
  values (acc.tenant_id, acc.id, p_provider, p_provider_event_id, p_kind, p_event, p_raw, p_received_at, p_received_at + p_retention)
  on conflict (provider, provider_event_id) do nothing
  returning id into new_id;
  if new_id is not null then
    perform pgmq.send('payment_events', jsonb_build_object('event_id', new_id, 'tenant_id', acc.tenant_id));
  end if;
  return new_id;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- The single application function (pipeline step 5). The plan comes from core planPaymentOutcome; this
-- function re-reads status and balance under the invoice row lock and REJECTS any plan the numbers do not
-- force (applied = least(amount, balance), 0 on a final invoice; credit = the rest; paid iff balance hits 0).
-- Returns {result: applied|duplicate|replan, receipt_id}.
create function private.apply_payment(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := (p ->> 'tenant_id')::uuid;
  v_invoice uuid := (p ->> 'invoice_id')::uuid;
  r jsonb := p -> 'receipt';
  pl jsonb := p -> 'plan';
  v_at timestamptz := (p ->> 'now')::timestamptz;
  inv public.invoices%rowtype;
  v_balance bigint;
  v_amount bigint := (r ->> 'amount')::bigint;
  v_applied bigint := (pl ->> 'applied')::bigint;
  v_credit bigint := (pl ->> 'credit')::bigint;
  v_to text := pl ->> 'transition_to';
  v_receipt uuid;
  v_final boolean;
  v_expected_applied bigint;
  v_source text := r ->> 'source';
  ev text;
  t jsonb;
  m record;
begin
  select * into inv from public.invoices where tenant_id = v_tenant and id = v_invoice for update;
  if not found then raise exception using errcode = 'P0002', message = 'invoice not found'; end if;
  select balance into v_balance from public.invoice_balances where tenant_id = v_tenant and invoice_id = v_invoice;
  if inv.status <> (p ->> 'expected_status') or v_balance <> (p ->> 'expected_balance')::bigint then
    return jsonb_build_object('result', 'replan');
  end if;

  -- A human-entered payment needs a human with the right role (rule 27, ADR 0032).
  if v_source in ('manual', 'proof') and not exists (
    select 1 from public.memberships mb where mb.tenant_id = v_tenant and mb.user_id = (r ->> 'confirmed_by')::uuid and mb.role in ('owner', 'accountant')
  ) then
    raise exception using errcode = '42501', message = 'only an owner or accountant may confirm a payment';
  end if;

  -- The plan must be exactly what the numbers force (defence in depth behind core's property tests).
  v_final := inv.status in ('paid', 'written_off', 'cancelled');
  -- (Computed first: a PL/pgSQL IF condition ends at its first THEN, so no CASE inside it.)
  v_expected_applied := case when v_final then 0 else least(v_amount, greatest(v_balance, 0)) end;
  if v_amount is null or v_amount <= 0 or (r ->> 'currency') <> inv.currency
     or v_applied <> v_expected_applied
     or v_credit <> v_amount - v_applied
     or (v_to is not null) <> (not v_final and v_applied > 0 and v_balance - v_applied = 0)
     or (v_to is not null and v_to <> 'paid') then
    raise exception using errcode = '23514', message = 'payment plan does not match the ledger';
  end if;

  insert into public.receipts (tenant_id, invoice_id, customer_id, method, source, provider_ref, amount, currency, received_at, confirmed_by, payment_event_id, proof_id, note)
  values (v_tenant, v_invoice, inv.customer_id, r ->> 'method', v_source, r ->> 'provider_ref', v_amount, inv.currency, (r ->> 'received_at')::timestamptz,
          (r ->> 'confirmed_by')::uuid, (r ->> 'payment_event_id')::bigint, (r ->> 'proof_id')::uuid, r ->> 'note')
  on conflict (tenant_id, method, provider_ref) do nothing
  returning id into v_receipt;
  if v_receipt is null then
    return jsonb_build_object('result', 'duplicate', 'receipt_id', (select id from public.receipts where tenant_id = v_tenant and method = r ->> 'method' and provider_ref = r ->> 'provider_ref'));
  end if;

  if v_applied > 0 then
    insert into public.payments (tenant_id, invoice_id, amount, currency, method, provider_ref, paid_at, confirmed_by, receipt_id, source)
    values (v_tenant, v_invoice, v_applied, inv.currency, r ->> 'method', r ->> 'provider_ref', (r ->> 'received_at')::timestamptz, (r ->> 'confirmed_by')::uuid, v_receipt, v_source);
  end if;
  if v_credit > 0 then
    insert into public.credits (tenant_id, receipt_id, customer_id, invoice_id, amount, currency) values (v_tenant, v_receipt, inv.customer_id, v_invoice, v_credit, inv.currency);
  end if;

  if v_to is not null then
    -- The state machine (0002 trigger) rejects anything illegal; exactly one transition can win the lock.
    update public.invoices set status = 'paid', next_action_at = 'infinity', parked_reason = null, enqueued_at = null where tenant_id = v_tenant and id = v_invoice;
    update public.approvals set status = 'superseded', decided_at = v_at, decided_by = 'payment', decision_note = 'invoice paid'
      where tenant_id = v_tenant and invoice_id = v_invoice and status = 'pending';
    update public.payment_requests set status = case when id = (p ->> 'request_id')::uuid then 'paid' else 'deactivated' end,
           deactivated_at = v_at, deactivation_reason = 'invoice_paid'
      where tenant_id = v_tenant and invoice_id = v_invoice and status = 'active';
    update public.tasks set status = 'resolved', resolved_at = v_at, resolved_by = 'payment', resolution_note = 'payment confirmed', blocks_reminders_until = null
      where tenant_id = v_tenant and invoice_id = v_invoice and status = 'open' and type in ('verify_payment_claim', 'review_promise');
  elsif v_applied > 0 then
    -- The balance changed: the amount on any hosted link is stale; a new request is created when needed.
    update public.payment_requests set status = 'deactivated', deactivated_at = v_at, deactivation_reason = 'balance_changed'
      where tenant_id = v_tenant and invoice_id = v_invoice and status = 'active';
  end if;

  if pl ->> 'promise_outcome' in ('kept', 'not_kept') then
    update public.promises set status = case when pl ->> 'promise_outcome' = 'kept' then 'kept' else 'broken' end, resolved_at = v_at, resolved_by = 'payment'
      where tenant_id = v_tenant and invoice_id = v_invoice and status = 'active';
  end if;

  for ev in select jsonb_array_elements_text(pl -> 'events') loop
    if ev not in ('PaymentConfirmed', 'PartialPaymentConfirmed', 'PaymentCreditCreated', 'PromiseKept', 'PromiseBroken') then
      raise exception using errcode = '22023', message = 'unexpected payment event type';
    end if;
    insert into public.invoice_events (tenant_id, invoice_id, type, payload, idempotency_key, created_at)
    values (v_tenant, v_invoice, ev, jsonb_build_object('receiptId', v_receipt, 'amount', v_amount, 'applied', v_applied, 'credit', v_credit, 'currency', inv.currency, 'source', v_source),
            format('receipt:%s:%s', v_receipt, ev), v_at)
    on conflict (tenant_id, idempotency_key) do nothing;
  end loop;

  for t in select * from jsonb_array_elements(coalesce(pl -> 'tasks', '[]')) loop
    insert into public.tasks (tenant_id, type, reason, invoice_id, customer_id, receipt_id, urgent, details, dedupe_key, created_at)
    values (v_tenant, t ->> 'type', null, v_invoice, inv.customer_id, v_receipt, coalesce((t ->> 'urgent')::boolean, false),
            jsonb_build_object('amount', v_amount, 'credit', v_credit, 'currency', inv.currency), format('receipt:%s:%s', v_receipt, t ->> 'type'), v_at)
    on conflict (tenant_id, dedupe_key) do nothing;
  end loop;

  -- Issue L: a reminder that went out after the money arrived is recorded on the timeline, never ignored.
  for m in
    select ms.id from public.message_invoices mi join public.messages ms on ms.tenant_id = mi.tenant_id and ms.id = mi.message_id
    where mi.tenant_id = v_tenant and mi.invoice_id = v_invoice and ms.direction = 'out' and ms.purpose = 'reminder'
      and ms.send_state in ('sent', 'unknown', 'pending') and coalesce(ms.sent_at, ms.pending_since) > (r ->> 'received_at')::timestamptz
  loop
    insert into public.invoice_events (tenant_id, invoice_id, type, payload, idempotency_key, created_at)
    values (v_tenant, v_invoice, 'ReminderAfterPayment', jsonb_build_object('messageId', m.id, 'receiptId', v_receipt), format('%s:after-payment', m.id), v_at)
    on conflict (tenant_id, idempotency_key) do nothing;
  end loop;

  -- Issue K: the receipt send is queued in the SAME transaction (transactional outbox).
  if coalesce((pl ->> 'send_receipt')::boolean, false) then
    perform pgmq.send('transactional_sends', jsonb_build_object('kind', 'receipt', 'receipt_id', v_receipt, 'tenant_id', v_tenant, 'invoice_id', v_invoice));
  end if;
  return jsonb_build_object('result', 'applied', 'receipt_id', v_receipt);
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Ledger integrity (rule 28). One row per finding; pnpm payments:integrity fails on any.
create function private.payment_integrity(p_tenant uuid default null) returns table (finding text, tenant_id uuid, ref uuid, detail text)
language sql stable security definer set search_path = '' as $$
  select 'receipt_unbalanced', r.tenant_id, r.id, format('received %s, applied %s, credit %s', r.amount, coalesce(p.s, 0), coalesce(c.amount, 0))
  from public.receipts r
  left join (select receipt_id, sum(amount) s from public.payments group by receipt_id) p on p.receipt_id = r.id
  left join public.credits c on c.receipt_id = r.id
  where (p_tenant is null or r.tenant_id = p_tenant) and r.amount <> coalesce(p.s, 0) + coalesce(c.amount, 0)
  union all
  select 'payment_without_receipt', p.tenant_id, p.id, p.provider_ref from public.payments p where p.receipt_id is null and (p_tenant is null or p.tenant_id = p_tenant)
  union all
  select 'negative_balance', b.tenant_id, b.invoice_id, format('balance %s', b.balance) from public.invoice_balances b where b.balance < 0 and (p_tenant is null or b.tenant_id = p_tenant)
  union all
  select 'paid_with_balance', i.tenant_id, i.id, format('balance %s', b.balance)
  from public.invoices i join public.invoice_balances b on b.tenant_id = i.tenant_id and b.invoice_id = i.id
  where i.status = 'paid' and b.balance > 0 and (p_tenant is null or i.tenant_id = p_tenant)
  union all
  select 'active_request_on_final_invoice', q.tenant_id, q.id, i.status
  from public.payment_requests q join public.invoices i on i.tenant_id = q.tenant_id and i.id = q.invoice_id
  where q.status = 'active' and i.status in ('paid', 'written_off', 'cancelled') and (p_tenant is null or q.tenant_id = p_tenant)
$$;

-- Purge raw payment events past retention (they hold payer details; the ledger keeps what matters).
create function private.purge_payment_events(p_as_of timestamptz default now()) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.receipts set payment_event_id = null where payment_event_id in (select id from public.payment_events where purge_after < p_as_of and status <> 'pending');
  delete from public.payment_events where purge_after < p_as_of and status <> 'pending';
  get diagnostics n = row_count;
  return n;
end $$;
select cron.schedule('dueloop-purge-payment-events', '41 3 * * *', $$select private.purge_payment_events(now()) where private.flag('cron_enabled')$$);

do $$
declare f text;
begin
  foreach f in array array[
    'private.legacy_payment_receipt()', 'private.guard_ledger()',
    'private.set_payment_secret(uuid, text, text)', 'private.payment_secret(uuid, text)',
    'private.store_payment_event(uuid, text, text, text, jsonb, jsonb, timestamptz, interval)',
    'private.apply_payment(jsonb)', 'private.payment_integrity(uuid)', 'private.purge_payment_events(timestamptz)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;
end $$;
