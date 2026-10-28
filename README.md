# Dueloop: invoice follow-up agent

Status: **Phase 4 of 7**: the pure domain core and simulator (phase 1); the database, RLS and CSV import
(phase 2); scheduler and sending (phase 3); and replies + promises (phase 4): a signed WhatsApp webhook, a
read-only IMAP poller, an inbound processor whose AI classifier can only propose, human tasks, promise
tracking and reply-aware reminder gates. Payments, the dashboard/pay page and packaging come later.

## What is here

- `packages/core`: domain types, the invoice state machine, `decide()`, the send-window calculation, money
  helpers and port interfaces. Pure; may import only `luxon` (lint-enforced).
- `packages/sim`: deterministic simulator with an invariant checker.
- `packages/db`: generated database types, pure row -> core mappers, `rls-check` and `db-types` scripts.
- `packages/ingest`: CSV validation (pure), staging and commit through the database, and the import CLI.
- `packages/messaging`: template rendering (fail-closed), footer, header sanitising, budget, router, pacing,
  and the `OutboundChannel` contract (ADR 0019).
- `packages/worker`: the send protocol (ADR 0013), the composition root, and the ops CLIs.
- `packages/adapters-email`, `adapters-whatsapp`, `adapters-notify`: SMTP (nodemailer), WhatsApp Cloud API
  templates, and Slack alerts, each with contract tests; `adapters-email` also has the read-only IMAP poller.
- `packages/classifier`: the ReplyClassifier boundary, strict schema, toProposal, versioned prompts, the Claude
  adapter and the evaluation harness (data in `data/classifier`).
- `packages/inbound`: the inbound processor (normalise, pre-filter, match, classify, plan, apply).
- `packages/webhooks`: the WhatsApp webhook endpoint (raw-body signature check).
- `supabase/`: migrations, the demo seed, and pgTAP tests.
- `docs/decisions`: architecture decision records.

- `apps/web`: Next.js 16 + shadcn/ui web app. It covers sign in and sign up, creating a business, a
  dashboard with ageing buckets, invoices with a timeline, customers, and the CSV import wizard (mapping,
  dry-run preview, commit, error report). It runs as the signed-in user under RLS and never uses the
  service-role key.

## Web app

```bash
pnpm dev
```

- The app reads the repo-root `.env` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`), so
  by default it talks to the hosted project. Variables already set in your shell win, which is how to point
  it at the local stack instead (values from `pnpm exec supabase status -o env`: `API_URL` and
  `PUBLISHABLE_KEY`).
- On the hosted project, sign-up sends a confirmation email. Add `http://localhost:3000/auth/confirm` to
  Authentication -> URL Configuration -> Redirect URLs in the Supabase dashboard so the link comes back
  to the app.

## Requirements

- Node.js >= 24.12 (`.nvmrc`) and pnpm (pinned in `package.json` `packageManager`).
- Docker, running. The Supabase CLI is a dev dependency, so `pnpm exec supabase` is always the pinned
  version.

## Commands

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm sim --days 90 --invoices 500 --seed 42
```

Local database:

```bash
pnpm db:start
pnpm db:reset
pnpm db:test
pnpm db:rls-check
pnpm db:types:check
```

- `pnpm db:start` starts the stack (Postgres, Auth, PostgREST) and applies migrations and seed.
- `pnpm db:reset` re-applies every migration and the seed from empty.
- `pnpm db:test` runs the pgTAP suite, then the integration tests against the real database.
- `pnpm db:rls-check` fails if any public table lacks RLS.
- `pnpm db:types:check` fails if `packages/db/src/database.types.ts` is stale (`pnpm db:types` regenerates it).

The demo seed creates "Demo Agency" (40 invoices, 12 overdue) with tenant id
`5eed0000-0000-4000-8000-00000000000a`, and an isolated second tenant.

## Importing invoices

The CLI uses the service role and reads it from the environment only. Export the local values first (they
are printed by `supabase status`; never commit them):

```bash
eval "$(pnpm exec supabase status -o env | grep -E '^(API_URL|SERVICE_ROLE_KEY)=' | sed -E 's/^API_URL=/export SUPABASE_URL=/; s/^SERVICE_ROLE_KEY=/export SUPABASE_SERVICE_ROLE_KEY=/')"
```

```bash
pnpm run import --tenant 5eed0000-0000-4000-8000-00000000000a --file packages/ingest/fixtures/messy-eu.csv --mapping packages/ingest/fixtures/mappings/eu.json --options packages/ingest/fixtures/options/de-dmy.json --skip-invalid --dry-run
```

- Use `pnpm run import`, not `pnpm import`: `import` is a built-in pnpm command.
- Drop `--dry-run` to commit. Add `--error-report out.csv` for a spreadsheet-safe report of every row with
  errors or warnings.
- `pnpm import:twice <same args>` imports twice and fails unless the second run changes nothing.
- Mapping and options formats are in `packages/ingest/src/types.ts`; see the files in
  `packages/ingest/fixtures/mappings` and `options`.

## Sending (phase 3)

```bash
pnpm worker --once                       # one pass: enqueue due work, sweep, drain the queue
pnpm worker --loop                       # keep running (SIGINT/SIGTERM stop it cleanly)
pnpm approvals list --tenant "Demo Agency"
pnpm approvals approve --all-pending --tenant "Demo Agency"
pnpm approvals reject <id> --note "..."
pnpm messages unknown                    # messages that may or may not have been sent
pnpm messages resolve <id> --as sent     # or --as not_sent, after checking with the provider
pnpm messages unpark <invoiceId>
pnpm tenant pause "Demo Agency"          # or: pnpm tenant pause --global
pnpm demo:send                           # the whole walkthrough against the local Mailpit
pnpm chaos                               # crash at every step + SIGKILL mid-batch
pnpm test:load                           # 5,000 invoices (slow, not in CI)
```

- The worker connects to `WORKER_DATABASE_URL`, or the local stack when it is unset. It never reads
  `DATABASE_URL` (the hosted project).
- Email goes through the operator relay `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER`. The password
  is a Vault secret (`private.set_channel_secret(tenant, 'email', ...)`). Locally, `pnpm demo:send` uses
  Mailpit (SMTP 54325, web UI http://127.0.0.1:54324).
- WhatsApp is wired only when `WHATSAPP_GRAPH_VERSION` is set (ADR 0020). The token is a Vault secret.
- A message in an unknown state is never resent automatically (rule 17). See `docs/decisions/0013`–`0021`.
- Deliverability: before sending from a real domain, the tenant's domain needs SPF, DKIM and DMARC records
  that cover the SMTP relay, otherwise reminders land in spam or are rejected. The opt-out is an instruction
  in the footer ("reply STOP"); a one-click unsubscribe link comes in phase 6.
- Default reminder wording is polite and factual and is checked against a banned-wording list. It is **not
  legal advice**: debt-collection messaging rules differ by market, and each market needs its own review.

## Replies and promises (phase 4)

```bash
pnpm webhooks                            # WhatsApp webhook (WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN)
pnpm inbound --once                      # process stored inbound events (or --loop)
pnpm tasks list --tenant "Demo Agency"   # human tasks; show <id>, resolve <id> --note "...", reopen <id>
pnpm promises list --tenant "Demo Agency"
pnpm demo:replies                        # the whole walkthrough (after pnpm db:reset)
pnpm test:adversarial                    # injection, spoofing and webhook abuse
pnpm classifier:eval                     # replay recorded classifier outputs; fails on regression
pnpm eval:live                           # record a real model (EVAL_LIVE=1, CLASSIFIER_MODEL; costs money)
```

- The classifier only proposes; `planReplyOutcome` and the state machine decide, and nothing from a reply can
  send a message. Every unclear, low-confidence, spoofable or ambiguous reply becomes a human task with, where
  useful, a DRAFT reply for a person to send.
- Classifier: `CLASSIFIER=anthropic` with `CLASSIFIER_MODEL` (recommended `claude-opus-5-5`) and Anthropic
  credentials. Without it, every reply goes to a human.
- The labelled set in `data/classifier` is SYNTHETIC: a regression guard, not a measure of real-world accuracy.
- Live Meta webhook delivery needs a public HTTPS URL in front of `pnpm webhooks`; real mailboxes need app
  passwords. See `docs/decisions/0022`-`0031`.
