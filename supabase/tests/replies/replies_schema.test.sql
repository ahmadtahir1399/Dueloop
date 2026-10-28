-- Prompt 4 schema invariants: global account ownership, one active promise, append-only tenant events,
-- verified-event storage with dedupe, inbound messages without a customer, task/promise RPC roles, purge.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../fixtures/rls_world.inc

select plan(28);

-- Same WhatsApp phone-number id can never belong to two tenants (external_account_id is global per channel).
update public.channel_accounts set external_account_id = '106540352242922' where tenant_id = '00000000-0000-0000-0000-00000000000a';
insert into public.channel_accounts (tenant_id, channel, config, external_account_id)
values ('00000000-0000-0000-0000-00000000000a', 'whatsapp', '{}', 'wa-a');
select throws_ok(
  $$insert into public.channel_accounts (tenant_id, channel, config, external_account_id) values ('00000000-0000-0000-0000-00000000000b', 'whatsapp', '{}', 'wa-a')$$,
  '23505', null, 'the same WhatsApp account id cannot belong to a second tenant'
);
select lives_ok(
  $$insert into public.channel_accounts (tenant_id, channel, config, external_account_id) values ('00000000-0000-0000-0000-00000000000b', 'whatsapp', '{}', 'wa-b')$$,
  'another id is fine'
);

-- One active promise per invoice (the fixture already has one for A's invoice).
select throws_ok(
  $$insert into public.promises (tenant_id, invoice_id, customer_id, promised_on, reference_at) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000001aa', '00000000-0000-0000-0000-0000000000ca', '2031-02-01', now())$$,
  '23505', null, 'a second ACTIVE promise on the same invoice is rejected'
);
select lives_ok(
  $$insert into public.promises (tenant_id, invoice_id, customer_id, promised_on, reference_at, status, resolved_at) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000001aa', '00000000-0000-0000-0000-0000000000ca', '2031-02-01', now(), 'superseded', now())$$,
  'non-active promises may accumulate (history)'
);
select throws_ok(
  $$insert into public.promises (tenant_id, invoice_id, customer_id, promised_on, reference_at, status) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000001aa', '00000000-0000-0000-0000-0000000000ca', '2031-02-01', now(), 'kept')$$,
  '23514', null, 'a resolved promise must carry resolved_at'
);
select throws_ok(
  $$insert into public.promises (tenant_id, invoice_id, customer_id, promised_on, reference_at) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000001bb', '00000000-0000-0000-0000-0000000000ca', '2031-02-01', now())$$,
  '23503', null, 'composite FK: a promise cannot point at another tenant''s invoice'
);

-- tenant_events: append-only.
select throws_ok($$update public.tenant_events set payload = '{"x": 1}' where tenant_id = '00000000-0000-0000-0000-00000000000a'$$, '23514', null, 'tenant_events: no UPDATE');
select throws_ok($$delete from public.tenant_events where tenant_id = '00000000-0000-0000-0000-00000000000a'$$, '23514', null, 'tenant_events: no DELETE');
select throws_ok(
  $$insert into public.tenant_events (tenant_id, customer_id, type, idempotency_key) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000cb', 'ReplyUnmatched', 'x')$$,
  '23503', null, 'composite FK: a tenant event cannot reference another tenant''s customer'
);

-- Tasks: one per dedupe key (exactly-once effects).
select throws_ok(
  $$insert into public.tasks (tenant_id, type, dedupe_key, created_at) values ('00000000-0000-0000-0000-00000000000a', 'human_review', 'fixture', now())$$,
  '23505', null, 'a second task with the same dedupe key is rejected'
);

-- Inbound messages may have no customer (unknown sender); outbound ones may not.
select lives_ok(
  $$insert into public.messages (tenant_id, channel, direction, provider_message_id, sender_ref) values ('00000000-0000-0000-0000-00000000000a', 'email', 'in', '<x@y>', 'stranger@example.com')$$,
  'an inbound message from an unknown sender is stored without a customer'
);
select throws_ok(
  $$insert into public.messages (tenant_id, channel, direction, idempotency_key, send_state) values ('00000000-0000-0000-0000-00000000000a', 'email', 'out', 'k:s1:email', 'pending')$$,
  '23514', null, 'an outbound message needs a customer'
);
select throws_ok(
  $$insert into public.messages (tenant_id, channel, direction, provider_message_id) values ('00000000-0000-0000-0000-00000000000a', 'email', 'in', '<x@y>')$$,
  '23505', null, 'the same provider message id is stored once per tenant and channel'
);

-- store_inbound_event: tenant from the channel account; provider retries dedupe; queued once.
select pgmq.purge_queue('inbound_events');
select isnt(
  private.store_inbound_event((select id from public.channel_accounts where external_account_id = 'wa-a'), 'whatsapp', 'wamid.T1', 'message', '{"id": "wamid.T1"}', null, now()),
  null, 'a new event is stored'
);
select is(
  private.store_inbound_event((select id from public.channel_accounts where external_account_id = 'wa-a'), 'whatsapp', 'wamid.T1', 'message', '{"id": "wamid.T1"}', null, now()),
  null, 'the same provider event id again stores nothing'
);
select is((select count(*)::int from pgmq.q_inbound_events), 1, 'and is queued exactly once');
select is(
  (select tenant_id from public.inbound_events where provider_event_id = 'wamid.T1'),
  '00000000-0000-0000-0000-00000000000a'::uuid, 'the tenant is the channel account''s tenant'
);
select is(
  (select purge_after - received_at from public.inbound_events where provider_event_id = 'wamid.T1'),
  interval '90 days', 'raw events carry purge_after (default 90 days)'
);
select throws_ok(
  $$select private.store_inbound_event('00000000-0000-0000-0000-000000000999', 'whatsapp', 'wamid.T2', 'message', '{}', null, now())$$,
  'P0002', null, 'an unknown channel account stores nothing'
);

-- Queue and storage functions are not callable by any client role.
select ok(
  not has_function_privilege('authenticated', 'private.store_inbound_event(uuid, text, text, text, jsonb, text, timestamptz, interval)', 'execute')
  and not has_function_privilege('anon', 'private.claim_inbound(integer, integer, jsonb)', 'execute')
  and not has_function_privilege('service_role', 'private.purge_inbound(timestamptz)', 'execute'),
  'inbound queue functions: EXECUTE revoked from anon, authenticated and service_role'
);

-- resolve_task / reopen_task: any member, a note is required; non-members cannot.
create function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', u::text, true);
  set local role authenticated;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a3'); -- collector of A
select throws_ok($$select public.resolve_task((select id from public.tasks where tenant_id = '00000000-0000-0000-0000-00000000000a' and dedupe_key = 'fixture'), '')$$,
  '22023', null, 'resolving needs a note');
select is(public.resolve_task((select id from public.tasks where tenant_id = '00000000-0000-0000-0000-00000000000a' and dedupe_key = 'fixture'), 'called the customer'),
  'resolved', 'a collector may resolve a task in their tenant');
select is(public.reopen_task((select id from public.tasks where tenant_id = '00000000-0000-0000-0000-00000000000a' and dedupe_key = 'fixture')),
  'reopened', 'and reopen it');
select throws_ok($$select public.cancel_promise((select id from public.promises where tenant_id = '00000000-0000-0000-0000-00000000000a' and status = 'active'))$$,
  '42501', null, 'a collector may NOT cancel a promise');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1'); -- non-member
select throws_ok($$select private.resolve_task_impl('00000000-0000-0000-0000-000000000000'::uuid, true, 'x', null, now())$$, 'P0002', null, 'unknown task');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1'); -- owner of A
select is(public.cancel_promise((select id from public.promises where tenant_id = '00000000-0000-0000-0000-00000000000a' and status = 'active'), 'customer withdrew'),
  'cancelled', 'an owner may cancel a promise');
reset role;
select is((select count(*)::int from public.invoice_events where type = 'PromiseCancelled' and tenant_id = '00000000-0000-0000-0000-00000000000a'), 1, 'cancelling appends PromiseCancelled');

-- Purge: only past retention, never a pending event.
update public.inbound_events set purge_after = now() - interval '1 day', status = 'processed' where provider_event_id = 'wamid.T1';
update public.inbound_events set purge_after = now() - interval '1 day' where provider_event_id like 'wamid.fixture-%';
select is(private.purge_inbound(now()), 1, 'purge removes processed events past retention, never pending ones');

select * from finish();
rollback;
