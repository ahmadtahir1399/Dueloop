# Demo script

A guided walk-through on the local stack with synthetic data only. Everything below was run on one Windows 10
machine on 2026-10-29; other platforms are NOT VERIFIED.

## Start

```bash
pnpm demo
```

`pnpm demo` checks prerequisites (Node, pnpm, Docker, free ports, disk, memory, network on first run) and prints a
one-line fix for anything missing. It refuses to run if any database, API, app or mail URL is not local or any
provider key looks live. It writes only under `.demo/` (gitignored), starts the local Supabase stack if needed,
applies migrations and the demo seed (`supabase/seed.sql`, separate from migrations), builds the web app, starts web,
webhooks, the worker and the demo processor, and prints:

- the dashboard URL (`http://localhost:3000/login`) and the mail catcher (`http://127.0.0.1:54324`, every email the
  demo sends lands there);
- three logins (owner, accountant, collector) with passwords generated for this run, shown once, never stored.

Re-running `pnpm demo` while it runs changes nothing. `pnpm demo:reset` returns to the seeded state with new
logins. `pnpm demo:stop` stops everything the demo started (and the Supabase stack only if the demo started it) and
checks that nothing is left. `pnpm demo:logs` shows the last lines of each process log.

Time: quiet hours would block sending at night, so the demo never changes a clock in the product. `demo:control
run-cycle` runs the worker with the existing `--now` option set to the next send window of the tenant's time zone
(ADR 0050).

## The seven steps

The demo tenant is "Demo Agency" (approval mode: always, so nothing is sent without a human).

| # | Do | Command | What proves it is real |
|---|---|---|---|
| 1 | Sign in as the owner. Overview shows ageing buckets; Invoices lists the seeded overdue invoices. (The CSV import wizard path is covered by `pnpm e2e:demo` with a fresh tenant.) | - | The numbers come from the database views; Exports gives the same rows as CSV. |
| 2 | Propose reminders, approve them (Approvals > select all > Approve, or the command), send. Run the cycle again: nothing new. | `pnpm demo:control run-cycle`, `pnpm demo:control approve-all`, `pnpm demo:control run-cycle` | One email per approved reminder in the mail catcher; Message-IDs match the outbox; the second run sends 0 (idempotency keys). |
| 3 | A customer replies "Can't pay until the 15th, sorry." | `pnpm demo:control inbound promise` | The invoice becomes `promised`; reminders wait for the promise date; the timeline shows the reply and the promise. |
| 4 | Open that invoice: the timeline. | - | Every event (reminder sent, reply, promise) with who and when, in the tenant's time zone. |
| 5 | Another customer says "We already paid this last week." | `pnpm demo:control inbound paid-claim --invoice <number>` | Status does NOT change (rule 6); a `verify_payment_claim` task appears; reminders pause for it. |
| 6 | A customer pays from the link in the email. | `pnpm demo:control pay <number>` | "Pay now" on the real pay page answers with a redirect to the provider; the signed `link.paid` delivery goes to the running webhooks service; the invoice becomes `paid`; a receipt email follows on the next worker pass. |
| 7 | Overview KPIs and the audit export; integrity. | `pnpm payments:integrity` | Recovered amount equals the confirmed payments; `received = applied + credit` holds for every receipt. |

Also worth showing: `pnpm demo:control inbound stop --invoice <number>` (the customer is opted out; the invoice is
unchanged), `inbound dispute` (a `dispute` task, status `disputed`), `inbound vague` (a `human_review` task), and the
kill switch in Settings (owner only).

`pnpm demo:control status` prints invoice statuses, pending approvals, open tasks, emails sent and heartbeats.

## Where the demo differs from production

- **Replies are classified by a deterministic keyword script** (the one `pnpm demo:replies` uses), not a model, so
  no API key is needed and results repeat. With a model configured, replies it is unsure about become human tasks.
- **Payments use the FakeGateway** (test mode only; refused in production builds). In a browser, "Pay now" leads to
  the fake provider's unroutable address (`pay.fake.test`): there is no fake checkout page. `demo:control pay` does
  what a hosted checkout does after a customer pays: it delivers the signed webhook.
- **Owner alerts go to the mail catcher.** The Slack adapter only accepts `hooks.slack.com` URLs, so there is no
  local Slack stand-in (ADR 0050).
- **The clock.** Only `demo:control run-cycle` moves time, through the worker's existing `--now` option.

## Resources

Measured on one machine (docs/measurements/demo-resources.txt): about 1.0 GB of memory in use, about 4.5 GB of disk
including the Supabase images. Preflight requires 4 GB of RAM and 6 GB of free disk. Warm start (stack running, build
cached) took 37 s; the first start with the web build took 53 s. A cold start from a clean clone (image downloads) was
NOT measured locally: the clean-clone CI job records it.
