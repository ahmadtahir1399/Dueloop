# Runbook

The technical half is complete and every command below exists in this repository. The support half (who is on
call, hours, escalation) is the operator's business data and is left as `TODO(...)` placeholders on purpose.
Hosted-platform behaviour is NOT VERIFIED unless a line says otherwise.

## Support (operator to fill in)

| Item | Value |
|---|---|
| Who receives alerts | TODO(on-call): name / rota |
| Support hours | TODO(support-hours) |
| Response targets | TODO(response-targets): none are promised by this project |
| Escalation path | TODO(escalation) |
| Security reports | see SECURITY.md (contact is TODO(security-contact)) |
| Uptime monitor | TODO(monitoring-hookup): the targets are listed under "Health" below |

## Health

| Check | What it tells you | Command / URL |
|---|---|---|
| Liveness | the process is up (no database call) | `GET /health` on web and webhooks |
| Readiness | database reachable and schema version as expected | `GET /ready` on web and webhooks (503 otherwise, names only) |
| Everything at once | queue depth/age, due-but-not-queued, parked, unknown messages, dead letters (24 h), approvals, unprocessed inbound/payment events, pauses, heartbeats, schema version | `pnpm ops:status` |
| Alerts | thresholds + stale heartbeats; one alert per finding per hour; exit 1 on critical | `pnpm ops:watchdog` |
| Configuration | env (names only), schema version, connectivity | `pnpm doctor [--service web\|worker\|webhooks\|processor]` |

Run the watchdog from the host scheduler every 5 minutes, e.g. a crontab line
`*/5 * * * * cd /srv/dueloop && pnpm ops:watchdog` (or a Windows Task Scheduler task). Its exit code is the signal
an uptime monitor can page on. Thresholds are `DEFAULT_THRESHOLDS` in `packages/ops/src/index.ts`.

## Stop sending now (kill switch)

- All tenants: `pnpm tenant pause --global` (or Settings in the dashboard, owners only). Resume: `pnpm tenant resume --global`.
- One tenant: `pnpm tenant pause <id|name>`.
- The switch is checked immediately before every send (rule 18): it takes effect mid-batch. Nothing new is queued
  while the global switch is on.

## Common situations

| Symptom (from ops:status / watchdog) | Meaning | What to do |
|---|---|---|
| `heartbeat:worker` critical | the worker stopped | restart it; `pnpm doctor --service worker` explains a refusal to start (e.g. schema version) |
| `unknown_messages` > 0 | a send's outcome is unknown; the invoice is parked (rule 17) | check the provider, then `pnpm messages resolve <messageId> --as sent\|not_sent`; never resend by hand first |
| `dead_letters` | a job failed repeatedly | read the reason in the dead letter (ids/codes only); fix the cause; `pnpm messages unpark <invoiceId>` |
| `unprocessed_payment_events` | confirmations are waiting | is `pnpm payments process --loop` (or the worker) running? |
| `unprocessed_inbound` | replies are waiting | is `pnpm inbound --loop` running? |
| integrity finding | received != applied + credit somewhere | `pnpm payments:integrity`; do not edit ledger rows; open an issue with the ids |

## Backup

Verified locally by `pnpm backup:drill` (it backs up the local stack, restores into a fresh second local stack and
compares; report in `.demo/backup-drill/report.json`). Procedure from the Supabase docs
(https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) plus one addition this
project needs:

```bash
supabase db dump --db-url "$DB_URL" -f roles.sql --role-only
supabase db dump --db-url "$DB_URL" -f schema.sql
supabase db dump --db-url "$DB_URL" -f data.sql --use-copy --data-only -x "storage.buckets_vectors" -x "storage.vector_indexes"
supabase db dump --db-url "$DB_URL" -f migrations-schema.sql --schema supabase_migrations
supabase db dump --db-url "$DB_URL" -f migrations-data.sql --use-copy --data-only --schema supabase_migrations
```

The last two are ours: the default schema dump leaves out `supabase_migrations`, and without that history every
service refuses to start (schema-version guard, rule 45). Backups contain customer data: store them encrypted, with
access limited like the database itself. Hosted-plan backup features and their retention: NOT VERIFIED here.

## Restore

```bash
psql --single-transaction --variable ON_ERROR_STOP=1 --file roles.sql --file schema.sql --command 'SET session_replication_role = replica' --file data.sql --dbname "$NEW_DB_URL"
psql --single-transaction --variable ON_ERROR_STOP=1 --file migrations-schema.sql --file migrations-data.sql --file packages/ops/sql/post-restore.sql --dbname "$NEW_DB_URL"
```

What the drill observed (local stack, Supabase CLI 2.122.0, Postgres image 17.11.0.006):

| Item | After the documented procedure | After our two extra steps |
|---|---|---|
| Table data (39 tables in `public`, `private`) | identical (row counts and checksums) | identical |
| Migration history | missing: services refuse to start | complete; guard accepts |
| pgmq queues (5) | missing | recreated by `post-restore.sql` |
| pg_cron jobs (5) | missing | recreated by `post-restore.sql` |
| Ledger integrity | clean | clean |
| Vault secrets (channel and payment credentials) | **not in the dump at all** | not restored |
| Storage files (payment proofs) | object rows restored, **files missing** | files missing |
| Messages that were waiting on a queue | lost | reminders re-derive from `next_action_at`; pending inbound and payment events are re-queued; unsent receipts and unfetched proofs are NOT |

So after a restore an operator must also:
1. Re-enter every channel and payment credential (Settings > Integrations), or, on a hosted project, follow the
   Supabase docs for moving the Vault root key (NOT VERIFIED here; the drill saw no Vault rows in the dump at all).
2. Copy Storage objects separately (the Supabase docs describe a script using the service key; not implemented or
   verified in this repo). Until then proof files of restored rows cannot be opened.
3. Check `pnpm ops:status` and `pnpm payments:integrity`, and look for receipts not yet sent.

## Upgrades (forward-only)

1. Take a backup (above) and keep it until the new version has run for a while.
2. Apply new migrations: locally `supabase migration up` / `supabase db reset`; hosted `supabase db push --dry-run`
   first, then `supabase db push` (flags checked against CLI 2.122.0 help; hosted behaviour NOT VERIFIED).
3. Deploy the build whose `EXPECTED_SCHEMA_VERSION` (packages/ops) equals the newest migration. A service started
   against a different schema refuses to start and prints both versions (rule 45).

Rollback stance: migrations are never edited once committed and there are no down migrations. Rolling back means
restoring the pre-upgrade backup AND deploying the previous build; the guard makes a half-rollback (old build, new
schema or the reverse) fail loudly instead of running.

## Data lifecycle

- Retention: `pnpm retention:run` daily from the host scheduler (periods in ADR 0051; they are defaults, not legal
  advice: TODO(retention-policy) for the operator).
- Subject access: `pnpm customer export --tenant <id> --customer <id> --out file.json`.
- Erasure: `pnpm customer erase --tenant <id> --customer <id> --yes --user <who>`. Refused while the customer has
  open invoices; re-runnable; the ledger is kept and stays balanced; the contact stays suppressed.
