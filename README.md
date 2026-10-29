# invoice-followup-agent

Working name, TODO(project-name): the owner has not chosen a name; no trademark check has been done. Packages use the
code name `dueloop`.

Software that follows up unpaid invoices for a small business: it sends polite reminders by email or WhatsApp on a
schedule the business controls, reads the replies, records promises and disputes, takes payments through the
business's own payment account and keeps a ledger of money received. A human approves what the system proposes;
the system never decides that money arrived because a customer said so.

**Status:** all seven build phases are done in this repository. It has run only on one developer machine and in local
containers. It has not run on a real server, against a hosted Supabase project or with live providers (see
[docs/limitations.md](docs/limitations.md)). There is no licence yet (below).

## Quickstart (local demo, synthetic data)

Needs Node 24 (`.nvmrc`), pnpm via corepack, and Docker running.

```bash verified
pnpm install --frozen-lockfile
pnpm demo --non-interactive
pnpm demo:selftest
pnpm demo:stop
```

`pnpm demo` without `--non-interactive` prints the dashboard URL, per-run logins and the guided script
([docs/demo-script.md](docs/demo-script.md)).

Demo video: TODO(video-url), to be hosted by the owner. `pnpm demo:record` records the automated demo with synthetic
data into `.demo/recording/` (never committed) and leak-checks the page text it showed; a person must watch the
video before it is shared.

## What is built

The original build guide's feature catalogue is not in this repository, so this table lists what prompts 1-7 built,
each with the test or document that backs it.

| Area | Status | Backed by |
|---|---|---|
| Pure domain core (state machine, decide(), money, send windows) and simulator | built | `packages/core/test`, `pnpm sim` |
| CSV import (mapping, dry run, error report, idempotent commit) | built | `packages/ingest/test*`, e2e `import-export.spec.ts` |
| Multi-tenant database, RLS, role matrix (owner, accountant, collector) | built | `pnpm db:test`, `pnpm db:rls-check`, `pnpm db:catalog-audit`, ADR 0042 |
| Email reminders (SMTP), approvals, kill switch, quiet hours, budgets | built | `packages/worker/test-db`, `pnpm chaos`, `pnpm demo:send` |
| WhatsApp reminders (approved templates) | built; live NOT VERIFIED | adapter contract tests; `pnpm smoke:whatsapp` needs credentials |
| SMS reminders | not built | - |
| Replies: IMAP poller, WhatsApp inbound, classification, promises, disputes, tasks | built; live model NOT VERIFIED | `packages/inbound/test*`, `pnpm test:adversarial`, `pnpm demo:replies` |
| Payments: payment links (Stripe, FakeGateway), bank transfers, proofs, receipts, ledger, reconciliation | built; live Stripe NOT VERIFIED | `packages/worker/test-db/payments*`, `pnpm payments:integrity`, `pnpm demo:payments` |
| Staff dashboard, public pay and opt-out pages, REST API | built | e2e suites (`pnpm web:test:e2e`, `pnpm web:test:security`, `pnpm e2e:demo`), [docs/api.md](docs/api.md) |
| Operations: health/ready, schema guard, heartbeats, watchdog, retention, erasure, backup drill | built | `packages/ops/test*`, `pnpm backup:drill`, [docs/runbook.md](docs/runbook.md) |
| Containers and self-hosting | built; real host NOT VERIFIED | `pnpm images:smoke`, [docs/self-hosting.md](docs/self-hosting.md) |
| One-command demo | built | `pnpm demo:selftest`, `.github/workflows/clean-clone.yml` (not yet run) |
| Pilot measurement (KPI snapshots and report) | built | `pnpm pilot:snapshot`, `pnpm pilot:report`, [docs/pilot-playbook.md](docs/pilot-playbook.md) |
| Dashboard translations / right-to-left, white-label, billing, hosted service | not built (out of scope) | - |

## Documentation

[Architecture](docs/architecture.md) · [Self-hosting](docs/self-hosting.md) · [Environment](docs/env-reference.md) ·
[Runbook](docs/runbook.md) · [Data handling](docs/data-handling.md) · [Security review](docs/security-review.md) ·
[Threat model](docs/threat-model.md) · [Limitations](docs/limitations.md) · [Demo script](docs/demo-script.md) ·
[API](docs/api.md) · [Decisions](docs/decisions/README.md) · [Release process](docs/release.md) ·
[Pilot playbook](docs/pilot-playbook.md) · [Client onboarding](docs/client-onboarding.md)

`pnpm verify:all` runs every suite (lint, types, unit, database, chaos, adversarial, web, images, backup drill, the
demo) and writes `.reports/verify-all.json`.

## Not legal advice

This software helps a business ask its customers to pay. It does not make that lawful in any country, it is not
legal advice, and it makes no compliance claim. Consent, debt-collection rules, data-protection duties and contracts
with providers are for the operator and their advisers. TODO(disclaimer): the build guide's Section 2.4 wording
was not available here; the owner may replace this paragraph with it. <!-- claims-ok: disclaimer -->

No warranty: until a licence is chosen, nothing in this repository is offered under any terms.

## Developing

### Web app

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

### Requirements

- Node.js >= 24.12 (`.nvmrc`) and pnpm (pinned in `package.json` `packageManager`).
- Docker, running. The Supabase CLI is a dev dependency, so `pnpm exec supabase` is always the pinned
  version.

### Commands

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

### Importing invoices

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

### Sending (phase 3)

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

### Replies and promises (phase 4)

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
- Classifier: `CLASSIFIER=anthropic` with `CLASSIFIER_MODEL` (recommended `claude-opus-5-5`) and
  `ANTHROPIC_API_KEY`, or `CLASSIFIER=openai` with an OpenAI model id in `CLASSIFIER_MODEL` and `OPENAI_API_KEY`
  (ADR 0053). Without it, every reply goes to a human.
- The labelled set in `data/classifier` is SYNTHETIC: a regression guard, not a measure of real-world accuracy.
- Live Meta webhook delivery needs a public HTTPS URL in front of `pnpm webhooks`; real mailboxes need app
  passwords. See `docs/decisions/0022`-`0031`.

### Payments and proofs (phase 5)

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
