# Prompt 4 report: replies + promises

Decisions from prompts 1-3: "none yet". `decide()`, Action, Ctx and the state machine are unchanged.
Prompt 3 semantics changed only at the gates the prompt listed (L, N).

## 1. BUILT

**Core**
- `packages/core/src/reply.ts`: `Proposal`, `validatePromiseDate`, `planReplyOutcome`. The effect kinds are
  a closed set with no send; property-tested.

**Migrations**
- `0009_replies.sql`:
  - new tables inbound_events (PII, `purge_after`), promises (one active per invoice), tasks (dedupe
    key, blocks, drafts) and tenant_events (append-only);
  - new columns on messages, channel_accounts (`external_account_id`, globally unique) and tenants
    (`promise_acceptance`, classification cap);
  - 7 event types, the inbound pgmq queue, `store_inbound_event`, the task/promise RPCs, and purge + cron.
- `0010`: dead letters accept `inbound_events`; task reasons may contain digits.
- `0011`: `private.imap_cursors`.

**Packages**
- `packages/classifier`:
  - strict zod `ReplyAnalysis`, `toProposal` (typed reasons), redacted model input, versioned prompt
    `prompts/reply-v1.md`;
  - Fake/Recorded classifiers and the Claude adapter;
  - `eval/` (harness, keyword baseline, record, eval).
- `packages/inbound`: normalisers (email via postal-mime + html-to-text; WhatsApp), pre-filters, matcher,
  drafts, `InboundDb` (exactly-once `applyPlan`) and the pipeline (steps 2-10).
- `packages/webhooks`: the `node:http` WhatsApp endpoint (raw-body signature, handshake, limits),
  `pnpm webhooks`, gated `smoke:whatsapp-webhook`.
- `packages/adapters-email`: read-only IMAP poller (imapflow) and its Postgres store.
- `packages/worker`:
  - pre-decide and final gates (blocking tasks, opt-out, kill switch right before the adapter),
    `low_confidence` approvals, promise-broken hook;
  - CLIs `pnpm tasks|promises|inbound`;
  - `demo:replies`.
- `packages/sim`: a reply stage through `planReplyOutcome`, plus 3 new invariants.

**Data, docs and CI**
- `data/classifier`: `labelled.jsonl` (158 SYNTHETIC messages), keyword-baseline recordings,
  `baseline.json`.
- ADRs 0022-0031, CLAUDE.md rules 21-26, README "Phase 4 of 7".
- CI: adversarial, `classifier:eval`, `demo:replies`.

## 2. COMMANDS RUN (final full run this session, local stack)

| Command | Result |
|---|---|
| `supabase db reset` (x2) | both "Finished" |
| `pnpm lint` / `pnpm typecheck` | exit 0 / exit 0 |
| `pnpm test` | 23 files, 573 tests passed |
| `pnpm db:test` | pgTAP Files=20, Tests=1144, PASS; integration 11 files, 105 tests (includes GreenMail IMAP, inbound loop + chaos, worker gates) |
| `pnpm db:rls-check` / `pnpm db:types:check` | pass / matches |
| `pnpm chaos` | 3 files, 24 tests passed |
| `pnpm test:adversarial` | 2 files, 55 tests passed |
| `pnpm classifier:eval` | accuracy 94.3%, macro-F1 0.949, no regression (keyword baseline; see §6) |
| `pnpm demo:send` then `pnpm demo:replies` | DEMO OK (table below) |
| `pnpm sim --days 90 --invoices 500 --seed 42` (x2) | 0 invariant violations, byte-identical; 99 promises, 57 reply tasks, 15 reminder blocks |
| `pnpm eval:live`, `pnpm smoke:whatsapp-webhook` | skipped by their gates (no credentials): NOT VERIFIED |

`demo:replies` outcome table (scripted classifier; WhatsApp via signed POSTs to the real webhook, email via
the IMAP poller's store step):

| Reply | Invoice | Intent | Effect | Status |
|---|---|---|---|---|
| "Can't pay until the 15th, sorry." (email, threaded) | DA-0001 | promise_to_pay, 2026-11-15 | promise recorded | overdue -> promised |
| "Will pay soon, promise." | DA-0004 | promise_to_pay, vague | review_promise (vague_date) | unchanged |
| "Already paid, sent the transfer yesterday." (WhatsApp) | DA-0006 | already_paid | verify_payment_claim, reminders paused 3 days | unchanged |
| "We never ordered this, the invoice is wrong." | DA-0009 | dispute | dispute task + alert | overdue -> disputed |
| "STOP" (WhatsApp) | DA-0008 | pre-filter opt_out_keyword | customer opted out, all channels | unchanged |
| DSN 5.1.1 bounce | DA-0012 | pre-filter bounce | invalid_contact task + DeliveryFailed | unchanged |

Then 3 rounds of worker + approve-all the next day: 0 reminder activity on the 4 protected invoices, and
activity (skipped WhatsApp steps) on 2 of 4 others.

The scripted classifier proves the PIPELINE, not AI accuracy.

## 3. VERSIONS

| Component | Version |
|---|---|
| Node | 24.19.0 |
| pnpm | 12.15.0 |
| TypeScript | 6.0.3 |
| Vitest | 5.0.5 |
| fast-check | 4.10.2 |
| Supabase CLI | 2.122.0 |
| Postgres | 17.11 |
| pgmq | 1.5.1 |
| HTTP framework | `node:http` (built-in; raw body; ADR 0023) |
| MIME parser | postal-mime 4.1.4 |
| HTML to text | html-to-text 10.0.1 |
| IMAP client | imapflow 2.9.1 |
| Test IMAP server | GreenMail 2.1.14 (Docker) |
| zod | 4.6.7 |
| LLM SDK | @anthropic-ai/sdk 1.3.0 |

The model id is configuration (`CLASSIFIER_MODEL`, recommended `claude-opus-5-5`). **No model was called
this session.**

## 4. ISSUES A-N

Where it says "tests first", the tests were written first and run red in this session before the
implementation, but were committed together with it.

| Issue | Confirmed | Test(s) | Commit |
|---|---|---|---|
| A: hmac in core; malformed hex | yes, worse than described: `Buffer.from(hex)` never throws, and "<valid sig>zz" decodes to the right length and passes the length check | webhooks `signature (issue A)` | 770eaf5 |
| B: Proposal type in core | yes | core `reply.test.ts` | d94b6bf |
| C1: dates not checked | yes | `validatePromiseDate` tests | d94b6bf |
| C2: amountMinor unreliable | yes; replaced by `statedAmountText` + ingest parser | classifier schema tests | 7bbbd18 |
| C3: generic review reason | yes; typed `ReviewReason` | `toProposal` tests | d94b6bf |
| C4: confidence not calibrated | thresholds provisional | eval sweep | 2b25331 |
| C5: strict schema | yes | classifier schema tests | 7bbbd18 |
| C6: summary untrusted | yes | adversarial (a) | 028dc41 |
| D: tasks/promises storage | yes | pgTAP `replies_schema` | 4d6359f |
| E: `promise_acceptance` | yes (setting) | core table + loop | d94b6bf, 4d6359f |
| F: matching | yes | loop "matching (issue F)" | 1f56f8c |
| G: promise lifecycle | yes | loop "two promises in the wrong order", "renewal cap"; gates "issue G" | 1f56f8c, bf08647 |
| H: tenant_events + OptOutRecorded on invoices | yes | pgTAP + loop STOP | 4d6359f, 1f56f8c |
| I: dedupe + monotonic status | yes | loop "duplicates", "statuses out of order" | 1f56f8c |
| J: spoofing | yes | loop + adversarial (c) | 1f56f8c, 028dc41 |
| K: reference time | yes | `referenceTime` + wrong-order promise test (Date header) | 1f56f8c |
| L: reply between decide and send | yes | gates "issue L" (opt-out, block, kill switch at the failpoint) | bf08647 |
| M: unknown -> sent evidence | yes | loop "M" | 1f56f8c |
| N: `low_confidence` | yes | gates "issue N" | bf08647 |

On M: Meta's docs confirm that `biz_opaque_callback_data` is accepted on send and echoed in status
webhooks. Recommended change, NOT applied: send the idempotency key in it from the prompt 3 adapter.

**Bugs found this session**, each with a failing test or reproduction first:
- Redaction hid dates and amounts from the model; found by the SIGKILL test (3ecba2a).
- A WhatsApp sender in a reserved number range was not resolved (45c6c40).
- Consent revocation failed under clock skew (1f56f8c).
- `FOR UPDATE` combined with `GROUP BY` (1f56f8c).
- DSN parts surfaced as body text (1f56f8c).
- The demo clock raced the database's `now()` (45c6c40).

## 5. CHAOS TABLE

| Kill point | Observed end state |
|---|---|
| after_raw_insert (provider retries) | stored once, 1 promise, 1 PromiseRecorded, queue empty |
| after_message_insert | effects exactly once after 2 re-deliveries |
| after_classify | effects exactly once (classifier called again on retry) |
| after_apply (before processed mark) | effects exactly once; alert lost (documented, ADR 0024) |
| SIGKILL mid-batch: 200 events, 100 duplicates, 100 out-of-order pairs | 200/200 processed; each of 100 invoices has exactly 1 promise and 1 PromiseRecorded; 0 unprocessed messages; queue empty |
| L: opt-out / blocking task / kill switch arriving between decide() and send | 0 sends; claim given back (retry, attempt 0); the same key is sent once after the block ends |

## 6. CLASSIFIER EVAL

The outputs come from the deterministic **keyword baseline**, not a model, scored over 158 **SYNTHETIC**
messages.

- Accuracy 94.3%, macro-F1 0.949.
- Per-intent F1:

  | Intent | F1 |
  |---|---|
  | promise_to_pay | 0.957 |
  | already_paid | 0.947 |
  | dispute | 1.0 |
  | needs_info | 0.968 |
  | payment_plan_request | 1.0 |
  | wrong_person | 1.0 |
  | abusive | 0.966 |
  | unclear | 0.840 |
  | opt_out | 0.867 |

- The confusion matrix and the threshold sweep are printed by `pnpm classifier:eval`. Sweep: coverage 100%
  at a threshold of 0.5, 82.9% at 0.6, 59.5% at 0.8.

These numbers measure NOTHING about a model. I wrote the keyword rules alongside the synthetic set, so they
are fitted to it. They prove only that the harness, metrics and regression gate work.

**Thresholds**: `MIN_CONFIDENCE` is 0.5-0.6 and promise auto-accept is 0.8. These are provisional, chosen
to send doubt to a human. They must be re-set from a sweep over real recorded model outputs.

A synthetic set written by an AI is a regression guard, NOT a measure of accuracy on real customer messages.
The guide's gate of 150 real messages per language is **NOT MET**. Non-English (de, es, fr, ur-Latn) is
EXPERIMENTAL.

## 7. ROLE MATRIX ADDITIONS

ADR 0022, as implemented and tested by the pgTAP role matrix over every public table:

| Area | Access |
|---|---|
| inbound_events | no client role (raw payloads are PII) |
| promises | members R; owner/accountant cancel via RPC; no direct writes |
| tasks | members R; any member resolves/reopens via RPC (a note is required); no direct writes |
| tenant_events | members R; append-only for everyone |
| `external_account_id` | as channel_accounts |
| Inbound queue / store / purge functions | revoked from anon, authenticated and service_role |

## 8. DECISIONS NEEDED

1. **`promise_acceptance` default**: `auto` (clear, trusted, confident promises move the invoice, plus an
   alert). Should it be `review`?
2. **`low_confidence` meaning** (issue N): approval only while the invoice has an open `human_review` task,
   or the customer has an open low-confidence/invalid reply task from the last 14 days.
3. **Opt-out scope**: all channels and all consents revoked (conservative).
4. **Promises on `open` invoices** go to a human. The state table allows `promise_accepted` only from
   overdue. Allow it?
5. **Exits from `disputed`**: only paid; a dispute stays until a human acts. Add a "dispute resolved"
   transition?
6. **No automatic fallback channel** on a bounce or WhatsApp failure; it creates a task.
7. **Amount-stated promises**: an amount different from the balance goes to a human.
8. **Renewal while `promised`**: it goes to a human. The renewal cap is 2.
9. **Block lengths**: 3 days for "already paid" and for info requests.
10. **Classifier daily cap**: 500 per tenant.

## 9. DEVIATIONS FROM THE GUIDE

- `hmac` lives in `packages/webhooks`, with the strict header format.
- `Proposal` is in core; `toProposal` stays in the classifier.
- `amountMinor` was replaced by `statedAmountText`; the guide's `send_info_template` was replaced by DRAFT
  tasks (no automatic replies).
- New schema: inbound_events, tasks, promises, tenant_events, inbox columns on messages,
  `external_account_id`, tenant settings.
- Apply runs as one processor transaction over the trusted connection, not a PostgREST RPC (ADR 0024).
- Ingest's pure parsers are exposed via `@dueloop/ingest/parsers`, so inbound avoids supabase-js DOM
  types.
- Prompts are `.md` data files.
- The committed eval recordings are from a keyword baseline, because no live model was available.
- In the demo, email enters through the IMAP store step rather than a running IMAP server; the IMAP poller
  itself is tested against GreenMail.
- **Test edits**:
  - The prompt 3 test "low_confidence is treated as always until prompt 4" now asserts the prompt 4
    definition.
  - The sim's "forgetting what was sent" fault test has a 30 s timeout (3.6 s before, about 5 s after).
  - A SendRecord fixture gained the 2 new fields.

## 10. NOT VERIFIED

- Live Meta webhook delivery (needs a public HTTPS URL and app configuration; `smoke:whatsapp-webhook` is
  gated).
- Quoted-reply `context.id` on real WhatsApp traffic.
- `biz_opaque_callback_data` round trip.
- Any live model call or live model accuracy (`eval:live` was not run: it costs money and needs your OK and
  credentials).
- Real mailboxes (app passwords, provider IMAP policies).
- Hosted Supabase: migrations 0007-0011 were NOT pushed.
- The GitHub Actions run itself.

## 11. HANDOFF TO PROMPT 5

**Payment claims**
- "Already paid" creates task `verify_payment_claim` (tasks.type), reason null (trusted sender) or
  `unverified_sender`. A trusted sender's task carries `blocks_reminders_until` = now + 3 days.
- Resolve it with `private.resolve_task_impl(id, true, note, actor, at)`, or `pnpm tasks resolve`, which
  re-enters `decide()`.
- Prompt 5 should auto-resolve it when a payment confirms.

**Attachments and proofs**
- `messages.attachments` (jsonb) holds `{name, mime, size}` metadata only. The raw email stays in
  `inbound_events.raw_mime` until `purge_after` (90 days), so a proof fetch must happen before the purge.
- WhatsApp media: the stored item payload (`inbound_events.payload`) contains the media object, but the
  normaliser keeps only mime/filename. Prompt 5 must read the media id from the payload.

**Promise-kept hook**
- When a payment brings the balance to 0, set the active promise (`promises.status = 'active'`) to `kept`
  (or not kept, per the deadline rule), in the payment transaction.
- There is no `PromiseKept` event type yet: add it to the `invoice_events` CHECK and to
  `packages/db/src/events.ts` (the drift test enforces both).
- The worker already marks promises `broken`.

**Transactional sends**
- The prompt 3 send protocol is `decide()`-driven (policy steps), and receipts need a separate job kind.
- `sendPath` gates live in `packages/worker/src/process.ts`; `finalGate` (pause, opt-out, block) runs just
  before the adapter.

**Event names**
- Added in prompt 4: PromiseSuperseded, PromiseCancelled, PaymentClaimReceived, ReplyNeedsReview,
  DeliveryFailed, RemindersBlocked, RemindersResumed.
- tenant_events: OptOutRecorded, ReplyUnmatched, ReplyAmbiguous, DeliveryFailed, InboundDeadLettered,
  AutoReplyReceived.
- Already present from prompt 1: PaymentConfirmed, PartialPaymentConfirmed, ProofSubmitted, ProofVerified.

**Webhook runtime**
- `packages/webhooks` routes currently: `/healthz` and `/webhooks/whatsapp`. Add
  `/webhooks/payments/<token>` there.
- The webhook store pattern is `private.store_inbound_event`: dedupe, queue and purge in one statement.
