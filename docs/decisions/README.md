# Architecture decision records

One file per decision, numbered in the order they were made. A later ADR may refine an earlier one; neither is edited
after the fact except to add a pointer. `pnpm docs:check` fails when a file here is missing from this index.

| ADR | Decision |
|---|---|
| [0001](0001-pure-core-injected-clock.md) | Pure core with an injected clock |
| [0002](0002-money-representation.md) | Money as integer minor units with ISO 4217 exponents |
| [0003](0003-time-window-design.md) | Send-window design and DST handling |
| [0004](0004-tooling-versions.md) | Tooling versions and TypeScript runner |
| [0005](0005-schema-conventions.md) | Schema conventions (tenant_id everywhere, composite foreign keys) |
| [0006](0006-balance-derivation.md) | The balance is derived, never stored |
| [0007](0007-status-transitions-in-db.md) | Invoice status transitions are enforced by the database |
| [0008](0008-rls-role-matrix.md) | RLS role matrix |
| [0009](0009-event-immutability-and-tenant-removal.md) | invoice_events is immutable; tenant removal is the only way events disappear |
| [0010](0010-import-rules.md) | Import rules |
| [0011](0011-supabase-js-type-checking.md) | Type-checking packages that use supabase-js |
| [0012](0012-role-matrix-sending.md) | Role matrix additions for sending (prompt 3) |
| [0013](0013-send-protocol-at-most-once.md) | Send protocol: outbox, at most once, unknown is never resent |
| [0014](0014-queue-and-worker-runtime.md) | Queue (pgmq + pg_cron) and a Node worker instead of an Edge Function |
| [0015](0015-approval-semantics.md) | Approval semantics |
| [0016](0016-kill-switch-and-pacing.md) | Kill switch and pacing |
| [0017](0017-routing-and-consent.md) | Routing and consent; no automatic fallback |
| [0018](0018-budget-semantics.md) | Message budget semantics |
| [0019](0019-outbound-channel-contract.md) | OutboundChannel: a four-way send outcome outside core |
| [0020](0020-provider-error-classification.md) | Provider error classification |
| [0021](0021-alerts-logging-secrets.md) | Alerts, logging and secrets |
| [0022](0022-role-matrix-replies.md) | Role matrix additions for replies and promises (prompt 4) |
| [0023](0023-webhook-runtime.md) | The webhook runtime |
| [0024](0024-inbound-pipeline-exactly-once.md) | Inbound pipeline and exactly-once effects |
| [0025](0025-reply-matching.md) | Matching replies to invoices (never guess) |
| [0026](0026-spoofing-stance.md) | Spoofing stance (issue J) |
| [0027](0027-promise-lifecycle.md) | Promise lifecycle (issues D, E, G) |
| [0028](0028-task-model-and-blocking.md) | Human tasks and reminder blocking |
| [0029](0029-classifier-boundary.md) | Classifier boundary, prompt, thresholds and evaluation |
| [0030](0030-inbound-pii-and-purge.md) | Inbound PII, logging and purge (rule 25) |
| [0031](0031-imap-poller.md) | IMAP poller, MIME parsing and the test server |
| [0032](0032-role-matrix-payments.md) | Role matrix additions for payments (prompt 5) |
| [0033](0033-ledger-model.md) | The money-in ledger: receipts, applied payments, credits (prompt 5, issue B) |
| [0034](0034-confirmation-pipeline.md) | The payment confirmation pipeline and idempotency (prompt 5) |
| [0035](0035-refunds-as-tasks.md) | Refunds, chargebacks and failures after success are tasks (prompt 5, issue E) |
| [0036](0036-link-lifetime.md) | Payment link lifetime (prompt 5, issue F) |
| [0037](0037-webhook-signing-tokens-stripe.md) | Webhook signing, opaque tokens, and the Stripe adapter (prompt 5, issues G, H, O) |
| [0038](0038-minor-units-provider.md) | Minor units versus the provider (prompt 5, issue I) |
| [0039](0039-receipts-outbox.md) | Receipts as a transactional send in the prompt 3 outbox (prompt 5, issue K) |
| [0040](0040-proof-inbox-data-flow.md) | Proof-of-payment inbox and its data flow (prompt 5, issue M) |
| [0041](0041-kpi-definitions.md) | KPI definitions (prompt 5, issue P) |
| [0042](0042-role-matrix-web.md) | Role matrix for the web app, as data (prompt 6) |
| [0043](0043-server-side-auth-and-tenant.md) | Server-side authentication and tenant derivation (prompt 6, issue H) |
| [0044](0044-realtime-or-polling.md) | Nav counters by polling, not Realtime (prompt 6 step 7) |
| [0045](0045-opaque-tokens-and-public-pages.md) | Opaque public-link tokens and the public page security model (prompt 6, issues A, B, C, E, F) |
| [0046](0046-link-issuance-in-the-worker.md) | Link issuance in the worker (prompt 6, issues C, D) |
| [0047](0047-rate-limits-and-client-ip.md) | Rate limits in Postgres; client IP; CSP exceptions (prompt 6, issue P) |
| [0048](0048-rest-api-and-keys.md) | REST API (POST /v1/invoices) and API keys (prompt 6, issue O) |
| [0049](0049-editor-semantics.md) | Policy, template, settings and member editors (prompt 6, issues K, L, M, N) |
| [0050](0050-test-only-code-and-a11y-method.md) | Test-only code policy; a11y and low-bandwidth method (prompt 6, issues S, step 14) |
| [0051](0051-ops-retention-erasure.md) | Schema guard, heartbeats, retention, erasure and suppression (prompt 7 steps 2-3) |
| [0052](0052-stale-queue-jobs.md) | Stale queue jobs are dropped before decide() (bug found in prompt 7 verification) |
| [0053](0053-openai-provider.md) | OpenAI as a second model provider for replies and proof hints |
