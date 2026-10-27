-- VERBATIM guide Section 6.1 + 6.2 draft (never executed by the guide author).
-- Applied unchanged so the issue tests A-I can be shown failing before the fix.

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'UTC',
  currency char(3) not null default 'USD',
  quiet_start time not null default '20:00',
  quiet_end time not null default '09:00',
  approval_mode text not null default 'always'
    check (approval_mode in ('always','low_confidence','never')),
  outbound_paused boolean not null default false, -- tenant kill switch
  monthly_message_budget_minor bigint not null default 0,
  created_at timestamptz not null default now()
);

create table public.memberships (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','accountant','collector')),
  primary key (tenant_id, user_id)
);
create index on public.memberships (user_id, tenant_id);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  display_name text not null,
  email text,
  phone_e164 text, -- e.g. +14155550123
  language text not null default 'en', -- locale code, e.g. en, es, de
  preferred_channel text check (preferred_channel in ('email','whatsapp','sms')),
  opted_out boolean not null default false,
  external_id text,
  created_at timestamptz not null default now(),
  unique (tenant_id, external_id)
);

create table public.policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  steps jsonb not null, -- [{id, daysAfterDue, channel, templateKey}] validated by Zod in app code
  escalate_after_days int not null default 21,
  grace_days_after_promise int not null default 1,
  max_messages_per_week int not null default 3,
  is_default boolean not null default false
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id),
  policy_id uuid references public.policies(id),
  number text not null,
  amount_total bigint not null check (amount_total > 0), -- minor units (cents)
  amount_paid bigint not null default 0 check (amount_paid >= 0),
  currency char(3) not null default 'USD',
  issued_on date not null,
  due_on date not null,
  status text not null default 'open' check (status in
    ('open','overdue','promised','disputed','escalated','paid','written_off','cancelled')),
  promised_on date,
  reference_code text not null, -- what the customer quotes in a bank transfer
  next_action_at timestamptz,
  enqueued_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, number),
  unique (tenant_id, reference_code)
);
create index invoices_due_idx on public.invoices (next_action_at)
  where status in ('open','overdue','promised');

create table public.invoice_events ( -- append-only audit log
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  type text not null, -- 'ReminderSent', 'PromiseRecorded', ...
  payload jsonb not null default '{}',
  idempotency_key text,
  created_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key) -- NULLs are allowed more than once
);
create index on public.invoice_events (invoice_id, created_at);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  customer_id uuid not null references public.customers(id),
  invoice_ids uuid[] not null default '{}', -- which invoices this message concerned
  channel text not null check (channel in ('email','whatsapp','sms')),
  direction text not null check (direction in ('in','out')),
  body text,
  template_key text,
  provider_message_id text,
  delivery_status text, -- queued / sent / delivered / read / failed
  analysis jsonb, -- validated reply analysis for inbound messages
  created_at timestamptz not null default now(),
  unique (tenant_id, channel, provider_message_id)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  invoice_id uuid not null references public.invoices(id),
  amount bigint not null check (amount > 0), -- minor units (cents)
  method text not null, -- 'bank_transfer','stripe','paypal',...
  provider_ref text not null,
  paid_at timestamptz not null,
  confirmed_by uuid references auth.users(id), -- null when confirmed by a signed webhook
  unique (tenant_id, method, provider_ref) -- idempotency: the same payment can never count twice
);

create table public.holidays (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  on_date date not null, label text,
  primary key (tenant_id, on_date)
);

-- 6.2 RLS pattern
create or replace function public.is_member(t uuid, roles text[] default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = t and m.user_id = auth.uid()
      and (roles is null or m.role = any (roles))
  );
$$;

alter table public.invoices enable row level security;
create policy invoices_read on public.invoices for select
  using (public.is_member(tenant_id));
create policy invoices_insert on public.invoices for insert
  with check (public.is_member(tenant_id, array['owner','accountant']));
create policy invoices_update on public.invoices for update
  using (public.is_member(tenant_id, array['owner','accountant']))
  with check (public.is_member(tenant_id, array['owner','accountant']));
