-- Run ONCE after restoring a logical dump (docs/runbook.md "Restore"). A dump does not carry pgmq queues (extension-
-- owned tables) or pg_cron jobs; this recreates them exactly as the migrations did, and re-queues work whose queue
-- message was lost. A unit test keeps the queue and job lists equal to the migrations (packages/ops/test).
-- It never sends anything: jobs only go back on queues, and every send still passes the outbox (rule 17).

-- Queues (migrations 0008, 0009, 0012, 0016).
select pgmq.create('followup_actions');
select pgmq.create('inbound_events');
select pgmq.create('payment_events');
select pgmq.create('transactional_sends');
select pgmq.create('proof_fetch');

-- Scheduled jobs (cron.schedule with an existing name updates that job).
select cron.schedule('dueloop-enqueue', '* * * * *', $$select private.cron_tick('enqueue')$$);
select cron.schedule('dueloop-sweep', '*/5 * * * *', $$select private.cron_tick('sweep')$$);
select cron.schedule('dueloop-expire-approvals', '17 * * * *', $$select private.cron_tick('expire')$$);
select cron.schedule('dueloop-purge-inbound', '23 3 * * *', $$select private.purge_inbound(now()) where private.flag('cron_enabled')$$);
select cron.schedule('dueloop-purge-payment-events', '41 3 * * *', $$select private.purge_payment_events(now()) where private.flag('cron_enabled')$$);

-- Lost queue messages. Reminder jobs are derived again from next_action_at by the enqueue job; clearing the stamp
-- lets that happen on the next tick instead of after the 15-minute re-enqueue window.
update public.invoices set enqueued_at = null where enqueued_at is not null;
-- Pending inbound and payment events go back on their queues in the shape the ingest functions use.
select pgmq.send('inbound_events', jsonb_build_object('event_id', id, 'tenant_id', tenant_id)) from public.inbound_events where status = 'pending';
select pgmq.send('payment_events', jsonb_build_object('event_id', id, 'tenant_id', tenant_id)) from public.payment_events where status = 'pending';
-- NOT re-queued here (reported by `pnpm doctor` / `pnpm ops:status` and in the runbook): unsent receipts
-- (transactional_sends) and unfetched proof attachments (proof_fetch).
