-- 0006_onboarding.sql: a signed-in user creates their business (tenant) and becomes its owner.
-- Same pattern as 0005: public security INVOKER wrapper -> private security definer implementation,
-- because ADR 0008 gives clients no INSERT on tenants.

create function private.create_tenant_impl(
  p_name text, p_timezone text, p_currency text, p_quiet_start_hour smallint, p_quiet_end_hour smallint
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  t uuid;
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'sign in to create a business';
  end if;
  -- Tenant CHECKs and the timezone trigger validate the inputs.
  insert into public.tenants (name, timezone, currency, quiet_start_hour, quiet_end_hour)
  values (btrim(p_name), p_timezone, upper(btrim(p_currency)), p_quiet_start_hour, p_quiet_end_hour)
  returning id into t;
  insert into public.memberships (tenant_id, user_id, role) values (t, uid, 'owner');
  -- A starting policy so the tenant can be evaluated right away; the owner can edit it later.
  insert into public.policies (tenant_id, name, steps, escalate_after_days, grace_days_after_promise, max_messages_per_week, is_default)
  values (t, 'Standard', '[
    {"id": "s1", "daysAfterDue": 1, "channel": "email", "templateKey": "friendly"},
    {"id": "s2", "daysAfterDue": 7, "channel": "email", "templateKey": "nudge"},
    {"id": "s3", "daysAfterDue": 14, "channel": "email", "templateKey": "firm"}
  ]', 21, 2, 3, true);
  return t;
end $$;

revoke all on function private.create_tenant_impl(text, text, text, smallint, smallint) from public, anon;
grant execute on function private.create_tenant_impl(text, text, text, smallint, smallint) to authenticated;

create function public.create_tenant(
  p_name text, p_timezone text, p_currency text,
  p_quiet_start_hour smallint default 20, p_quiet_end_hour smallint default 9
) returns uuid
language sql security invoker set search_path = '' as $$
  select private.create_tenant_impl(p_name, p_timezone, p_currency, p_quiet_start_hour, p_quiet_end_hour)
$$;
revoke all on function public.create_tenant(text, text, text, smallint, smallint) from public, anon;
grant execute on function public.create_tenant(text, text, text, smallint, smallint) to authenticated;
