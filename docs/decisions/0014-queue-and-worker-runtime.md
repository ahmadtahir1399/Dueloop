# 0014: Queue (pgmq + pg_cron) and a Node worker instead of an Edge Function

**Context.** The guide suggests a Supabase Edge Function on a cron. The send protocol needs long-lived
connections, a hard per-send timeout, SMTP (raw TCP) and a process we can crash-test.

**Decision.**
- Queue: pgmq 1.5.1 (`followup_actions`). The producer, `private.enqueue_due_actions`, selects due,
  unpaused, open/overdue/promised/escalated invoices with `skip locked`, and re-enqueues only when
  `enqueued_at` is older than 15 minutes.
- Wake-ups: pg_cron jobs call `private.cron_tick` (enqueue every minute, stale sweep every 5 minutes,
  approval expiry hourly). The ticks are gated by `private.system_flags('cron_enabled')`, so tests own the
  clock.
- Consumer: a Node 24 process (`pnpm worker --once|--loop`) that connects straight to Postgres as a
  trusted role. Queue functions are revoked from `anon`, `authenticated` and `service_role`.

**Consequences.** This deviates from the guide: the worker is a Node process, not an Edge Function, so it
needs a host (a small VM or container). `WORKER_DATABASE_URL` is required outside the local stack. The
worker never reads `DATABASE_URL`, so it cannot send from the hosted project by accident.
