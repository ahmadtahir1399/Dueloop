-- decide_approval / edit_approval / set_outbound_paused permissions (ADR 0012) and secret isolation.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../fixtures/rls_world.inc
select plan(12);

insert into public.approvals (id, tenant_id, invoice_id, idempotency_key, step_id, channel, requested_at) values
  ('00000000-0000-0000-0000-0000000006a1', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000001aa', 'A-1:s1:email', 's1', 'email', now()),
  ('00000000-0000-0000-0000-0000000006a2', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000001aa', 'A-1:s2:email', 's2', 'email', now());

-- Secrets: authenticated has no access to the vault schema at all.
select ok(not has_schema_privilege('authenticated', 'vault', 'usage'), 'authenticated cannot use schema vault');
select ok(not has_schema_privilege('anon', 'vault', 'usage'), 'anon cannot use schema vault');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000000a3", "role": "authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
select throws_ok($$select public.decide_approval('00000000-0000-0000-0000-0000000006a1', 'approve')$$, '42501', null, 'collector cannot approve');
select throws_ok($$select public.set_outbound_paused('00000000-0000-0000-0000-00000000000a', true)$$, '42501', null, 'collector cannot pause sending');

select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000000b1", "role": "authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
select throws_ok($$select public.decide_approval('00000000-0000-0000-0000-0000000006a1', 'approve')$$, '42501', null, 'owner of another tenant cannot approve');

select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000000a2", "role": "authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
select lives_ok($$select public.edit_approval('00000000-0000-0000-0000-0000000006a1', 'Subject', 'Edited body')$$, 'accountant edits a pending approval');
select is(public.decide_approval('00000000-0000-0000-0000-0000000006a1', 'approve'), 'approved', 'accountant approves');
select is(public.decide_approval('00000000-0000-0000-0000-0000000006a2', 'reject', 'not now'), 'rejected', 'accountant rejects');
select throws_ok($$select public.decide_approval('00000000-0000-0000-0000-0000000006a1', 'reject')$$, '55000', null, 'a decided approval cannot be decided again');
select throws_ok($$select public.set_outbound_paused('00000000-0000-0000-0000-00000000000a', true)$$, '42501', null, 'accountant cannot pause sending');
reset role;

select is((select send_state from public.messages where idempotency_key = 'A-1:s2:email'), 'skipped', 'E: a rejected step is recorded as skipped');
select is((select count(*)::int from public.invoice_events where idempotency_key in ('A-1:s2:email:skipped', 'A-1:s1:email:approval-approve:v1')), 2,
  'events for the rejection skip and the grant');

select * from finish();
rollback;
