-- Migration 0026 (review round 2): inbound WhatsApp is routed by channel_accounts.external_account_id and the worker
-- reads the Vault secret named by secret_id. An owner could PATCH either through the API: claim another business's
-- WhatsApp number (and receive its customers' replies) or point at a Vault secret that is not theirs. Only trusted
-- server code writes them now (after Meta confirms the number / through set_channel_secret).
begin;
create extension if not exists pgtap with schema extensions;
\ir ../fixtures/rls_world.inc
select plan(5);

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p::text, true);
$$;
grant execute on function pg_temp.as_user(uuid) to authenticated, anon;

insert into public.channel_accounts (tenant_id, channel, config) values ('00000000-0000-0000-0000-00000000000a', 'whatsapp', '{}')
  on conflict (tenant_id, channel) do nothing;

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1'); -- owner of A
select throws_ok($$update public.channel_accounts set external_account_id = '106540352242922' where tenant_id = '00000000-0000-0000-0000-00000000000a' and channel = 'whatsapp'$$,
  '42501', null, 'an owner cannot route a WhatsApp number to the tenant directly');
select throws_ok($$update public.channel_accounts set secret_id = gen_random_uuid() where tenant_id = '00000000-0000-0000-0000-00000000000a'$$,
  '42501', null, 'nor point the account at another Vault secret');
select throws_ok($$insert into public.channel_accounts (tenant_id, channel, config, external_account_id) values ('00000000-0000-0000-0000-00000000000a', 'sms', '{}', '555')$$,
  '42501', null, 'nor insert an account with a routing id');
select lives_ok($$update public.channel_accounts set enabled = enabled, config = config where tenant_id = '00000000-0000-0000-0000-00000000000a'$$,
  'config and enabled stay editable (RLS still limits them to owners)');
select lives_ok($$insert into public.channel_accounts (tenant_id, channel, config) values ('00000000-0000-0000-0000-00000000000a', 'sms', '{}')$$,
  'and an owner can still add an account without a routing id');
reset role;

select * from finish();
rollback;
