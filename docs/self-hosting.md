# Self-hosting

> **Real-host deployment is NOT VERIFIED.** Everything below was run on one Windows 10 machine with Docker Desktop
> (Engine 29.8.0) against the local Supabase CLI stack (`pnpm images:smoke`). Nothing here has been run on a
> server, behind a real TLS proxy or against a hosted Supabase project.

## What runs where

| Service | Image (`Dockerfile` target) | Command | Health |
|---|---|---|---|
| web (dashboard, public pay/opt-out pages, REST API) | `web` | `node apps/web/server.js` (Next.js standalone) | `GET /health`, `GET /ready` |
| webhooks (WhatsApp, payment providers) | `services` | `node packages/webhooks/src/bin/webhooks.ts` | `GET /health`, `GET /ready` |
| worker (reminders, payments processing, receipts, proofs) | `services` | `node packages/worker/src/bin/worker.ts --loop` | own heartbeat (`ops alive`) |
| processor (inbound replies) | `services` | `node packages/worker/src/bin/inbound.ts --loop` | own heartbeat |
| Supabase (Postgres, Auth, Storage, PostgREST) | not ours | local CLI stack or a hosted project | `pnpm doctor` |

One `services` image serves three commands, so the worker, processor and webhooks always run the same build. Both
images: multi-stage, non-root (`node`, uid 1000), base pinned by tag and digest (bump procedure in the `Dockerfile`
header), no tests, fixtures, demo code, seed data or env files (`.dockerignore`; scanned by `pnpm images:smoke`).

## Prerequisites

- Docker Engine with Compose v2 (the `extra_hosts` list form needs Compose 2.24.1 or later per the Compose docs).
- A Supabase project with these extensions: `pgmq` (Supabase Queues, documented at
  https://supabase.com/docs/guides/queues/pgmq), `pg_cron` (Supabase Cron, https://supabase.com/docs/guides/cron),
  `supabase_vault`, `pgcrypto`. Availability on your plan: check those pages; NOT VERIFIED here.
- SMTP for email; optionally WhatsApp Cloud API, Stripe, an Anthropic API key (each is opt-in; see
  docs/data-handling.md for what is sent where).

## Build

```bash
pnpm images:build
```

The web image inlines `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `NEXT_PUBLIC_APP_URL` at
build time (Next.js behaviour), so build it once per environment with those set in the shell. They are public
values. Secrets are never build arguments: they are runtime environment only. Images are never pushed by any script
in this repository.

## Configure

Every variable, which service needs it and whether it is secret: [env-reference.md](env-reference.md) (generated
from the schema; `.env.example` is the same list). Each service validates its own variables at start and stops with
the NAMES of what is missing (`pnpm doctor --service <name>` shows the same without starting anything).

Put the runtime values in a file outside the repository (for example `/etc/dueloop/selfhost.env`, readable only by
the deploy user) and start:

```bash
DUELOOP_ENV_FILE=/etc/dueloop/selfhost.env docker compose -f compose.selfhost.yml up -d
```

`compose.selfhost.yml` runs every service with a read-only root filesystem, all capabilities dropped and
`no-new-privileges`. It does not start Supabase.

## TLS, the reverse proxy and client IPs

- Terminate TLS at a reverse proxy in front of `web` (port 3000 in the container) and `webhooks` (8787).
  `PUBLIC_APP_URL` must be the https origin users see: pay and opt-out links, the CSRF origin check and the
  List-Unsubscribe header (https only) are built from it.
- Rate limits key on the client IP. Set `TRUST_PROXY_HOPS` to the number of proxies you control in front of the app
  (ADR 0047). `0` (default) ignores `X-Forwarded-For` entirely; a wrong, too-high value lets clients choose their own
  IP and defeat the limits.
- Public pages send `Referrer-Policy: no-referrer` and `Cache-Control: no-store`; do not let the proxy cache them.

## Webhook URLs

- WhatsApp: `https://<webhooks host>/webhooks/whatsapp` with `WHATSAPP_APP_SECRET` and `WHATSAPP_VERIFY_TOKEN`.
- Payments: `https://<webhooks host>/webhooks/payments/<opaque account token>` with `PAYMENTS_WEBHOOKS=true`. The token
  only finds the payment account; every delivery is verified with that account's signing secret over the raw body
  (rule 23). The URL is shown once when created or rotated (Settings > Integrations, "Rotate the webhook URL"); only a hash is stored.
- The webhooks service refuses to start when neither source is configured.

## Hosted Supabase checklist

| Item | Status |
|---|---|
| Extensions `pgmq`, `pg_cron` enabled before `supabase db push` | documented by Supabase (links above); NOT VERIFIED on a real project |
| `supabase_vault` available; channel/payment secrets stored there | NOT VERIFIED on a real project |
| Migrations applied with `supabase db push --dry-run`, then `supabase db push` | flags checked in CLI 2.122.0 help; NOT VERIFIED against a hosted project |
| Auth: site URL and redirect URLs set to `PUBLIC_APP_URL` | NOT VERIFIED |
| Auth: sign-up policy (open or invite-only) decided by the operator | DECISION for the operator; NOT VERIFIED |
| Storage bucket `payment-proofs` exists and is private (created by migration 0012) | verified locally only |
| The service-role key is only in the server env file (never `NEXT_PUBLIC_`, never a build arg) | enforced by `pnpm repo:audit`, the security suite and the image scans |
| Supabase notes that revoking privileges on Vault, pg_cron and extension objects from `service_role` has no effect (KB: "Revoking privileges on Storage, pg_cron, Vault, and extension objects has no effect"): the service-role key can read every secret | residual risk, see docs/threat-model.md |
| Backups: the platform's own backups and their retention | NOT VERIFIED; the logical backup procedure in docs/runbook.md was drilled locally |

## Upgrades

Forward-only migrations, backup first, schema guard on every service: docs/runbook.md "Upgrades".

## Uptime monitoring targets

- `GET https://<web>/ready` and `GET https://<webhooks>/ready`: 200 = database reachable and schema version as
  expected.
- `pnpm ops:watchdog` exit code from the host scheduler every 5 minutes (stale worker/processor heartbeats, queue age,
  unknown messages, dead letters, unprocessed events).
