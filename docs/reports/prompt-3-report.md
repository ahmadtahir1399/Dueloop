# Prompt 3 report: scheduler + sending

Decisions from prompts 1-2: "none yet". `decide()`, Action, Ctx and the state machine are unchanged.

## 1. BUILT

**Database**
- `supabase/migrations/0007_sending_schema.sql`: new tables templates, channel_accounts (+ Vault secret
  refs), customer_consents, approvals, dead_letters, notifications and `private.system_flags`. New
  `messages` outbox columns, `tenants.bank_instructions`, 7 event types, RLS, and the
  approve/reject/edit/pause RPCs.
- `supabase/migrations/0008_queue.sql`: the pgmq queue `followup_actions`; the functions
  enqueue (with `as_of`), claim, ack, release, dead-letter, stale sweep, approval expiry and unpark;
  `invoices.parked_reason`; pg_cron jobs gated by `cron_enabled`.
- pgTAP: `supabase/tests/sending/{issues_sending,queue,approvals_rpc}.test.sql`, plus role-matrix and
  fixture additions.

**Packages**
- `packages/messaging`: fail-closed renderer, Intl money/date formatting, footer (en/de/ur), header
  sanitiser, budget, router (typed reasons), token-bucket limiter, FNV jitter, default templates with a
  banned-wording test, and the `OutboundChannel` contract.
- `packages/worker`:
  - the send protocol (`process.ts`), `loadContext`, `WorkerDb`, the JSON logger (allowlist + redaction),
    ports and failpoints;
  - `runtime.ts`, the composition root (it can only build `NO_FAILPOINTS`; there is a proof test);
  - CLIs in `src/bin/{worker,approvals,messages,tenant}.ts`.
- `packages/adapters-email`: nodemailer 10 SMTP adapter with strict classification. Contract tests use a
  scripted SMTP server; integration tests run against Mailpit.
- `packages/adapters-whatsapp`: Cloud API template adapter. Contract tests are built from Meta's docs.
  Includes a gated `smoke:whatsapp`.
- `packages/adapters-notify`: Slack incoming-webhook notifier, an email-alert fallback to owners, and
  fanout.

**Tests, demo and seed**
- `packages/worker/test-db`: harness, loop tests (24), chaos (9: failpoints, a real SIGKILL, kill switch,
  notifier) and the seed-template drift test.
- `packages/worker/test-load/load.test.ts`: the 5,000-invoice load test.
- `packages/worker/scripts/demo-send.ts`: `pnpm demo:send`.
- Seed: Demo Agency templates (= `DEFAULT_TEMPLATES`), email account, bank details, one WhatsApp consent.
  `[local_smtp]` (Mailpit) is enabled.

**Docs and CI**
- ADRs 0012-0021, CLAUDE.md rules 16-20, README "Phase 3 of 7".
- CI: chaos and demo steps (load and live smoke are excluded).

## 2. COMMANDS RUN (this session, local stack)

| Command | Result |
|---|---|
| `supabase db reset` (x2) | both "Finished supabase db reset" |
| `pnpm lint` / `pnpm typecheck` | exit 0 / exit 0 |
| `pnpm test` | 18 files, 491 tests passed (452 in the full DoD run, plus 39 new core reply tests run afterwards) |
| `pnpm db:test` | pgTAP: Files=19, Tests=956, PASS; integration: 7 files, 59 tests passed |
| `pnpm db:rls-check` | "every public table has RLS and every public view is security_invoker" |
| `pnpm db:types:check` | exit 0 |
| `pnpm chaos` | 9/9. One failure in the second full DoD run: root-caused, fixed (6a7e5a8), then 9/9 in 6 consecutive runs |
| `pnpm demo:send` | DEMO OK: 8 approved reminder emails, Message-IDs match the outbox 1:1, 2 owner alert emails, second run 0 new sends, 0 new alerts |
| `pnpm test:load` | `{"invoices":5000,"sends":5000,"unique":5000,"worstPerSecond":50,"bucket":{"capacity":50,"refillPerSecond":50},"wallSeconds":237,"states":[{"s":"sent","n":5000}]}` |
| `pnpm sim --days 90 --invoices 500 --seed 42` (x2) | 0 invariant violations; byte-identical |
| `pnpm smoke:whatsapp` | skipped (gated; no credentials). NOT VERIFIED |

## 3. VERSIONS

| Component | Version |
|---|---|
| Node | 24.19.0 |
| pnpm | 12.15.0 |
| TypeScript | 6.0.3 |
| Vitest | 5.0.5 |
| ESLint | 10.13.0 |
| typescript-eslint | 8.72.0 |
| fast-check | 4.10.2 |
| Luxon | 3.7.2 |
| pg | 8.23.1 |
| nodemailer | 10.2.1 |
| Supabase CLI | 2.122.0 |
| Postgres | 17.11 |
| pgmq | 1.5.1 |
| pg_cron | 1.6.4 |
| supabase_vault | 0.3.1 |
| Mailpit | v1.31.3 |

## 4. ISSUES A-K

A, E, F, G and I were committed **failing first** in d414ebf (`supabase/tests/sending/issues_sending.test.sql`)
and fixed in e49932f. The other tests were written alongside their implementation, not committed red first.

| Issue | Confirmed | Test(s) | Fix commit |
|---|---|---|---|
| A: outbox vs append-only events | yes | `issues_sending` A; loop "one send per key" | e49932f, 0d1f34a |
| B: crash windows | yes | `chaos.test.ts` kill points + SIGKILL | 0d1f34a, 40dde17 |
| C: weekly cap per customer | yes | loop "issue C" | 0d1f34a |
| D: catch-up flood | yes | loop "issue D" | 0d1f34a |
| E: approval gaps | yes | `issues_sending` E; `approvals_rpc`; loop approvals (6) | e49932f, 0d1f34a |
| F: pause checked only at enqueue | yes | `issues_sending` F; loop "paused tenant"; chaos kill-switch (2) | e49932f, 0d1f34a |
| G: `now()` in enqueue | yes | `issues_sending` G; `queue.test.sql` (as_of, re-enqueue, concurrency) | e49932f |
| H: budget 0 ambiguous | yes | loop "issue H"; messaging budget tests | e10dd19, 0d1f34a |
| I: consent storage | yes | `issues_sending` I; loop "issue I" | e49932f, 0d1f34a |
| J: header injection | yes | messaging hostile-header tests; Mailpit CRLF tests (sanitised and raw) | e10dd19, b03436c |
| K: timeout is not a failure | yes | loop "issue K"; SMTP + WhatsApp contract tests | 0d1f34a, 8238c48 |

Two bugs were found this session, both with a failing test written first:
- Amounts and dates followed the customer locale instead of the template locale: an English email showed
  Arabic numerals (bc0b252, loop "rendering").
- The kill-switch chaos test was flaky (6a7e5a8).

## 5. CHAOS TABLE

| Kill point | Adapter calls for the key | End state |
|---|---|---|
| after_claim | 1 | sent |
| after_pending_insert | 0 | unknown + 1 alert + MessageStateUnknown, parked |
| after_adapter | 1 | unknown + 1 alert + MessageStateUnknown, parked |
| after_record | 1 | sent (bookkeeping `already_sent`) |
| SIGKILL mid-batch (100 jobs) | 100 sends, 100 unique keys, 0 duplicates | 99 sent + 1 unknown (in flight at the kill, never resent); 0 pending, queue empty |
| Global switch flipped after 3 sends | 3, then 7 more after resume | 3 sent + 7 released; all 10 sent after resume, 10 unique |
| Tenant switch flipped after 1 send | 1 | the rest released |

## 6. ROLE MATRIX ADDITIONS

ADR 0012, as implemented and pgTAP-tested:

| Area | Access |
|---|---|
| templates | owner RWD, accountant RW, collector R |
| channel_accounts | owner RWD, others R |
| Vault secrets | never readable by a client role; read via `private.channel_secret()` |
| consents | owner/accountant RW, collector R |
| approvals | read for members; decide/edit via RPC by owner/accountant only |
| dead_letters / notifications | read by owner/accountant |
| tenant kill switch | owner only |
| `system_flags`, queue functions | no client role (EXECUTE revoked from public, anon, authenticated and service_role) |

## 7. DECISIONS NEEDED

1. **Rule D** (one reminder per invoice per local day): is this per invoice (implemented) or per
   customer?
2. **`approval_mode = low_confidence`**: treated as `always` (ADR 0015). Prompt 4 defines it (issue N).
3. **Budget meaning**: 0 blocks paid channels and email is free (ADR 0018). Should 0 mean unlimited?
   Should email cost count?
4. **Approval expiry**: 7 days. Is that right?
5. **Kill-switch window**: the switch is read just before the outbox claim, so a pause that lands in the
   milliseconds between the check and the adapter call cannot stop that one send (ADR 0016). Acceptable?
6. **Rate limiter**: per worker process (in-memory). Is a shared limiter needed before running more than
   one worker?
7. **WhatsApp generic errors 1 / 131000**: classified as ambiguous, i.e. parked for a human, not retried
   (ADR 0020).
8. **No automatic channel fallback**: missing consent or contact means skip; account or budget problems
   mean park (ADR 0017).
9. **Alert routing**: Slack if the tenant has a webhook, otherwise email to owners only (not accountants).

## 8. DEVIATIONS

- **Worker runtime**: a Node worker (`pnpm worker --loop`), not an Edge Function with a pg_net trigger
  (ADR 0014). `WORKER_DATABASE_URL` is required outside local; `DATABASE_URL` is deliberately never read.
- **Webhooks deferred**: inbound handling is prompt 4. Delivery status and wamids are stored but not yet
  updated.
- **No automatic fallback channel** (ADR 0017).
- **New event types**: InvoiceOverdue, ReminderSkipped, ReminderParked, ApprovalExpired,
  ApprovalSuperseded, MessageStateUnknown, MessageReconciled (the drift test is green).
- **`OutboundChannel` + 4-way `SendOutcome`** in `packages/messaging` instead of implementing core's
  `MessageChannel.send`, which cannot express "ambiguous" (ADR 0019). Core is unchanged.
- **Parking**: `next_action_at = 'infinity'` + `parked_reason` instead of NULL, which keeps Prompt 2's NOT
  NULL and its issue H test.
- **Render before the claim**, so a template error can never leave a pending row.
- **SMTP host**: from the operator relay env (`SMTP_HOST`). Tenant-supplied hosts are opt-in
  (`SMTP_ALLOW_TENANT_HOST`) to avoid SSRF.
- **Test edits (and why)**:
  - Prompt 2 fixtures `issue_b_composite_fk.test.sql` and `rls_world.inc` gained `send_state`, because the
    new `messages_out_has_state` CHECK requires it.
  - Mailpit test: compare with CRLF normalised, because SMTP uses CRLF line endings (RFC 5322).
  - Locale test: the expectation was corrected to "Jun 1, 2026" (`formatDueDate` uses DATE_MED).
  - Failpoint proof test: the regex was tightened so a doc comment no longer matches.
  - Kill-switch tests: 10 s adapter timeout (the flake above).

## 9. NOT VERIFIED

- A live WhatsApp send (`smoke:whatsapp` is gated; no credentials).
- A live Slack webhook.
- A real SMTP relay with AUTH/TLS. Only Mailpit was used: plain, no auth.
- Deliverability (SPF/DKIM/DMARC).
- Hosted Supabase: migrations 0007-0008 are NOT pushed there (waiting for your OK).
- The GitHub Actions run itself (nothing pushed).
- Multiple concurrent worker processes against one limiter.

## 10. HANDOFF TO PROMPT 4

- **Message-ID**: `messages.rfc_message_id` = `<idempotency-key-with-dots.dueloop@message_id_domain>`,
  unique per tenant, set before the send (`messageIdFor`). A reply's In-Reply-To/References match it
  exactly. The domain comes from `channel_accounts.config.message_id_domain` (or the from-address domain).
- **Replies → invoices**: `message_invoices (tenant_id, message_id, invoice_id)`. Every outbound reminder
  has exactly one row.
- **WhatsApp**: `messages.provider_message_id` = the wamid from `messages[0].id`. Status webhooks carry
  the same `id`.
  - Meta's docs confirm that the send API accepts `biz_opaque_callback_data` and that status webhooks echo
    it back (verified today: webhooks/reference/messages/status).
  - Recommended change, NOT applied: send the idempotency key as `biz_opaque_callback_data` in
    `buildTemplateRequest`.
- **Unknown resolution (M)**: `WorkerDb.resolveUnknown(messageId, 'sent', nextActionAt)` via
  `reconcileMessage()`, which appends MessageReconciled + ReminderSent and never sends.
- **Approval hook (N)**: `requiresApproval(mode)` in `packages/worker/src/process.ts`; today
  `low_confidence` = `always`.
- **Gates**: the send-time gates run in `sendPath()` in order: kill switch → opt-out → router → limiter →
  approval. Prompt 4 adds the open-blocking-task gate before `decide()` and again at send time.
- **Event names added**: InvoiceOverdue, ReminderSkipped, ReminderParked, ApprovalExpired,
  ApprovalSuperseded, MessageStateUnknown, MessageReconciled. Prompt 1 already has ReplyReceived,
  ReplyClassified, PromiseRecorded, PromiseBroken, DisputeRaised, OptOutRecorded.
- **Webhook assumptions**: no webhook runtime exists yet. Tenant resolution must come from
  `channel_accounts` (`phone_number_id` in config today; prompt 4 adds `external_account_id` with a global
  unique index). The Meta signature is `X-Hub-Signature-256: sha256=<hex HMAC-SHA256(raw body, app
  secret)>`, and the handshake is GET `hub.mode` / `hub.verify_token` / `hub.challenge`, per
  webhooks/create-webhook-endpoint (read today).
- **Alerts**: `alertOnce(deps, alert, period)` de-duplicates through `public.notifications`. Reuse it for
  instant reply alerts.
