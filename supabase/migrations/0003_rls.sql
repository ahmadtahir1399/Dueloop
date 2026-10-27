-- 0003_rls.sql: Row Level Security implementing ADR 0008 (role matrix) exactly. Issue F.
-- Pattern (Supabase RLS docs): revoke default grants, grant back per role, one policy per operation,
-- `to authenticated`, helper calls wrapped in (select ...) so they run once per statement.

-- Tenants the signed-in user belongs to, optionally restricted to roles. Security definer in the
-- unexposed private schema; its result does not depend on the row, so (select ...) caching is valid.
create function private.my_tenant_ids(roles text[] default null) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.tenant_id
  from public.memberships m
  where m.user_id = (select auth.uid())
    and (roles is null or m.role = any (roles))
$$;
revoke all on function private.my_tenant_ids(text[]) from public, anon;
grant execute on function private.my_tenant_ids(text[]) to authenticated;

-- Grants: anon gets nothing anywhere; authenticated gets what ADR 0008 allows (RLS narrows rows);
-- service_role gets full access server-side.
do $$
declare t text;
begin
  foreach t in array array['tenants', 'memberships', 'customers', 'policies', 'holidays', 'invoices',
                           'invoice_events', 'messages', 'message_invoices', 'payments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated, service_role', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;
-- Events are append-only for everyone; the trigger in 0002 rejects the rest even for service_role.
revoke update, delete on table public.invoice_events from service_role;
grant usage, select on sequence public.invoice_events_id_seq to service_role;

grant select, update on table public.tenants to authenticated;
grant select, insert, update, delete on table public.memberships to authenticated;
grant select, insert, update, delete on table public.customers to authenticated;
grant select, insert, update, delete on table public.policies to authenticated;
grant select, insert, update, delete on table public.holidays to authenticated;
grant select, insert, update on table public.invoices to authenticated;
grant select on table public.invoice_events, public.messages, public.message_invoices, public.payments to authenticated;

revoke all on table public.invoice_balances, public.invoices_due from anon, authenticated, service_role;
grant select on table public.invoice_balances, public.invoices_due to authenticated, service_role;

-- tenants: members read; owners update. (No client insert/delete; see ADR 0008.)
create policy tenants_select on public.tenants for select to authenticated
  using (id in (select private.my_tenant_ids()));
create policy tenants_update on public.tenants for update to authenticated
  using (id in (select private.my_tenant_ids(array['owner'])))
  with check (id in (select private.my_tenant_ids(array['owner'])));

-- memberships: members read their tenant's staff list; only owners change it.
create policy memberships_select on public.memberships for select to authenticated
  using (tenant_id in (select private.my_tenant_ids()));
create policy memberships_insert on public.memberships for insert to authenticated
  with check (tenant_id in (select private.my_tenant_ids(array['owner'])));
create policy memberships_update on public.memberships for update to authenticated
  using (tenant_id in (select private.my_tenant_ids(array['owner'])))
  with check (tenant_id in (select private.my_tenant_ids(array['owner'])));
create policy memberships_delete on public.memberships for delete to authenticated
  using (tenant_id in (select private.my_tenant_ids(array['owner'])));

-- customers: members read; owner + accountant write; owner deletes.
create policy customers_select on public.customers for select to authenticated
  using (tenant_id in (select private.my_tenant_ids()));
create policy customers_insert on public.customers for insert to authenticated
  with check (tenant_id in (select private.my_tenant_ids(array['owner', 'accountant'])));
create policy customers_update on public.customers for update to authenticated
  using (tenant_id in (select private.my_tenant_ids(array['owner', 'accountant'])))
  with check (tenant_id in (select private.my_tenant_ids(array['owner', 'accountant'])));
create policy customers_delete on public.customers for delete to authenticated
  using (tenant_id in (select private.my_tenant_ids(array['owner'])));

-- policies and holidays: members read; owner + accountant write and delete.
create policy policies_select on public.policies for select to authenticated
  using (tenant_id in (select private.my_tenant_ids()));
create policy policies_insert on public.policies for insert to authenticated
  with check (tenant_id in (select private.my_tenant_ids(array['owner', 'accountant'])));
create policy policies_update on public.policies for update to authenticated
  using (tenant_id in (select private.my_tenant_ids(array['owner', 'accountant'])))
  with check (tenant_id in (select private.my_tenant_ids(array['owner', 'accountant'])));
create policy policies_delete on public.policies for delete to authenticated
  using (tenant_id in (select private.my_tenant_ids(array['owner', 'accountant'])));

create policy holidays_select on public.holidays for select to authenticated
  using (tenant_id in (select private.my_tenant_ids()));
create policy holidays_insert on public.holidays for insert to authenticated
  with check (tenant_id in (select private.my_tenant_ids(array['owner', 'accountant'])));
create policy holidays_update on public.holidays for update to authenticated
  using (tenant_id in (select private.my_tenant_ids(array['owner', 'accountant'])))
  with check (tenant_id in (select private.my_tenant_ids(array['owner', 'accountant'])));
create policy holidays_delete on public.holidays for delete to authenticated
  using (tenant_id in (select private.my_tenant_ids(array['owner', 'accountant'])));

-- invoices: members read; owner + accountant insert and update (status changes still pass the
-- transition trigger). Never deleted from the client.
create policy invoices_select on public.invoices for select to authenticated
  using (tenant_id in (select private.my_tenant_ids()));
create policy invoices_insert on public.invoices for insert to authenticated
  with check (tenant_id in (select private.my_tenant_ids(array['owner', 'accountant'])));
create policy invoices_update on public.invoices for update to authenticated
  using (tenant_id in (select private.my_tenant_ids(array['owner', 'accountant'])))
  with check (tenant_id in (select private.my_tenant_ids(array['owner', 'accountant'])));

-- Read-only for every member; written only by the service role / vetted functions.
create policy invoice_events_select on public.invoice_events for select to authenticated
  using (tenant_id in (select private.my_tenant_ids()));
create policy messages_select on public.messages for select to authenticated
  using (tenant_id in (select private.my_tenant_ids()));
create policy message_invoices_select on public.message_invoices for select to authenticated
  using (tenant_id in (select private.my_tenant_ids()));
create policy payments_select on public.payments for select to authenticated
  using (tenant_id in (select private.my_tenant_ids()));
