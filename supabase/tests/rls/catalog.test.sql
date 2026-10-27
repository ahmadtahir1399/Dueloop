-- Catalog-level guarantees: RLS everywhere, tenant_id everywhere, anon has nothing.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

select is(
  (select array_agg(c.relname order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  null, 'every table in public has RLS enabled');

select is(
  (select array_agg(t.table_name::text order by t.table_name) from information_schema.tables t
   where t.table_schema = 'public' and t.table_type = 'BASE TABLE' and t.table_name <> 'tenants'
     and not exists (select 1 from information_schema.columns c
                     where c.table_schema = 'public' and c.table_name = t.table_name and c.column_name = 'tenant_id')),
  null, 'every public table except tenants has tenant_id (rule 11)');

select is(
  (select array_agg(c.relname order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
     and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert')
          or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'))),
  null, 'anon holds no privilege on any public table or view');

select is(
  (select array_agg(c.relname order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and not coalesce('security_invoker=true' = any (c.reloptions), false)),
  null, 'every public view is security_invoker');

select ok(not has_schema_privilege('anon', 'private', 'usage'), 'anon cannot use the private schema');

select * from finish();
rollback;
