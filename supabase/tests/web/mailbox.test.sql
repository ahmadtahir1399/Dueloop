-- Migration 0027 (ADR 0054): where the poller connects and with which password. config is client-writable, so these
-- two live in columns no client role can write; otherwise an owner could point the stored password at their own
-- server and read a write-only secret. private.set_mailbox is the only writer, and it holds the password to the
-- server it was saved for.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../fixtures/rls_world.inc
select plan(14);

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p::text, true);
$$;
grant execute on function pg_temp.as_user(uuid) to authenticated, anon;

select private.set_mailbox('00000000-0000-0000-0000-00000000000a', '{"host":"imap.a.example","port":993,"user":"a","mailbox":"INBOX"}', 'first-password', 'replies@a.example');
select is(private.mailbox_password('00000000-0000-0000-0000-00000000000a'), 'first-password', 'the password is stored in Vault');
select is((select config ->> 'reply_to' from public.channel_accounts where tenant_id = '00000000-0000-0000-0000-00000000000a' and channel = 'email'), 'replies@a.example', 'the reply address goes in config, where the sender reads it');
select is(private.channel_secret('00000000-0000-0000-0000-00000000000a', 'email'), null, 'the SMTP secret is untouched (it would replace the operator login)');

-- Same host and login: the saved password stays, and a new one replaces it.
select lives_ok($$select private.set_mailbox('00000000-0000-0000-0000-00000000000a', '{"host":"imap.a.example","port":143,"user":"a","mailbox":"Replies"}', null, null)$$, 'a folder or port change keeps the password');
select is(private.mailbox_password('00000000-0000-0000-0000-00000000000a'), 'first-password', 'and it is the same password');
select is((select config ? 'reply_to' from public.channel_accounts where tenant_id = '00000000-0000-0000-0000-00000000000a' and channel = 'email'), false, 'an empty reply address clears it');

-- Another server or login must bring its own password.
select throws_ok($$select private.set_mailbox('00000000-0000-0000-0000-00000000000a', '{"host":"imap.evil.example","port":993,"user":"a","mailbox":"INBOX"}', null, null)$$,
  '22023', null, 'the stored password never follows a host change');
select throws_ok($$select private.set_mailbox('00000000-0000-0000-0000-00000000000a', '{"host":"imap.a.example","port":993,"user":"other","mailbox":"INBOX"}', null, null)$$,
  '22023', null, 'nor a login change');

-- The cursor belongs to one mailbox.
insert into private.imap_cursors (channel_account_id, mailbox, uid_validity, last_uid)
  select id, 'Replies', '7', 42 from public.channel_accounts where tenant_id = '00000000-0000-0000-0000-00000000000a' and channel = 'email';
select private.set_mailbox('00000000-0000-0000-0000-00000000000a', '{"host":"imap.a.example","port":143,"user":"a","mailbox":"Other"}', null, null);
select is((select count(*)::int from private.imap_cursors c join public.channel_accounts a on a.id = c.channel_account_id where a.tenant_id = '00000000-0000-0000-0000-00000000000a'), 0, 'another folder starts from a new baseline');

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1'); -- owner of A
select throws_ok($$update public.channel_accounts set imap_config = '{"host":"imap.evil.example"}' where tenant_id = '00000000-0000-0000-0000-00000000000a' and channel = 'email'$$,
  '42501', null, 'an owner cannot change the connection through the API');
select throws_ok($$update public.channel_accounts set imap_secret_id = gen_random_uuid() where tenant_id = '00000000-0000-0000-0000-00000000000a' and channel = 'email'$$,
  '42501', null, 'nor point it at another Vault secret');
select throws_ok($$select private.set_mailbox('00000000-0000-0000-0000-00000000000a', '{}', 'x', null)$$, '42501', null, 'nor call the setter');
reset role;
select set_config('request.jwt.claims', '', true); -- back to the trusted connection

select ok(private.disconnect_mailbox('00000000-0000-0000-0000-00000000000a'), 'disconnecting succeeds');
select is((select count(*)::int from vault.secrets where name = 'dueloop:00000000-0000-0000-0000-00000000000a:imap'), 0, 'and the password is deleted, not orphaned');

select * from finish();
rollback;
