-- Issue C: quiet hours are whole hours 0-23 like core Settings; start = end means no quiet hours.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../fixtures/two_tenants.inc
select plan(6);

select col_type_is('public', 'tenants', 'quiet_start_hour', 'smallint', 'quiet_start_hour is smallint');
select col_type_is('public', 'tenants', 'quiet_end_hour', 'smallint', 'quiet_end_hour is smallint');
select hasnt_column('public', 'tenants', 'quiet_start', 'no time-typed quiet_start column');
select throws_ok($$update public.tenants set quiet_start_hour = 24 where name = 'Tenant A'$$, '23514', null, 'hour 24 rejected');
select throws_ok($$update public.tenants set quiet_end_hour = -1 where name = 'Tenant A'$$, '23514', null, 'hour -1 rejected');
select lives_ok(
  $$update public.tenants set quiet_start_hour = 9, quiet_end_hour = 9 where name = 'Tenant A'$$,
  'start = end (no quiet hours, as in core) is allowed'
);

select * from finish();
rollback;
