-- ADR 0009: invoice_events never change; the only removal path is purging a whole tenant.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../fixtures/rls_world.inc
select plan(9);

select throws_ok($$truncate public.invoice_events$$, '23514', null, 'TRUNCATE rejected');

-- service_role can append, but not change or remove
set local role service_role;
select lives_ok(
  $$insert into public.invoice_events (tenant_id, invoice_id, type, idempotency_key)
    values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000001aa', 'ReminderSent', 'A-1:s1:email')$$,
  'service_role appends an event');
select throws_ok(
  $$insert into public.invoice_events (tenant_id, invoice_id, type, idempotency_key)
    values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000001aa', 'ReminderSent', 'A-1:s1:email')$$,
  '23505', null, 'the same idempotency key cannot be written twice');
select throws_ok($$update public.invoice_events set payload = '{}'$$, '42501', null, 'service_role has no UPDATE grant');
select throws_ok($$delete from public.tenants where name = 'Tenant A'$$, '23514', null, 'deleting a tenant directly is blocked by its events');
reset role;

select ok(not has_function_privilege('service_role', 'private.purge_tenant(uuid)', 'execute'), 'service_role cannot purge');
select ok(not has_function_privilege('authenticated', 'private.purge_tenant(uuid)', 'execute'), 'authenticated cannot purge');

select private.purge_tenant('00000000-0000-0000-0000-00000000000a');
select is(
  (select count(*)::int from public.invoice_events where tenant_id = '00000000-0000-0000-0000-00000000000a')
    + (select count(*)::int from public.tenants where id = '00000000-0000-0000-0000-00000000000a'),
  0, 'purge_tenant removes the tenant and its events');
select is(
  (select count(*)::int from public.invoice_events where tenant_id = '00000000-0000-0000-0000-00000000000b'),
  1, 'other tenants are untouched');

select * from finish();
rollback;
