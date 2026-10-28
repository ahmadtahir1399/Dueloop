# Prompt 5 report: payments + reconciliation

The decisions from prompts 1-4 are "none yet". `decide()`, Action, Ctx and the state machine are unchanged.
Prompt 3 and 4 semantics changed only at the gates the prompt lists: the payment block, the receipt job kind,
and the paid/balance pre-claim gate (L). Section 9 lists two small side changes.

## 1. BUILT

**Core**
- `packages/core/src/payment.ts` (new): `planPaymentOutcome` (applied, credit, transition, promise outcome,
  events, tasks, alerts, receipt, stop reminders) and `evaluatePromiseOnPayment`. Pure; 18 tests, including
  property tests.
- `packages/core/src/ports.ts`: additive changes only.
  - `PaymentRequest` gains `providerObjectId`, `amountMinor`, `currency` and `expiresAt`.
  - Every `PaymentEvent` may carry `providerEventId`, `requestRef` and `livemode`.
  - `payment_confirmed` gains `currency`; new events `payment_processing` and `payment_reversed`.
  - `createPaymentRequest` takes `currency`, `expiresAt` and `idempotencyKey`; `getStatus?` is new.

**Migrations** (local only; the hosted project still has 0001-0006)
- `0012_payments.sql`
  - Tables: receipts, credits, payment_accounts (holds the token hash; secrets are Vault references),
    payment_requests, payment_events, payment_proofs.
  - Columns `payments.receipt_id` and `payments.source`; the private `payment-proofs` bucket and its policies.
  - New task, event and tenant-setting types; `messages.purpose`.
  - Functions `apply_payment`, `payment_integrity`, `store_payment_event` and purge; RLS per ADR 0032.
- `0013_payment_request_sync.sql`: `payment_requests.provider_deactivated_at`, so a provider-side switch-off
  can be retried.
- `0014_receipt_sweep.sql`: a stale receipt becomes `unknown` without parking the invoice.
- `0015_kpi.sql`
  - Functions: `kpi_ageing`, `kpi_overdue_total`, `kpi_recovered`, `kpi_days_to_pay`,
    `kpi_promise_kept_rate`, `kpi_messages`.
  - Views: `kpi_this_week`, `kpi_ageing_now`, `kpi_overdue_now`.
  - All security invoker.
- `0016_proof_inbox.sql`: the `proof_fetch` queue and the trigger that fills it when a message is linked to an
  invoice; `payment_proofs.attachment_index`, unique per message and attachment.

**Packages**
- `packages/payments` (new). One file per stage:

  | File | Contents |
  |---|---|
  | `ingest.ts` | Token -> account, signature, mode check, store |
  | `pipeline.ts` | Resolve -> plan -> apply -> alerts; `confirmByHuman` |
  | `requests.ts` | `createRequestFor`, `deactivateRequests`, `sweepRequests` |
  | `poll.ts` | `pollPending` |
  | `record.ts` | Manual recording |
  | `reconcile.ts` | Read-only reconcile |
  | `registry.ts` | Gateways per account, secrets from Vault |
  | `db.ts` | Database access |
- `packages/adapters-payments` (new): `BankTransferProvider`, `FakeGateway` (signed deliveries, delays,
  duplicates, reordering, failures) and `StripeGateway`.
- `packages/proofs` (new). One file per stage:

  | File | Contents |
  |---|---|
  | `sniff.ts` | Magic bytes and header dimensions |
  | `media.ts` | Email raw MIME, WhatsApp media API |
  | `store.ts` | Private bucket, signed URLs |
  | `extract.ts` | `ProofExtractor`: fake, recorded, Claude vision; `parseHints` |
  | `process.ts` | The fetch -> validate -> store -> task pipeline |
  | `workflow.ts` | Confirm / reject |
  | `db.ts` | Database access |
- `packages/messaging`: `paymentBlock` and `safePayLink`; template variables `payment_block`,
  `amount_received` and `balance_remaining`; `receipt` default templates for email and WhatsApp.
- `packages/worker`:
  - `process.ts` gains the payment block, the link created before the claim, and the paid/balance gate before
    the claim and before the adapter.
  - `receipts.ts` (new) is the receipt job kind.
  - `runtime.ts` builds the payments and proofs dependencies.
  - The worker pass now also handles payments, the request sweep, polling, proofs and receipts.
- `packages/webhooks`: the `/webhooks/payments/<token>` route. WhatsApp is served only when configured.
- `packages/sim`: a payment stage and a ledger oracle.

**CLIs**

| Command | What it does |
|---|---|
| `pnpm payments record` | Record a manual payment |
| `pnpm payments integrity` / `pnpm payments:integrity` | Check ledger invariants |
| `pnpm payments process` | Drain payment events, sweep requests, poll |
| `pnpm payments reconcile` | Compare the provider with the ledger, read-only |
| `pnpm proofs list` / `show` / `confirm` / `reject` | Review proofs |
| `pnpm demo:payments` | The full walkthrough |
| `pnpm smoke:stripe` | Gated live check |
| `pnpm eval:proof-live` | Gated live check |

**Docs**
- ADRs 0032 (role matrix), 0033-0040 and 0041 (KPI definitions); the ADR 0023 note on opaque tokens.
- README: "Phase 5 of 7".
- CLAUDE.md: rules 27-32.
- CI: the Phase 5 steps.

## 2. COMMANDS RUN (final full run this session, local stack)

Third full run of `dod5.sh` on 2026-10-28, local stack. Results as the commands printed them:

| Command | Result |
|---|---|
| `supabase db reset` (twice) | OK both times |
| `pnpm lint` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | 623 passed (27 files) |
| `pnpm db:test` | pgTAP Files=22, Tests=1434, Result: PASS; integration 146 passed |
| `pnpm db:rls-check` | "every public table has RLS and every public view is security_invoker" |
| `pnpm db:types:check` | "database.types.ts matches the local database schema" |
| `pnpm chaos` | 33 passed (prompt 3-4 suites + payments chaos) |
| `pnpm test:adversarial` | 64 passed (prompt 4 suites + payment webhook abuse + proof abuse) |
| `pnpm payments:integrity` | `{"result":"clean","count":0}` |
| `pnpm classifier:eval` | accuracy 94.3%, macro-F1 0.949, "no regression versus baseline" (unchanged) |
| `pnpm demo:send` | DEMO OK: 8 approved reminder emails, one each; second run 0 new |
| `pnpm demo:replies` | DEMO OK |
| `pnpm demo:payments` | DEMO FAILED inside its demo:send step: "an owner alert was sent twice (new in the second pass: alert.escalated, alert.escalated)" (see below) |
| `pnpm sim` (twice) | Invariant violations: 0; byte-identical |
| `pnpm payments:integrity` (after the demos) | clean |
| `pnpm smoke:stripe` | "skipped: NOT VERIFIED" (no credentials) |
| `pnpm eval:proof-live` | "skipped: NOT VERIFIED" (no credentials) |

**What the demo failure was.** The diagnostic showed two `alert.escalated` alerts appearing first in the second
worker pass. Their jobs had been deferred from the earlier pass, so these were new alerts, each sent once,
not duplicates. The demo's check compared alert *counts* between passes, which fails whenever a deferred
invoice escalates late. The same check failed `demo:replies` in the first two full runs, at the same point.

**Fix.** The check now fails only when the same alert Message-ID arrives twice. That is the real duplicate
condition: the id is derived from the dedupe key. New alerts are printed as information.

**After the fix.** The three demos were re-run in DoD order, each after its own reset, and all exited 0.
`demo:send` logged the exact case ("new owner alert(s) in the second pass, each sent once: alert.escalated,
alert.escalated"), and `pnpm payments:integrity` afterwards was clean. Lint and typecheck were re-run after
the change. I did not run the whole DoD a fourth time.

**Earlier full runs.** The first run also had one flaky proofs DB test (row order on equal timestamps). It was
fixed in the test and was green in runs 2 and 3.

Concurrency (`pnpm chaos`, `payments-chaos.test.ts`):
- 10 parallel partials of 125.05 against 1,250.50: 1 `PaymentConfirmed`, 9 `PartialPaymentConfirmed`,
  balance 0, 10 receipts, no credits.
- 10 parallel payments of 200.00: balance 0, total credit 749.50, 1 paid transition.
- The same event delivered 50 times in parallel, processed by 5 parallel workers: 1 stored and 49 duplicates;
  1 receipt, 1 receipt email.

Integrity:
- `pnpm payments:integrity` prints `{"result":"clean","count":0}` and exits 0 (before and after the demos).
- Proven able to fail in two places:
  - `payments-manual.test.ts`: a committed corrupted credit makes the CLI exit 1 with
    `"finding":"receipt_unbalanced"`; after removing it, the CLI exits 0 again.
  - `ledger.test.sql`: the same check fails inside a rolled-back transaction.

`pnpm demo:payments` table:

| Step | Event | Invoice | Outcome | Balance before | Balance after | Status before | Status after | Receipts sent |
|---|---|---|---|---|---|---|---|---|
| 1 | full payment (webhook) | DA-0001 | HTTP 200 -> applied | 1250.00 | 0.00 | promised | paid | 1 |
| 2 | same webhook again | DA-0001 | HTTP 200 -> nothing new (duplicate at the store) | 0.00 | 0.00 | paid | paid | 1 |
| 3 | partial (`pnpm payments record`) | DA-0003 | recorded | 9900.00 | 4950.00 | overdue | overdue | 1 |
| 4 | overpayment (`pnpm payments record`) | DA-0004 | recorded (credit 50.00) | 150.50 | 0.00 | overdue | paid | 1 |
| 5 | tampered webhook | DA-0006 | HTTP 401, nothing stored | 2400.50 | 2400.50 | overdue | overdue | 1 |
| 6 | screenshot -> `pnpm proofs confirm` | DA-0006 | proof stored + task; confirmed | 2400.50 | 0.00 | overdue | paid | 1 |
| 7 | refund event (webhook) | DA-0001 | HTTP 200 -> reversal_recorded | 0.00 | 0.00 | paid | paid | 1 |
| 8 | payment on cancelled invoice | DA-0013 | HTTP 200 -> applied (all credit) | 200.00 | 200.00 | cancelled | cancelled | 0 |

"Receipts sent" is the invoice's final count after the worker pass: one per receipt, and none for the
cancelled invoice, where the plan does not send one.

Tasks the demo raised: `overpayment_credit` ×1, `payment_on_final_invoice` ×1 (urgent), `payment_reversal` ×1
(urgent), `review_proof` ×1.

The worker then ran the next day, with approve-all: no reminder activity for any paid or cancelled invoice.
Promise kept rate today was 1.0000; recovered today was 8,751.00 GBP with 250.00 credit; `payments:integrity`
was clean.

Fixture-based: the gateway deliveries (FakeGateway signatures and ids) and the screenshot (a synthetic PNG).
Live: the database, the webhook HTTP route, the pipeline, the CLIs, the worker and SMTP into Mailpit.

## 3. VERSIONS

**Runtime and database**

| Component | Version |
|---|---|
| Node | 24.19.0 |
| pnpm | 12.15.0 |
| TypeScript | 6.0.3 |
| Supabase CLI | 2.122.0 |
| PostgreSQL | 17.11 (local stack, `select version()`) |
| pgmq | 1.5.1 |
| pg_cron | 1.6.4 |
| supabase_vault | 0.3.1 |

**Stripe**
- No SDK; REST with form encoding.
- API version pinned to `2026-09-30.endive` (the docs' "current version" on 2026-10-28).
- Docs fetched on 2026-10-28; cited in ADRs 0036-0038.

**Libraries**

| Library | Version | Used for |
|---|---|---|
| @supabase/supabase-js | 2.118.0 | Proof storage, signed URLs |
| @anthropic-ai/sdk | 1.3.0 | Proof extraction adapter |
| zod | 4.6.7 | |
| postal-mime | 4.1.4 | Reading email attachments |
| pg | 8.23.1 | |
| luxon | 3.7.2 | |

**Image handling.** No image library. The header parser is our own (`proofs/src/sniff.ts`), and no image is
ever decoded.

**Test tools**

| Tool | Version |
|---|---|
| Vitest | 5.0.5 |
| fast-check | 4.10.2 |
| pgTAP | ships with the Supabase CLI image |

Mailpit is the local SMTP catcher (54324/54325). GreenMail 2.1.14 is used for IMAP, unchanged.

## 4. ISSUES A-P

| Issue | Status | Tests | Commit |
|---|---|---|---|
| A port gap | Confirmed; extensions are additive | core `payment.test.ts`, `ports.test.ts` | 0f9c33c |
| B ledger | Confirmed; receipts -> payments + credits, append-only | `supabase/tests/payments/ledger.test.sql` (31) | 297717f |
| C payment on a final invoice | Confirmed; all credit plus an urgent task | core "final invoice"; `payments.test.ts` "money for a cancelled or already-paid invoice" | 0f9c33c, f203c7b |
| D concurrency | Confirmed; row lock plus re-plan | `payments-chaos.test.ts` "N partial payments in parallel…", "parallel payments exceeding the total" | 0f9c33c |
| E refunds and chargebacks | Confirmed; become urgent tasks, never reopen | `payments.test.ts` "success-then-failed and refunds…" | f203c7b |
| F link lifetime | Confirmed; durable Payment Links, one active per invoice, replaced when the balance changes, switched off at the provider | `payments.test.ts` "full payment…" and "partial… new link"; migration 0013 | f203c7b |
| G metadata | Confirmed; resolved only through `payment_requests`, plus a mode check | adversarial "hostile metadata…"; `payments.test.ts` "unknown request… mode mismatch" | 0f9c33c |
| H signing and tokens | Confirmed; opaque token plus a per-account secret | adversarial "forged, stale, cross-account…"; `stripe.test.ts` webhooks | 0f9c33c, a8b2b2b |
| I minor units | Confirmed; doubtful currencies refused | `stripe.test.ts` "minor units" | a8b2b2b |
| J async methods | Confirmed; processing is never paid | `payments.test.ts` "async method…" | f203c7b |
| K receipts | Confirmed; transactional outbox | `payments.test.ts` "receipts"; chaos "receipt worker dies…" | f203c7b |
| L send race | Confirmed; gate before the claim and before the adapter | `payments.test.ts` "the paid check runs right before the send" | f203c7b |
| M proofs | Confirmed | `proofs.test.ts` (unit), `test-db/proofs.test.ts`, `proof-abuse.test.ts` | f32ea62 |
| N promise hook | Confirmed | core `evaluatePromiseOnPayment` tests (DST, Kolkata, Karachi, exact deadline); `payments.test.ts` "promises" | 0f9c33c |
| O modes and accounts | Confirmed; key and mode must match, mode-mismatched events rejected. No Stripe account was available, so this is fixture-based and the live side is NOT VERIFIED | `stripe.test.ts` "a key that does not match…"; adversarial mode case | a8b2b2b |
| P KPI definitions | Confirmed; ADR 0041 | `supabase/tests/payments/kpi.test.sql` (19, Kolkata, bucket boundaries) | 0a99a94 |

Bugs found by failing tests this prompt, then fixed:
- `promised_on` came back from `pg` as a local-midnight `Date`, which shifted the day on a UTC+5 machine.
  Found by "paid within the promise". Fix: select it `::text`.
- FakeGateway ids collided globally across worlds. Fix: a per-instance prefix.
- `pgmq.archive` and `set_vt` overloads were ambiguous. Fix: explicit casts.
- A failure after a confirmation raised no alert. Found by the reversal test.
- Requests swept and polled across all tenants. Fix: scoping.
- A proofs test was flaky because of row ordering (test fix, below).

Test edits, reported as required. No test was skipped, `.only`'d or deleted.
- `messaging.test.ts`: reminders may carry the reference code inside `payment_block`. New tests were added for
  the payment block and receipts.
- `failpoints-unreachable.test.ts`: `NO_PAYMENT_FAILPOINTS` is allowed, and a payments composition-root test
  was added.
- `test-db/proofs.test.ts`: original and duplicate rows are picked by role, not by order.
- `demo-send.ts` (a demo script, not a test): its "an owner alert was sent twice" check now fails on a repeated
  alert Message-ID, not on a higher alert count. A deferred invoice escalating in the second pass is a new
  alert, not a duplicate. New alerts are printed.

## 5. CHAOS TABLE

| Kill point | Observed end state |
|---|---|
| After the raw insert (`after_store`; the webhook process dies before answering) | Provider redelivery is a duplicate (stored 0); one apply; event processed; 1 receipt, sent once |
| After request resolve (`after_resolve`) | Visibility expires and the event is reprocessed: applied once, processed, 1 receipt sent once |
| After plan, before apply (`after_plan`) | Nothing written; on reprocess applied once; 1 receipt |
| After apply, before the processed mark (`after_apply`) | Reprocess finds `duplicate`; marked processed; the receipt job was queued in the apply transaction, so it is sent exactly once |
| Receipt worker after claiming the outbox row | `busy` while fresh, then `unknown` after the stale threshold; never resent (rule 17); reminders not parked |
| SIGKILL of the payment processor mid-batch: 200 events = 100 confirmations, 50 poll duplicates and 50 processing events delivered after their confirmation | Killed after 30 applies, then restarted: 100 receipts (each invoice exactly 1), 200 events `processed`, queue empty, 100 receipt jobs, 100 invoices paid, integrity clean |
| Prompt 3-4 chaos (send protocol, kill switch, inbound) | Unchanged and still green (part of `pnpm chaos`, 33 tests) |

## 6. LEDGER MODEL AS IMPLEMENTED

**Tables**
- `receipts`: money in, unique on `(tenant, method, provider_ref)`, with source gateway, poll, manual, proof or
  legacy.
- `payments`: the applied slices, with `receipt_id`. The prompt 2 balance view is unchanged.
- `credits`: the remainder.
- All three are append-only for every role (`private.guard_ledger`).

**Invariants**
- received = applied + credit, per receipt (rule 28).
- applied = least(amount, balance), and 0 on a final invoice.
- Paid if and only if the balance reaches 0, through the state machine.
- Each receipt is applied exactly once per `(tenant, method, provider_ref)` (rule 29).
- Writes are serialised by the invoice row lock.

**Writer.** `private.apply_payment` is the only writer.
- It rejects plans the numbers do not force (23514) and returns `replan` on a stale read.
- It requires an owner or accountant for manual and proof sources (42501).
- It queues the receipt in the same transaction.

**Integrity check.** `private.payment_integrity` reports `receipt_unbalanced`, `payment_without_receipt`,
`negative_balance`, `paid_with_balance` and `active_request_on_final_invoice`.
- Results: clean in every run above.
- The ledger pgTAP test shows it catching a corrupted credit (rolled back).
- The CLI test shows `pnpm payments integrity` exiting 1 on a committed corruption and 0 after the cleanup.

**Sim oracle.** The new sim invariants (`ledger_unbalanced`, `negative_balance`, `reminder_after_paid`) hold
on the 90-day run, and each one fails under an injected fault (`overApply`, `skipPaidTransition`,
`unbalancedCredit`).

## 7. ROLE MATRIX ADDITIONS (ADR 0032, implemented in 0012, tested in `role_matrix.test.sql`)

| Object | owner | accountant | collector | anon / non-member |
|---|---|---|---|---|
| receipts, payments, credits | read | read | read | none |
| payment_accounts (no secrets) | read | read | none | none |
| payment_requests, payment_proofs | read | read | read | none |
| payment_events (raw PII) | none | none | none | none |
| proof files (bucket) | read own tenant folder | read own tenant folder | read own tenant folder | none |
| KPI functions and views | read (RLS) | read (RLS) | read (RLS) | none |

- No client role may insert, update or delete any of these tables or upload proof files.
- Confirming money (sources manual and proof) is owner or accountant only. This is checked in
  `apply_payment`, and also in `planManualPayment`, `planProofConfirmation` and `rejectProof`.
- Only trusted server code manages payment accounts and secrets in this phase.

## 8. DECISIONS NEEDED

- **Refunds, chargebacks and reopening.** A refund or chargeback today becomes an urgent task; the invoice
  stays paid. Reopening it needs a state-machine change.
- **Receipts to opted-out customers.** Today they are skipped (`ReceiptSkipped`). Should a receipt count as a
  transactional exception?
- **Payment while disputed.** Today the invoice is paid, a `payment_while_disputed` alert goes out, and the
  dispute task stays open.
- **Partial payment versus an active promise.** Today the promise stays active and is evaluated on the next
  payment or by `decide()`.
- **KPI definitions.** All of ADR 0041: tenant-local days; buckets `not_due`, `1-30`, `31-60`, `61-90`, `91+`
  (the guide's "0-30" excluded the due day); recovered counts applied money only; days to pay runs from issue
  to the last payment; the promise rate is kept / (kept + broken).
- **Credit handling.** Credits are recorded and never applied to other invoices or refunded.
- **Link lifetime.** Durable Payment Links, one completed session, replaced when the balance changes. The
  alternative is a signed pay page that creates sessions on demand (prompt 6).
- **First gateway.** Stripe, on the client's own account. I had no Stripe account, so I kept Stripe (with
  fixtures) and did not switch.
- **Proof review blocks reminders.** A proof linked to an invoice blocks reminders for 3 days, the same as a
  payment claim.
- **Receipts and the weekly cap.** Receipts do not count toward the weekly reminder cap; they do count toward
  the budget.
- **Refused Stripe currencies.** ISK, UGX and the three-decimal currencies get bank text only.

## 9. DEVIATIONS FROM THE GUIDE

- **Ports.** The port extensions are additive (A). Two gateway capabilities (`deactivate` and
  `supportsCurrency`) live in `PaymentGateway`, outside core, so the core port did not change twice.
- **Ledger.** The guide's single payments table became receipts -> payments + credits.
- **Webhook URL.** The route carries an opaque per-account token (sha256 stored), which updates the prompt 4
  "no ids in URLs" note (ADR 0023).
- **Receipts.** Receipts go through a non-decide transactional outbox (`transactional_sends`), not the
  reminder queue.
- **KPIs.** Implemented as security-invoker functions taking `as_of` or `from`/`to`, plus as-of-now views.
  Views alone cannot take a period.
- **Stripe.** Called over REST with form encoding, as the docs show; no Stripe SDK was added.
- **WhatsApp route.** The webhook runtime can now run with payments only; `/webhooks/whatsapp` is 404 when
  WhatsApp is not configured.
- **Weekly cap.** The worker's weekly-cap query now counts `purpose = 'reminder'` only (context.ts).
- **tsconfig.** `skipLibCheck` was added to the worker and webhooks tsconfigs, because supabase-js .d.ts files
  name DOM types (the ADR 0011 precedent). Only declaration files are skipped.
- **Where the CLIs live.** `pnpm payments` and `pnpm proofs` live in `packages/worker/src/bin`, next to the
  other ops CLIs.
- **Unused statuses.** Request statuses `expired` and `failed` exist in the schema but are not used yet.
  Expiry is treated as `expiring` when a request is replaced.

## 10. NOT VERIFIED

**Live services**
- **Live Stripe.** No Stripe account was available. `pnpm smoke:stripe` prints `NOT VERIFIED` without
  `STRIPE_SMOKE=1` and a sandbox key. All Stripe tests use a fake fetch and fixtures built from the
  documented fields.
- **Restricted-key permissions.** The exact permission set (Payment Links write, Checkout Sessions read, and
  possibly Products/Prices write for `price_data`) has to be confirmed in a sandbox.
- **Live WhatsApp media fetch.** The two-step media API is tested against a fake fetch only.

**Not measured or absent**
- **AI proof extraction accuracy.** NOT MEASURED. `pnpm eval:proof-live` is gated and was not run with
  credentials. The Claude adapter is typechecked and was never called.
- **Malware scanning.** Absent.
- **Perceptual duplicate detection.** Absent; only exact sha256 duplicates are caught.

**Not run here**
- **GitHub CI.** Nothing was pushed. The workflow has the Phase 5 steps, but no CI run happened this session.
- **Hosted Supabase.** Migrations 0007-0016 are NOT pushed. The hosted project still has 0001-0006, pending
  your OK.
- **Cron.** Polling and sweeps run from the worker pass, not from pg_cron (the worker loop is the scheduler).
- **A fourth full DoD run.** The demos' alert-count check was timing-sensitive: a deferred invoice escalating
  in a later pass counted as "sent twice". It was fixed so only a repeated alert Message-ID (a real
  duplicate) fails. After the fix, the three demos, lint and typecheck were re-run and passed. The whole DoD
  was not run a fourth time (see section 2).

## 11. HANDOFF TO PROMPT 6

**KPIs** (ADR 0041; all tenant-local days, per currency, minor units)
- `kpi_ageing(as_of)` and `kpi_ageing_now`
- `kpi_overdue_total(as_of)` and `kpi_overdue_now`
- `kpi_recovered(from, to)`
- `kpi_days_to_pay(from, to)`
- `kpi_promise_kept_rate(from, to)`
- `kpi_messages(from, to)`
- `kpi_this_week`

**Signed pay page.** It should replace direct links in reminders: a signed, expiring URL of ours that creates
a Checkout Session on demand at the current balance, then deactivates the old Payment Links (the
`payment_requests` sweep already does this).

**Proof viewing.** Viewing proofs needs a server-side `createSignedUrl` with the service role. The CLI uses
300 s. The UI must never receive the service-role key, and should show hints labelled UNTRUSTED.

**Unsubscribe.** An unsubscribe / opt-out endpoint is still owed: a one-click link (the footer currently says
"reply STOP").

**API endpoints owed**
- Record a payment (owner or accountant).
- Confirm or reject a proof.
- Approvals approve, reject and edit.
- Tasks resolve and reopen.
- Promises cancel.
- Connect a payment account: an owner-only RPC wrapping `payment_accounts` + `private.set_payment_secret`, and
  showing the webhook URL with its token once.
- Rotate the webhook token.
- Reconcile (read-only).
- Messages resolve unknown.

**UI actions the dashboard must expose**
- Approvals.
- Tasks, including the urgent payment tasks: `unmatched_payment`, `payment_amount_mismatch`,
  `payment_reversal`, `payment_on_final_invoice`, `unprocessed_payment_event`, `proof_limit_reached`.
- Proofs: list, show, confirm, reject.
- Payment recording.
- Credits.
- The kill switch.

**Event names added in prompt 5**
- Invoice events:

  | Event | Event | Event |
  |---|---|---|
  | `PaymentConfirmed` | `PartialPaymentConfirmed` | `PaymentCreditCreated` |
  | `PaymentReversed` | `PaymentFailed` | `PaymentRequestCreated` |
  | `PaymentRequestDeactivated` | `PromiseKept` | `ProofSubmitted` |
  | `ProofVerified` | `ProofRejected` | `ReminderAfterPayment` |
  | `ReceiptSkipped` | | |

- Tenant events: `PaymentUnmatched`, `PaymentEventDeadLettered`.
- Alerts: `payment_*` and `proof_received` / `proof_rejected`.
