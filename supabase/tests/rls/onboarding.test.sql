-- create_tenant: a signed-in user creates a business and becomes its owner; anon cannot.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d1', 'founder@test.invalid');

select ok(not has_function_privilege('anon', 'public.create_tenant(text, text, text, smallint, smallint)', 'execute'), 'anon cannot call create_tenant');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', true);
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000000d1", "role": "authenticated"}', true);

select lives_ok($$select public.create_tenant('Founder Ltd', 'Asia/Karachi', 'pkr')$$, 'a signed-in user creates a business');
select is((select role from public.memberships where user_id = '00000000-0000-0000-0000-0000000000d1'), 'owner', 'the creator is its owner');
select is((select currency::text from public.tenants where name = 'Founder Ltd'), 'PKR', 'currency is normalised to upper case');
select is((select count(*)::int from public.policies where is_default), 1, 'a default policy exists and is visible to the owner');
select throws_ok($$select public.create_tenant('Bad Zone Ltd', '+05:00', 'PKR')$$, '23514', null, 'an offset time zone is rejected');

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
select throws_ok($$select public.create_tenant('No User Ltd', 'UTC', 'USD')$$, '42501', null, 'a request without a user is rejected');

select * from finish();
rollback;
