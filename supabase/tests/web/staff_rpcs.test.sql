-- Prompt 6 Part A (migration 0017): last-owner protection, member RPCs, nav counters, global pause boolean,
-- audit export (role, logging, scrubbed payload). Every RPC is checked for owner/accountant/collector/outsider/anon.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../fixtures/rls_world.inc
select plan(36);

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p::text, true);
$$;
grant execute on function pg_temp.as_user(uuid) to authenticated, anon;

-- ---- last owner (the trigger guards direct writes, the RPCs and the service role alike) ----
select throws_ok($$update public.memberships set role = 'accountant' where tenant_id = '00000000-0000-0000-0000-00000000000a' and user_id = '00000000-0000-0000-0000-0000000000a1'$$,
  '23514', 'a tenant must keep at least one owner', 'M: the last owner cannot be demoted (postgres)');
select throws_ok($$delete from public.memberships where tenant_id = '00000000-0000-0000-0000-00000000000a' and user_id = '00000000-0000-0000-0000-0000000000a1'$$,
  '23514', 'a tenant must keep at least one owner', 'M: the last owner cannot be removed (postgres)');
select throws_ok($$update public.memberships set tenant_id = '00000000-0000-0000-0000-00000000000b' where tenant_id = '00000000-0000-0000-0000-00000000000a' and user_id = '00000000-0000-0000-0000-0000000000a1'$$,
  '23514', null, 'M: moving the last owner to another tenant counts as removal');
select lives_ok($$delete from public.memberships where tenant_id = '00000000-0000-0000-0000-00000000000a' and user_id = '00000000-0000-0000-0000-0000000000a3'$$,
  'removing a non-owner is fine');
insert into public.memberships (tenant_id, user_id, role) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a3', 'collector');

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.set_member_role('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'collector')$$,
  '23514', null, 'M: the owner cannot demote themself when last');
select throws_ok($$select public.remove_member('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1')$$,
  '23514', null, 'M: the owner cannot remove themself when last');
select lives_ok($$select public.set_member_role('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2', 'owner')$$,
  'owner promotes the accountant');
select lives_ok($$select public.set_member_role('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'accountant')$$,
  'with a second owner, the first may step down');
select throws_ok($$select public.set_member_role('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a3', 'owner')$$,
  '42501', null, 'the former owner (now accountant) can no longer change roles');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select lives_ok($$select public.set_member_role('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'owner')$$,
  'the new owner restores the first');
select lives_ok($$select public.set_member_role('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2', 'accountant')$$,
  'and steps back to accountant');
select throws_ok($$select public.set_member_role('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a3', 'owner')$$,
  '42501', null, 'accountant cannot change roles');
select throws_ok($$select public.remove_member('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a3')$$,
  '42501', null, 'accountant cannot remove members');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select public.set_member_role('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a3', 'owner')$$,
  '42501', null, 'owner of another tenant cannot change roles here (IDOR)');
select throws_ok($$select * from public.list_members('00000000-0000-0000-0000-00000000000a')$$,
  '42501', null, 'owner of another tenant cannot list members here');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from public.list_members('00000000-0000-0000-0000-00000000000a')), 3, 'a collector lists the 3 members of their tenant');
select is((select email from public.list_members('00000000-0000-0000-0000-00000000000a') where role = 'owner'), 'owner-a@test.invalid', 'with emails');
reset role;
select is((select count(*)::int from public.tenant_events where tenant_id = '00000000-0000-0000-0000-00000000000a' and type = 'MemberRoleChanged'), 4,
  'every role change is a tenant event');

-- ---- nav counters (RLS: a foreign tenant counts as zero) ----
insert into public.tasks (tenant_id, type, status, dedupe_key, created_at, invoice_id)
  values ('00000000-0000-0000-0000-00000000000a', 'human_review', 'open', 'nav-test-1', now(), '00000000-0000-0000-0000-0000000001aa');
insert into public.messages (tenant_id, customer_id, channel, direction, idempotency_key, send_state)
  values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000ca', 'email', 'out', 'A-1:nav:email', 'unknown');
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a3');
select is((select tasks from public.nav_counters('00000000-0000-0000-0000-00000000000a')),
  (select count(*) from public.tasks where tenant_id = '00000000-0000-0000-0000-00000000000a' and status = 'open'), 'counter: open tasks (same as a direct count under RLS)');
select is((select unknown_messages from public.nav_counters('00000000-0000-0000-0000-00000000000a')), 1::bigint, 'counter: unknown messages');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select is((select tasks + unknown_messages from public.nav_counters('00000000-0000-0000-0000-00000000000a')), 0::bigint,
  'counters of another tenant are zero for an outsider (RLS)');
select is(public.is_globally_paused(), false, 'global pause is readable as a boolean');
select throws_ok($$select * from private.system_flags$$, '42501', null, 'system_flags stay unreadable');

-- ---- audit export ----
select throws_ok($$select public.audit_export('00000000-0000-0000-0000-00000000000a', now() - interval '1 day', now() + interval '1 day')$$,
  '42501', null, 'Q: a foreign owner cannot export');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a3');
select throws_ok($$select public.audit_export('00000000-0000-0000-0000-00000000000a', now() - interval '1 day', now() + interval '1 day')$$,
  '42501', null, 'Q: a collector cannot export the audit log');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$select public.audit_export('00000000-0000-0000-0000-00000000000a', now(), now() - interval '1 day')$$,
  '22023', null, 'Q: the range must be valid');
reset role;
insert into public.invoice_events (tenant_id, invoice_id, type, payload, idempotency_key)
  values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000001aa', 'ReplyClassified',
          '{"summary": "=HYPERLINK(1)", "email": "a@b.c", "intent": "promise", "confidence": 0.9}', 'audit-scrub-1');
create temp table ex (r jsonb) on commit drop;
grant all on ex to authenticated;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
insert into ex select public.audit_export('00000000-0000-0000-0000-00000000000a', now() - interval '1 day', now() + interval '1 day');
reset role;
select ok((select (r ->> 'count')::int >= 2 from ex), 'Q: the accountant exports the rows of the range');
select is((select e -> 'payload' from ex, jsonb_array_elements(r -> 'rows') e where e ->> 'key' = 'audit-scrub-1'),
  '{"intent": "promise", "confidence": 0.9}'::jsonb, 'Q: contact details and model text are dropped from payloads');
select is((select count(*)::int from public.tenant_events where tenant_id = '00000000-0000-0000-0000-00000000000a' and type = 'AuditExported'), 1,
  'Q: the export is logged as AuditExported');
select is((select (payload ->> 'rows')::int from public.tenant_events where type = 'AuditExported'), (select (r ->> 'count')::int from ex),
  'Q: with its row count');
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select is((public.audit_export('00000000-0000-0000-0000-00000000000a', now() - interval '1 day', now() + interval '1 day', 1) ->> 'truncated')::boolean,
  true, 'Q: the cap truncates and says so');
reset role;

-- ---- anon gets nothing ----
set local role anon;
select throws_ok($$select public.nav_counters('00000000-0000-0000-0000-00000000000a')$$, '42501', null, 'anon cannot call nav_counters');
select throws_ok($$select public.is_globally_paused()$$, '42501', null, 'anon cannot call is_globally_paused');
select throws_ok($$select * from public.list_members('00000000-0000-0000-0000-00000000000a')$$, '42501', null, 'anon cannot list members');
reset role;

-- ---- purge still works (the cascade passes the last-owner rule because the tenant row is already gone) ----
select lives_ok($$select private.purge_tenant('00000000-0000-0000-0000-00000000000b')$$, 'purging a tenant removes its last owner too');
select is((select count(*)::int from public.memberships where tenant_id = '00000000-0000-0000-0000-00000000000b'), 0, 'and its memberships');

select * from finish();
rollback;
