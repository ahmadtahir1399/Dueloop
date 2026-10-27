-- Issue F: no security definer function in an exposed schema; anon executes nothing in public;
-- every policy is TO authenticated and calls helpers wrapped in (select ...).
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'graphql_public') and p.prosecdef),
  0, 'no security definer function in an exposed schema'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')),
  0, 'anon cannot execute any function in public'
);
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public'
     and (roles <> '{authenticated}'
          or coalesce(qual, '') || ' ' || coalesce(with_check, '') !~ '\(\s*SELECT\s+private\.')),
  0, 'every policy is TO authenticated and uses (select private.helper(...))'
);

select * from finish();
rollback;
