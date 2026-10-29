-- Prompt 7 steps 2-3 (migrations 0021, 0022): every new object is service-only (no API role can read or call it),
-- the schema version is readable, and the suppression list is salted per tenant and enforced by trigger.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../fixtures/rls_world.inc
select plan(32);

-- ---- privileges: tables ----
select ok(not has_table_privilege(r, t, p), format('%s has no %s on %s', r, p, t))
from unnest(array['anon', 'authenticated', 'service_role']) r,
     unnest(array['private.service_heartbeats', 'private.ops_alerts', 'private.tenant_salts', 'private.suppressions']) t,
     unnest(array['select', 'insert']) p
where p = 'select' or t <> 'private.suppressions';
-- (4 tables x select + 3 tables x insert) x 3 roles = 21

-- ---- privileges: functions (anon and authenticated; the trusted CLIs connect as postgres) ----
select ok(not has_function_privilege(r, f, 'execute'), format('%s cannot execute %s', r, f))
from unnest(array['anon', 'authenticated']) r,
     unnest(array['private.ops_status(timestamptz)', 'private.erase_customer(uuid, uuid, text, timestamptz)',
                  'private.retention_run(timestamptz, integer, integer, integer)', 'private.contact_hash(uuid, text)']) f;
-- 8

-- ---- behaviour ----
select is(private.schema_version(), '0026', 'schema_version() is the newest applied migration');
select isnt(private.contact_hash('00000000-0000-0000-0000-00000000000a', 'x@example.com'),
            private.contact_hash('00000000-0000-0000-0000-00000000000b', 'x@example.com'), 'the contact hash is salted per tenant');
insert into public.customers (tenant_id, display_name, email, opted_out)
  values ('00000000-0000-0000-0000-00000000000a', 'Suppressed', 'sup@example.com', true);
insert into public.customers (tenant_id, display_name, email)
  values ('00000000-0000-0000-0000-00000000000b', 'Other tenant', 'sup@example.com');
select is((select opted_out from public.customers where tenant_id = '00000000-0000-0000-0000-00000000000b' and email = 'sup@example.com'), false,
          'a suppression in tenant A does not opt out the same address in tenant B');

select * from finish();
rollback;
