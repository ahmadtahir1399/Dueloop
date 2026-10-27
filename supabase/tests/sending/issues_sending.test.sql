-- Prompt 3 issues that live in the database (A, E, F, G, I). Written before migrations 0007/0008.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../fixtures/two_tenants.inc
select plan(12);

-- A. The guide's "write the event as pending, then mark it sent" cannot work: events are immutable.
insert into public.invoice_events (tenant_id, invoice_id, type, idempotency_key)
values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000001aa', 'ReminderSent', 'A-1:s1:email');
select throws_ok($$update public.invoice_events set payload = '{"state": "sent"}' where idempotency_key = 'A-1:s1:email'$$,
  '23514', null, 'A: an event can never move from pending to sent (append-only), so the outbox must be messages');
-- A. Resolution: the mutable outbox row is messages, one row per key.
select has_column('public', 'messages', 'send_state', 'A: messages carries send_state');
select has_column('public', 'messages', 'attempt', 'A: messages carries attempt');
select has_column('public', 'messages', 'pending_since', 'A: messages records when it became pending');

-- E. Approvals are unique per idempotency key.
select has_table('public', 'approvals', 'E: approvals table exists');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'approvals'
                  and indexdef ilike '%unique%tenant_id%idempotency_key%'), 'E: approvals unique per (tenant, key)');

-- G. enqueue takes an injectable as_of.
select has_function('private', 'enqueue_due_actions', array['integer', 'timestamp with time zone'], 'G: enqueue_due_actions(batch, as_of)');

-- F. A global kill switch exists outside the exposed schemas.
select has_table('private', 'system_flags', 'F: private.system_flags exists');

-- I. Consent has storage.
select has_table('public', 'customer_consents', 'I: customer_consents exists');

-- Secrets and dead letters
select has_table('public', 'channel_accounts', 'channel_accounts exists');
select has_table('public', 'dead_letters', 'dead_letters exists');
select has_table('public', 'templates', 'templates exists');

select * from finish();
rollback;
