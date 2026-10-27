-- Queue SQL with an injected clock (issue G), pause flags (F), sweeps and approval expiry (E),
-- approval RPC permissions, and secrets. All rolled back.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../fixtures/rls_world.inc
select plan(31);

-- Isolate this test from cron and from other jobs.
update private.system_flags set enabled = false where key = 'cron_enabled';
select pgmq.purge_queue('followup_actions');

-- Only the two fixture tenants take part (seed data is parked for this transaction).
update public.invoices set next_action_at = 'infinity'
where tenant_id not in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b');

-- Fixed clock: A-1 and B-1 are due at 2026-03-01 10:00Z.
update public.invoices set next_action_at = '2026-03-01 10:00Z', enqueued_at = null
where tenant_id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b');

-- Every queue function is out of reach of API roles.
select ok(not has_function_privilege(r, f, 'execute'), format('%s cannot execute %s', r, f))
from unnest(array['anon', 'authenticated', 'service_role']) r,
     unnest(array['private.enqueue_due_actions(integer, timestamptz)', 'private.claim_actions(integer, integer, jsonb)',
                  'private.sweep_stale_messages(interval, timestamptz)', 'private.channel_secret(uuid, text)']) f;

select is(private.enqueue_due_actions(100, '2026-03-01 09:59Z'), 0, 'G: not due one minute early');
select is(private.enqueue_due_actions(100, '2026-03-01 10:00Z'), 2, 'G: both tenants'' invoices due at as_of');
select is(private.enqueue_due_actions(100, '2026-03-01 10:05Z'), 0, 'no re-enqueue while the job is fresh');
select is(private.enqueue_due_actions(100, '2026-03-01 10:16Z'), 2, 're-enqueued only after the 15 minute stale period');

select pgmq.purge_queue('followup_actions');
update public.invoices set enqueued_at = null;
update public.tenants set outbound_paused = true where id = '00000000-0000-0000-0000-00000000000b';
select is(private.enqueue_due_actions(100, '2026-03-01 11:00Z'), 1, 'paused tenant is not enqueued');
update private.system_flags set enabled = true where key = 'outbound_paused';
update public.invoices set enqueued_at = null;
select is(private.enqueue_due_actions(100, '2026-03-01 12:00Z'), 0, 'F: global kill switch stops enqueue');
update private.system_flags set enabled = false where key = 'outbound_paused';
update public.tenants set outbound_paused = false;

update public.invoices set enqueued_at = null where tenant_id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b');
update public.invoices set status = 'paid' where number = 'B-1';
select is(private.enqueue_due_actions(100, '2026-03-01 13:00Z'), 1, 'final invoices are never enqueued');
select pgmq.purge_queue('followup_actions');
update public.invoices set next_action_at = 'infinity', parked_reason = 'template_missing', enqueued_at = null
where tenant_id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b');
select is(private.enqueue_due_actions(100, '2026-03-01 14:00Z'), 0, 'parked invoices (infinity) are never enqueued');
select ok(private.unpark_invoice('00000000-0000-0000-0000-0000000001aa', '2026-03-01 15:00Z'), 'operator un-parks an invoice');
select is(private.enqueue_due_actions(100, '2026-03-01 15:00Z'), 1, 'un-parked invoice is due again');

-- Claim / release / ack.
select is((select count(*)::int from private.claim_actions(10, 30, '{"tenant_id": "00000000-0000-0000-0000-00000000000a"}')), 1, 'claim with a tenant filter');
select is((select count(*)::int from private.claim_actions(10, 30, '{}')), 0, 'a claimed job is invisible to other workers');

-- Stale sweep: pending older than the threshold -> unknown + event + parked (never resent).
insert into public.messages (id, tenant_id, customer_id, channel, direction, idempotency_key, send_state, pending_since)
values ('00000000-0000-0000-0000-0000000005aa', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000ca',
        'email', 'out', 'A-1:s9:email', 'pending', '2026-03-01 10:00Z');
insert into public.message_invoices (tenant_id, message_id, invoice_id)
values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000005aa', '00000000-0000-0000-0000-0000000001aa');
select is((select count(*)::int from private.sweep_stale_messages('15 minutes', '2026-03-01 10:10Z')), 0, 'fresh pending is left alone');
select is((select count(*)::int from private.sweep_stale_messages('15 minutes', '2026-03-01 10:20Z')), 1, 'stale pending is swept');
select is((select send_state from public.messages where id = '00000000-0000-0000-0000-0000000005aa'), 'unknown', 'swept message is unknown');
select is((select parked_reason from public.invoices where number = 'A-1'), 'message_unknown', 'its invoice is parked for a human');

-- Approval expiry returns the invoice to decide().
insert into public.approvals (tenant_id, invoice_id, idempotency_key, step_id, channel, requested_at)
values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000001aa', 'A-1:s1:email', 's1', 'email', '2026-03-01 10:00Z');
select is(private.expire_approvals('7 days', '2026-03-05 10:00Z'), 0, 'not expired after 4 days');
select is(private.expire_approvals('7 days', '2026-03-09 10:00Z'), 1, 'expired after 7 days');
select is((select next_action_at from public.invoices where number = 'A-1'), '2026-03-09 10:00Z'::timestamptz, 'expired approval re-enters decide');

select * from finish();
rollback;
