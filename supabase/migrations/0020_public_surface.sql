-- Prompt 6 Part B (ADR 0045-0049): public links, API keys, rate limits, API idempotency, editor RPCs, and the
-- 'web' inbound channel for pay-page actions. Role matrix additions are in ADR 0042 (packages/authz).
-- Pattern (issue F test): definer code in `private`, invoker wrappers in `public`, nothing for anon.

-- ---------------------------------------------------------------------------------------------------------
-- 1. Pay-page actions enter the prompt 4 pipeline as inbound messages on the 'web' channel (never outbound).
alter table public.messages drop constraint messages_channel_check;
alter table public.messages add constraint messages_channel_check check (channel in ('email', 'whatsapp', 'sms', 'web'));
alter table public.messages add constraint messages_web_inbound_only check (channel <> 'web' or direction = 'in');
alter table public.messages drop constraint messages_matched_by_check;
alter table public.messages add constraint messages_matched_by_check check (matched_by in ('thread', 'context_id', 'single_open_invoice', 'none', 'pay_page_token'));
alter table public.messages drop constraint messages_prefilter_check;
alter table public.messages add constraint messages_prefilter_check check (prefilter in ('bounce', 'auto_reply', 'delivery_receipt', 'own_address', 'empty', 'opt_out_keyword', 'none', 'pay_page'));

-- ---------------------------------------------------------------------------------------------------------
-- 2. Public links (issue A): opaque random tokens, stored as sha256 hex only. Service-only table.
create table public.public_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  purpose text not null check (purpose in ('pay', 'opt_out')),
  invoice_id uuid,
  customer_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  uses integer not null default 0 check (uses >= 0),
  check ((purpose = 'pay') = (invoice_id is not null)),
  check (expires_at > created_at),
  unique (tenant_id, id),
  foreign key (tenant_id, invoice_id) references public.invoices (tenant_id, id) on delete cascade,
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id) on delete cascade
);
create index public_links_active_pay on public.public_links (tenant_id, invoice_id, expires_at) where purpose = 'pay' and revoked_at is null;
create index public_links_active_opt_out on public.public_links (tenant_id, customer_id, expires_at) where purpose = 'opt_out' and revoked_at is null;
alter table public.public_links enable row level security;
revoke all on table public.public_links from anon, authenticated;

-- A link resolves only if the hash exists, the purpose matches, it is not revoked and not expired. Callers get
-- the same NULL for every failure (unknown, expired, revoked, wrong purpose): the page cannot tell them apart.
create function private.resolve_public_link(p_hash text, p_purpose text, p_now timestamptz)
returns table (link_id uuid, tenant_id uuid, invoice_id uuid, customer_id uuid)
language sql stable security definer set search_path = '' as $$
  select l.id, l.tenant_id, l.invoice_id, l.customer_id
  from public.public_links l
  where l.token_hash = p_hash and l.purpose = p_purpose and l.revoked_at is null and l.expires_at > p_now
$$;
revoke all on function private.resolve_public_link(text, text, timestamptz) from public, anon, authenticated, service_role;

-- What the pay page may show (no customer name, email or phone).
create function private.pay_page(p_link uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'business', t.name, 'timezone', t.timezone, 'bank_instructions', t.bank_instructions,
    'invoice_number', i.number, 'reference_code', i.reference_code, 'due_on', i.due_on, 'status', i.status,
    'currency', i.currency, 'amount_total', i.amount_total::text, 'amount_paid', coalesce(p.paid, 0)::text,
    'balance', (i.amount_total - coalesce(p.paid, 0))::text,
    'has_gateway', exists (select 1 from public.payment_accounts a where a.tenant_id = t.id and a.enabled))
  from public.public_links l
  join public.invoices i on i.tenant_id = l.tenant_id and i.id = l.invoice_id
  join public.tenants t on t.id = l.tenant_id
  left join lateral (select sum(amount) as paid from public.payments pm where pm.tenant_id = i.tenant_id and pm.invoice_id = i.id) p on true
  where l.id = p_link
$$;
revoke all on function private.pay_page(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------
-- 3. Rate limits (issue P): a shared fixed-window counter in Postgres (works across instances). It lives in the
-- unexposed `private` schema: no API role can reach it, and it is not tenant data (rule 11 covers public tables).
create table private.rate_limits (
  bucket text not null check (length(bucket) between 1 and 200),
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);
revoke all on table private.rate_limits from public, anon, authenticated, service_role;

-- One atomic upsert: true when this hit is within the limit. The window is aligned to multiples of p_window.
create function private.rate_limit_hit(p_bucket text, p_window_seconds integer, p_limit integer, p_now timestamptz)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_start timestamptz := to_timestamp(floor(extract(epoch from p_now) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  insert into private.rate_limits (bucket, window_start, hits) values (p_bucket, v_start, 1)
  on conflict (bucket, window_start) do update set hits = private.rate_limits.hits + 1
  returning hits into v_hits;
  return v_hits <= p_limit;
end $$;
revoke all on function private.rate_limit_hit(text, integer, integer, timestamptz) from public, anon, authenticated, service_role;

create function private.purge_rate_limits(p_before timestamptz) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  delete from private.rate_limits where window_start < p_before;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function private.purge_rate_limits(timestamptz) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------
-- 4. API keys (issue O): `dl_<8 char prefix>_<secret>`; only sha256(secret) is stored. Owners see metadata only.
create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  prefix text not null unique check (prefix ~ '^[a-z0-9]{8}$'),
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  scopes text[] not null default array['invoices:write'] check (scopes <@ array['invoices:write']),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_used_at timestamptz,
  unique (tenant_id, id)
);
alter table public.api_keys enable row level security;
revoke all on table public.api_keys from anon, authenticated;
grant select (id, tenant_id, name, prefix, scopes, created_at, revoked_at, last_used_at) on public.api_keys to authenticated;
create policy api_keys_owner_read on public.api_keys for select to authenticated
  using (tenant_id in (select private.my_tenant_ids(array['owner'])));

create function private.create_api_key_impl(p_tenant uuid, p_name text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_prefix text;
  v_secret text;
begin
  perform private.require_owner(p_tenant);
  if p_name is null or length(btrim(p_name)) = 0 or length(p_name) > 80 then
    raise exception using errcode = '22023', message = 'give the key a name (1-80 characters)';
  end if;
  if (select count(*) from public.api_keys where tenant_id = p_tenant and revoked_at is null) >= 10 then
    raise exception using errcode = '22023', message = 'at most 10 active keys per business';
  end if;
  v_prefix := substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 8);
  v_secret := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  insert into public.api_keys (tenant_id, name, prefix, secret_hash, created_by)
  values (p_tenant, btrim(p_name), v_prefix, encode(extensions.digest(v_secret, 'sha256'), 'hex'), (select auth.uid()));
  return format('dl_%s_%s', v_prefix, v_secret); -- shown once; never stored
end $$;
revoke all on function private.create_api_key_impl(uuid, text) from public, anon;
grant execute on function private.create_api_key_impl(uuid, text) to authenticated;
create function public.create_api_key(p_tenant uuid, p_name text) returns text
language sql security invoker set search_path = '' as $$ select private.create_api_key_impl(p_tenant, p_name) $$;
revoke all on function public.create_api_key(uuid, text) from public, anon;
grant execute on function public.create_api_key(uuid, text) to authenticated;

create function private.revoke_api_key_impl(p_tenant uuid, p_key uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_owner(p_tenant);
  update public.api_keys set revoked_at = coalesce(revoked_at, now()) where tenant_id = p_tenant and id = p_key;
  if not found then raise exception using errcode = 'P0002', message = 'key not found'; end if;
end $$;
revoke all on function private.revoke_api_key_impl(uuid, uuid) from public, anon;
grant execute on function private.revoke_api_key_impl(uuid, uuid) to authenticated;
create function public.revoke_api_key(p_tenant uuid, p_key uuid) returns void
language sql security invoker set search_path = '' as $$ select private.revoke_api_key_impl(p_tenant, p_key) $$;
revoke all on function public.revoke_api_key(uuid, uuid) from public, anon;
grant execute on function public.revoke_api_key(uuid, uuid) to authenticated;

-- API idempotency store (service-only): one stored response per (tenant, Idempotency-Key) for a window.
create table public.api_idempotency (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  idem_key text not null check (length(idem_key) between 1 and 200),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  status integer,
  response jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (tenant_id, idem_key)
);
alter table public.api_idempotency enable row level security;
revoke all on table public.api_idempotency from anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- 5. Editors.
-- 5a. Policy save (issue K): step ids are system-generated, immutable and never reused. The caller sends steps
-- with an existing id (to change days/channel/template) or with a null id (new step). In the SAME transaction
-- the policy's non-final, non-parked invoices get next_action_at = now so decide() re-evaluates them.
alter table public.policies add column retired_step_ids text[] not null default '{}';

create function private.save_policy_impl(p_tenant uuid, p_policy uuid, p_name text, p_steps jsonb, p_escalate integer, p_grace integer, p_max_week integer, p_now timestamptz)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  pol public.policies%rowtype;
  v_old text[] := '{}';
  v_new jsonb := '[]';
  v_ids text[] := '{}';
  s jsonb;
  v_id text;
  v_refreshed integer;
begin
  if not exists (select 1 from public.memberships m where m.tenant_id = p_tenant and m.user_id = (select auth.uid()) and m.role in ('owner', 'accountant')) then
    raise exception using errcode = '42501', message = 'only an owner or accountant may edit policies';
  end if;
  if p_name is null or length(btrim(p_name)) = 0 or length(p_name) > 80 then raise exception using errcode = '22023', message = 'the policy needs a name'; end if;
  if jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) = 0 or jsonb_array_length(p_steps) > 10 then
    raise exception using errcode = '22023', message = 'a policy has 1 to 10 steps';
  end if;
  if p_escalate is null or p_escalate < 0 or p_escalate > 365 or p_grace is null or p_grace < 0 or p_grace > 30 or p_max_week is null or p_max_week < 0 or p_max_week > 14 then
    raise exception using errcode = '22023', message = 'escalation 0-365 days, grace 0-30 days, at most 14 messages a week';
  end if;
  if p_policy is not null then
    select * into pol from public.policies where tenant_id = p_tenant and id = p_policy for update;
    if not found then raise exception using errcode = 'P0002', message = 'policy not found'; end if;
    select coalesce(array_agg(e ->> 'id'), '{}') into v_old from jsonb_array_elements(pol.steps) e;
  end if;
  for s in select * from jsonb_array_elements(p_steps) loop
    if jsonb_typeof(s) <> 'object'
       or jsonb_typeof(s -> 'daysAfterDue') <> 'number' or (s ->> 'daysAfterDue') !~ '^[0-9]{1,3}$' or (s ->> 'daysAfterDue')::int > 365
       or (s ->> 'channel') not in ('email', 'whatsapp', 'sms')
       or coalesce(s ->> 'templateKey', '') !~ '^[a-z0-9_]{1,40}$' then
      raise exception using errcode = '22023', message = 'each step needs days after due (0-365), a channel and a template';
    end if;
    v_id := s ->> 'id';
    if v_id is null then
      loop
        v_id := 's_' || encode(extensions.gen_random_bytes(5), 'hex');
        exit when not (v_id = any (v_old) or v_id = any (coalesce(pol.retired_step_ids, '{}')) or v_id = any (v_ids));
      end loop;
    elsif not (v_id = any (v_old)) then
      raise exception using errcode = '22023', message = 'step ids are assigned by the system and cannot be invented or reused';
    end if;
    if v_id = any (v_ids) then raise exception using errcode = '22023', message = 'step ids must be unique'; end if;
    v_ids := v_ids || v_id;
    v_new := v_new || jsonb_build_array(jsonb_build_object('id', v_id, 'daysAfterDue', (s ->> 'daysAfterDue')::int, 'channel', s ->> 'channel', 'templateKey', s ->> 'templateKey'));
  end loop;

  if p_policy is null then
    insert into public.policies (tenant_id, name, steps, escalate_after_days, grace_days_after_promise, max_messages_per_week)
    values (p_tenant, btrim(p_name), v_new, p_escalate, p_grace, p_max_week) returning * into pol;
  else
    update public.policies set name = btrim(p_name), steps = v_new, escalate_after_days = p_escalate, grace_days_after_promise = p_grace,
      max_messages_per_week = p_max_week,
      retired_step_ids = (select coalesce(array_agg(distinct x), '{}') from unnest(retired_step_ids || array(select unnest(v_old) except select unnest(v_ids))) x)
    where id = pol.id returning * into pol;
  end if;

  update public.invoices i set next_action_at = p_now, enqueued_at = null
  where i.tenant_id = p_tenant and i.status in ('open', 'overdue', 'promised', 'escalated') and i.parked_reason is null
    and (i.policy_id = pol.id or (i.policy_id is null and pol.is_default));
  get diagnostics v_refreshed = row_count;
  return jsonb_build_object('policy_id', pol.id, 'refreshed', v_refreshed, 'steps', v_new);
end $$;
revoke all on function private.save_policy_impl(uuid, uuid, text, jsonb, integer, integer, integer, timestamptz) from public, anon;
grant execute on function private.save_policy_impl(uuid, uuid, text, jsonb, integer, integer, integer, timestamptz) to authenticated;
create function public.save_policy(p_tenant uuid, p_policy uuid, p_name text, p_steps jsonb, p_escalate integer, p_grace integer, p_max_week integer)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.save_policy_impl(p_tenant, p_policy, p_name, p_steps, p_escalate, p_grace, p_max_week, now())
$$;
revoke all on function public.save_policy(uuid, uuid, text, jsonb, integer, integer, integer) from public, anon;
grant execute on function public.save_policy(uuid, uuid, text, jsonb, integer, integer, integer) to authenticated;

-- Direct writes would bypass the step-id rule. ADR 0008's grants stay (names, limits, delete), but outside
-- save_policy a client role cannot change steps or the retired ids, and can only insert a policy with no steps.
-- SECURITY INVOKER on purpose: current_user is then the role running the statement. A client's direct write runs
-- as 'authenticated' and is guarded; vetted security-definer functions (create_tenant, save_policy) run as their
-- owner and pass.
create function private.guard_policy_steps() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' and (new.steps <> '[]'::jsonb or new.retired_step_ids <> '{}') then
    raise exception using errcode = '42501', message = 'steps are edited through save_policy';
  end if;
  if tg_op = 'UPDATE' and (new.steps is distinct from old.steps or new.retired_step_ids is distinct from old.retired_step_ids) then
    raise exception using errcode = '42501', message = 'steps are edited through save_policy';
  end if;
  return new;
end $$;
revoke all on function private.guard_policy_steps() from public, anon;
grant execute on function private.guard_policy_steps() to authenticated;
create trigger policies_guard_steps before insert or update on public.policies for each row execute function private.guard_policy_steps();

-- 5b. Templates (issue L): editing a WhatsApp body marks it 'needs_resubmission' (the router already refuses any
-- WhatsApp template that is not 'approved'); only an owner can set it back, through set_template_provider_status.
alter table public.templates drop constraint templates_provider_status_check;
alter table public.templates add constraint templates_provider_status_check check (provider_status in ('approved', 'pending', 'rejected', 'paused', 'disabled', 'needs_resubmission'));

-- SECURITY INVOKER for the same reason as guard_policy_steps: only direct client writes are guarded.
create function private.guard_template_edit() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.provider_status is distinct from old.provider_status then
    raise exception using errcode = '42501', message = 'the provider status is set by an owner after the provider approved the text';
  end if;
  if new.channel = 'whatsapp' and (new.body is distinct from old.body or new.subject is distinct from old.subject) then
    new.provider_status := 'needs_resubmission';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function private.guard_template_edit() from public, anon;
grant execute on function private.guard_template_edit() to authenticated;
create trigger templates_guard_edit before update on public.templates for each row execute function private.guard_template_edit();

create function private.set_template_provider_status_impl(p_tenant uuid, p_template uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_owner(p_tenant);
  if p_status not in ('approved', 'pending', 'rejected', 'paused', 'disabled', 'needs_resubmission') then
    raise exception using errcode = '22023', message = 'unknown status';
  end if;
  update public.templates set provider_status = p_status where tenant_id = p_tenant and id = p_template and channel = 'whatsapp';
  if not found then raise exception using errcode = 'P0002', message = 'WhatsApp template not found'; end if;
end $$;
revoke all on function private.set_template_provider_status_impl(uuid, uuid, text) from public, anon;
grant execute on function private.set_template_provider_status_impl(uuid, uuid, text) to authenticated;
create function public.set_template_provider_status(p_tenant uuid, p_template uuid, p_status text) returns void
language sql security invoker set search_path = '' as $$ select private.set_template_provider_status_impl(p_tenant, p_template, p_status) $$;
revoke all on function public.set_template_provider_status(uuid, uuid, text) from public, anon;
grant execute on function public.set_template_provider_status(uuid, uuid, text) to authenticated;

-- 5c. Tenant settings (owner only), validated here; the app runs core validateSettings first for messages.
create function private.save_tenant_settings_impl(p_tenant uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_owner(p_tenant);
  if jsonb_typeof(p) <> 'object' then raise exception using errcode = '22023', message = 'settings must be an object'; end if;
  if exists (select 1 from jsonb_object_keys(p) k where k not in ('timezone', 'quiet_start_hour', 'quiet_end_hour', 'approval_mode', 'promise_acceptance', 'monthly_message_budget_minor', 'bank_instructions', 'proof_ai_extraction')) then
    raise exception using errcode = '22023', message = 'unknown setting';
  end if;
  if p ? 'bank_instructions' and length(coalesce(p ->> 'bank_instructions', '')) > 1000 then
    raise exception using errcode = '22023', message = 'bank details are at most 1000 characters';
  end if;
  if p ? 'monthly_message_budget_minor' and (p ->> 'monthly_message_budget_minor') !~ '^[0-9]{1,15}$' then
    raise exception using errcode = '22023', message = 'the budget is a whole number of minor units';
  end if;
  update public.tenants set
    timezone = coalesce(p ->> 'timezone', timezone),
    quiet_start_hour = coalesce((p ->> 'quiet_start_hour')::smallint, quiet_start_hour),
    quiet_end_hour = coalesce((p ->> 'quiet_end_hour')::smallint, quiet_end_hour),
    approval_mode = coalesce(p ->> 'approval_mode', approval_mode),
    promise_acceptance = coalesce(p ->> 'promise_acceptance', promise_acceptance),
    monthly_message_budget_minor = coalesce((p ->> 'monthly_message_budget_minor')::bigint, monthly_message_budget_minor),
    bank_instructions = case when p ? 'bank_instructions' then nullif(btrim(p ->> 'bank_instructions'), '') else bank_instructions end,
    proof_ai_extraction = coalesce((p ->> 'proof_ai_extraction')::boolean, proof_ai_extraction)
  where id = p_tenant;
end $$;
revoke all on function private.save_tenant_settings_impl(uuid, jsonb) from public, anon;
grant execute on function private.save_tenant_settings_impl(uuid, jsonb) to authenticated;
create function public.save_tenant_settings(p_tenant uuid, p jsonb) returns void
language sql security invoker set search_path = '' as $$ select private.save_tenant_settings_impl(p_tenant, p) $$;
revoke all on function public.save_tenant_settings(uuid, jsonb) from public, anon;
grant execute on function public.save_tenant_settings(uuid, jsonb) to authenticated;
