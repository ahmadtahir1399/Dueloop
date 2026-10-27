-- Issue I: tenants.timezone must be an IANA name (mirrors core validateSettings / isIanaZone).
begin;
create extension if not exists pgtap with schema extensions;
\ir ../fixtures/two_tenants.inc
select plan(5);

select throws_ok($$update public.tenants set timezone = 'Fantasia/Castle' where name = 'Tenant A'$$, '23514', null, 'unknown zone rejected');
select throws_ok($$update public.tenants set timezone = '+05:00' where name = 'Tenant A'$$, '23514', null, 'offset string rejected');
select throws_ok($$update public.tenants set timezone = 'GMT+0' where name = 'Tenant A'$$, '23514', null, 'GMT+0 rejected (core rejects it too)');
select throws_ok($$update public.tenants set timezone = 'Factory' where name = 'Tenant A'$$, '23514', null, 'Factory rejected (core rejects it too)');
select lives_ok($$update public.tenants set timezone = 'Asia/Kathmandu' where name = 'Tenant A'$$, 'Asia/Kathmandu accepted');

select * from finish();
rollback;
