-- 0001_core.sql: core tables. Corrected from guide 6.1 (draft, never executed) for issues A, B, C, G, H.
-- Conventions (ADR 0005): every tenant-owned table has tenant_id; every cross-table reference
-- includes tenant_id through a composite foreign key onto a (tenant_id, id) unique key.

-- Helpers that RLS policies and triggers call live here. This schema is NOT exposed by the
-- Data API (supabase/config.toml [api].schemas), so security definer functions in it cannot
-- be called over HTTP.
create schema private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- Exposure is opt-in: new objects in public grant nothing until a migration grants it.
-- (Supabase docs, "Revoke default privileges".)
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated, service_role;
alter default privileges for role postgres revoke execute on functions from public;

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  -- IANA name, validated by trigger in 0002 (issue I). No default: a silent 'UTC' hides mistakes.
  timezone text not null,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  -- Whole local hours like core Settings.quietHours (issue C). start = end means "no quiet hours".
  quiet_start_hour smallint not null default 20 check (quiet_start_hour between 0 and 23),
  quiet_end_hour smallint not null default 9 check (quiet_end_hour between 0 and 23),
  approval_mode text not null default 'always' check (approval_mode in ('always', 'low_confidence', 'never')),
  outbound_paused boolean not null default false, -- tenant kill switch
  monthly_message_budget_minor bigint not null default 0 check (monthly_message_budget_minor >= 0),
  created_at timestamptz not null default now()
);

create table public.memberships (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'accountant', 'collector')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
-- RLS helpers filter on user_id first.
create index memberships_user_tenant_idx on public.memberships (user_id, tenant_id);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) > 0),
  -- Stored normalised (trimmed, lower-case) so identity lookups are exact.
  email text check (email is null or (email = lower(btrim(email)) and email like '%_@_%')),
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  -- Any BCP 47-shaped locale code (core Locale is a string, not a fixed list).
  language text not null default 'en' check (language ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$'),
  preferred_channel text check (preferred_channel in ('email', 'whatsapp', 'sms')),
  opted_out boolean not null default false,
  external_id text check (external_id is null or length(btrim(external_id)) > 0),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, external_id)
);
-- Deliberately NOT unique: one mailbox or phone can belong to two customers (ADR 0010).
create index customers_tenant_email_idx on public.customers (tenant_id, email) where email is not null;
create index customers_tenant_phone_idx on public.customers (tenant_id, phone_e164) where phone_e164 is not null;

create table public.policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  -- [{id, daysAfterDue, channel, templateKey}], validated by zod in packages/db.
  steps jsonb not null check (jsonb_typeof(steps) = 'array'),
  escalate_after_days integer not null default 21 check (escalate_after_days >= 0),
  grace_days_after_promise integer not null default 1 check (grace_days_after_promise >= 0),
  max_messages_per_week integer not null default 3 check (max_messages_per_week >= 0),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index policies_one_default_per_tenant on public.policies (tenant_id) where is_default;

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  customer_id uuid not null,
  policy_id uuid,
  number text not null check (length(btrim(number)) > 0),
  amount_total bigint not null check (amount_total > 0), -- minor units
  -- No amount_paid column (issue A): the balance is derived from payments (view in 0002).
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  issued_on date not null,
  due_on date not null,
  status text not null default 'open' check (
    status in ('open', 'overdue', 'promised', 'disputed', 'escalated', 'paid', 'written_off', 'cancelled')
  ),
  promised_on date,
  reference_code text not null check (reference_code ~ '^[A-Z0-9]{4,16}$'),
  -- Issue H: never NULL. A new invoice is due for evaluation immediately (ADR 0010, handoff to prompt 3).
  next_action_at timestamptz not null default now(),
  enqueued_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  -- Target of payments' (tenant_id, invoice_id, currency) FK, so a payment's currency must match (issue G).
  unique (tenant_id, id, currency),
  unique (tenant_id, number),
  unique (tenant_id, reference_code),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id),
  foreign key (tenant_id, policy_id) references public.policies (tenant_id, id)
);
-- Hot query for the scheduler: invoices whose next action is due (statuses decide() may act on).
create index invoices_due_idx on public.invoices (next_action_at)
  where status in ('open', 'overdue', 'promised', 'escalated');
create index invoices_tenant_customer_idx on public.invoices (tenant_id, customer_id);
create index invoices_tenant_policy_idx on public.invoices (tenant_id, policy_id) where policy_id is not null;

create table public.invoice_events ( -- append-only audit log (enforced in 0002)
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  invoice_id uuid not null,
  -- Guide 3.5 events plus InvoiceImported / InvoiceImportUpdated (prompt 2).
  type text not null check (type in (
    'ReminderScheduled', 'ReminderSent', 'ReminderFailed', 'ReplyReceived', 'ReplyClassified',
    'PromiseRecorded', 'PromiseBroken', 'DisputeRaised', 'ProofSubmitted', 'ProofVerified',
    'PaymentConfirmed', 'PartialPaymentConfirmed', 'InvoiceEscalated', 'InvoiceWrittenOff',
    'OptOutRecorded', 'ApprovalRequested', 'ApprovalGranted', 'ApprovalRejected',
    'InvoiceImported', 'InvoiceImportUpdated'
  )),
  payload jsonb not null default '{}' check (jsonb_typeof(payload) = 'object'),
  idempotency_key text,
  created_at timestamptz not null default now(),
  -- No cascade from invoices: an invoice with history cannot be deleted (ADR 0009).
  foreign key (tenant_id, invoice_id) references public.invoices (tenant_id, id),
  unique (tenant_id, idempotency_key) -- NULLs are allowed more than once
);
create index invoice_events_invoice_idx on public.invoice_events (tenant_id, invoice_id, created_at);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  customer_id uuid not null,
  channel text not null check (channel in ('email', 'whatsapp', 'sms')),
  direction text not null check (direction in ('in', 'out')),
  body text,
  template_key text,
  provider_message_id text,
  delivery_status text check (delivery_status in ('queued', 'sent', 'delivered', 'read', 'failed')),
  analysis jsonb, -- validated reply analysis for inbound messages (prompt 4)
  -- At-most-once guard for outbound sends: invoice:step:channel from core decide().
  idempotency_key text,
  created_at timestamptz not null default now(),
  check (direction = 'in' or idempotency_key is not null),
  unique (tenant_id, id),
  unique (tenant_id, channel, provider_message_id),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id)
);
create index messages_tenant_customer_idx on public.messages (tenant_id, customer_id);

-- Replaces the guide's messages.invoice_ids uuid[]: an array cannot carry a (tenant-safe) FK (issue B).
create table public.message_invoices (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  message_id uuid not null,
  invoice_id uuid not null,
  primary key (message_id, invoice_id),
  foreign key (tenant_id, message_id) references public.messages (tenant_id, id) on delete cascade,
  foreign key (tenant_id, invoice_id) references public.invoices (tenant_id, id)
);
create index message_invoices_invoice_idx on public.message_invoices (tenant_id, invoice_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  invoice_id uuid not null,
  amount bigint not null check (amount > 0), -- minor units
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  method text not null check (length(btrim(method)) > 0), -- 'bank_transfer', 'stripe', ...
  provider_ref text not null check (length(btrim(provider_ref)) > 0),
  paid_at timestamptz not null,
  confirmed_by uuid references auth.users (id) on delete set null, -- null when confirmed by a signed webhook
  created_at timestamptz not null default now(),
  -- Same tenant AND same currency as the invoice (issues B and G).
  foreign key (tenant_id, invoice_id, currency) references public.invoices (tenant_id, id, currency),
  unique (tenant_id, method, provider_ref) -- the same payment can never count twice
);
create index payments_invoice_idx on public.payments (tenant_id, invoice_id);

create table public.holidays (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  on_date date not null,
  label text,
  primary key (tenant_id, on_date)
);
