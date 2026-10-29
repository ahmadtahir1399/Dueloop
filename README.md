# Dueloop: invoice follow-up agent

Status: **Phase 5 of 7**: the pure domain core and simulator (phase 1); the database, RLS and CSV import
(phase 2); scheduler and sending (phase 3); replies + promises (phase 4); and payments + reconciliation
(phase 5): a money-in ledger (receipts = applied payments + credits, append-only), one confirmation pipeline
for gateway webhooks, polling, manual bank transfers and confirmed proofs, payment links in reminders,
receipts through the outbox, refunds and chargebacks as human tasks, a proof-of-payment inbox, and KPI views.
The dashboard/pay page and packaging come later.

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
- `packages/webhooks`: the webhook runtime: WhatsApp, and payments at `/webhooks/payments/<opaque token>`
  (raw-body signature check with that account's secret).
- `packages/payments`: the payment confirmation pipeline (ADR 0034): ingest, resolve via our own payment
  requests, plan (pure core), apply in one locked transaction, alerts; requests and links, polling, manual
  recording, read-only reconcile, integrity.
- `packages/adapters-payments`: bank transfer, a deterministic FakeGateway, and Stripe (payment links on the
  client's own account, API version pinned, ADR 0037).
- `packages/proofs`: the proof inbox: fetch, magic-byte validation, private storage, duplicates, optional AI
  hints (off by default), and the human confirm / reject workflow.
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

## Payments and proofs (phase 5)

```bash
pnpm payments record --tenant "Demo Agency" --invoice DA-0003 --amount 250.00 --date 2026-10-28 \
  --bank-ref BANK-123 --user owner@demo-agency.test            # prints the plan; add --yes to record it
pnpm payments process --once                                    # payment events, request sweep, polling
pnpm payments reconcile --tenant "Demo Agency" --from 2026-10-01 --to 2026-10-31   # READ-ONLY
pnpm payments:integrity                                         # ledger invariants; exit 1 on any finding
pnpm proofs list | show <id> | confirm <id> --amount --date --bank-ref --user [--yes] | reject <id> --reason --user
pnpm demo:payments                                              # the whole walkthrough (after pnpm db:reset)
pnpm smoke:stripe                                               # Stripe SANDBOX round trip (STRIPE_SMOKE=1, STRIPE_TEST_API_KEY)
pnpm eval:proof-live                                            # proof hints on SYNTHETIC images (PROOF_EVAL=1; costs money)
```

- Money is confirmed only by a verified provider signal or by an owner/accountant who types the amount, date
  and bank reference (rule 27). Redirects, replies, screenshots and model output never confirm money.
- Every receipt balances: received = applied + credit (rule 28). The ledger is append-only; refunds and
  chargebacks become urgent tasks and never reopen an invoice.
- Stripe runs on the client's OWN account with a restricted key and a webhook signing secret, both in Vault.
  The webhook URL is `/webhooks/payments/<opaque token>`; the token only finds the account. Card data never
  passes through Dueloop (Stripe hosts the payment page). No compliance claims are made here.
- Proof files are PII and stay in a private bucket. AI extraction of hints is OFF by default per tenant
  (`tenants.proof_ai_extraction`). It sends the image to a third-party model, and its output is an untrusted
  hint that never confirms anything. See `docs/decisions/0032`-`0041`.

## Licence

TODO(licence): no licence has been chosen yet, so no LICENSE file is included and no rights are granted.
The owner decides (see the prompt 7 report, "Decisions needed").
