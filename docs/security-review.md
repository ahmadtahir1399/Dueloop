# Security review (prompt 7 step 8)

Reviewer: the engineering pass that built prompt 7, on 2026-10-29, against the local stack on one Windows 10 machine.
This is a self-review by the same process that wrote the code, not an independent audit. Commands named below were
run in this session; anything that was not is marked NOT VERIFIED. Threats per component: docs/threat-model.md.

## (a) Rule audit: CLAUDE.md rules 1-46 and what enforces them

"Convention only" means no automated check exists: that is a finding in itself (see the summary at the end).

| # | Rule (short) | Enforcement |
|---|---|---|
| 1 | Core is pure | ESLint `no-restricted-properties`/`-globals` on packages/core (clock, randomness, I/O); `core/test/lint-rules.test.ts` |
| 2 | Dependencies point inward | ESLint `no-restricted-imports` (core imports only luxon); repo:audit "runtime imports are declared dependencies" |
| 3 | Money: integer minor units | core money types + `core/test/money*.test.ts`; `db/test-db/bigint-json.test.ts`; pgTAP `integrity/constraints` |
| 4 | IANA time zones | `isIanaZone` checks + drift test; pgTAP `issues/issue_i_timezone` |
| 5 | Only the state machine changes status | pgTAP `integrity/transitions_all_pairs`, `issues/issue_d_transitions`; `core/test/invoiceState.test.ts` |
| 6 | "Already paid" never closes | `core/test/reply.test.ts`; adversarial suite; demo:selftest step 5 |
| 7 | Stable idempotency key per outbound action | `worker/test-db/chaos.test.ts` (key counted per adapter call); outbox unique key |
| 8 | Never invent library APIs | convention only (docs checked and cited in ADRs) |
| 9 | Never claim a command passed without running it | convention only; verify:all writes `.reports/verify-all.json` as the record |
| 10 | Failing test first for bug fixes | convention only (followed for ADR 0052 and the erase re-run fix in this prompt) |
| 11 | Public tables: tenant_id + RLS + tests | `pnpm db:rls-check`; pgTAP `rls/catalog`, `rls/role_matrix`; `db:catalog-audit` (no table without RLS) |
| 12 | Service-role key never in browser/NEXT_PUBLIC/log/repo | `web/test/boundaries.test.ts`; security suite build scan; repo:audit secrets; image scans |
| 13 | Composite FKs with tenant_id | pgTAP `issues/issue_b_composite_fk` |
| 14 | Uploads untrusted; formula neutralisation | `ingest/test/units.test.ts`; `proofs/test-adversarial/proof-abuse.test.ts`; e2e `import-export.spec.ts` |
| 15 | DB invariants tested against the real DB | the whole `test-db` + pgTAP layer (`pnpm db:test`) |
| 16 | Approval authorises one key, re-validated before send | pgTAP `sending/approvals_rpc`; `worker/test-db/gates.test.ts` |
| 17 | Unknown state never resent | `worker/test-db/chaos.test.ts` (failpoints, SIGKILL; tightened in this prompt, ADR 0052) |
| 18 | Kill switch before every send | `worker/test-db/gates.test.ts` (kill switch mid-batch) |
| 19 | Secrets only in Vault/env | Vault RPCs (`set_payment_secret`, channel secrets); repo:audit; security suite log scan |
| 20 | No bodies/contact details in logs | ops scrubber tests (`ops/test/ops.test.ts`); security suite server-log scan |
| 21 | Customer text is data; model output schema-validated | `classifier/test/classifier.test.ts`; `inbound/test-adversarial/adversarial.test.ts` |
| 22 | Only planReplyOutcome + state machine change state from a reply | `inbound/test-db/replies.test.ts`; adversarial suite |
| 23 | Webhook signature over raw body, unverified rejected | `webhooks/test-adversarial/*.test.ts`; `webhooks/test/webhook.contract.test.ts` |
| 24 | Never guess reply matching | `inbound/test-db/replies.test.ts` (ambiguous -> task) |
| 25 | Inbound payloads are PII, purged | pgTAP `integrity/events_and_purge`; retention:run (`ops/test-db/ops.test.ts`) |
| 26 | Model dates validated | `core/test/reply.test.ts` (validatePromiseDate) |
| 27 | Only verified provider or authorised human confirms money | `worker/test-db/payments*.test.ts`; proof tests |
| 28 | received = applied + credit | `pnpm payments:integrity`; pgTAP `payments/ledger`; backup drill; erasure test |
| 29 | Payment application idempotent + row lock | `worker/test-db/payments-chaos.test.ts` |
| 30 | Tenant/invoice from our rows, never payload | `webhooks/test-adversarial/payment-webhook-abuse.test.ts` |
| 31 | Proof files are PII; extracted text never an amount | `proofs/test/proofs.test.ts`; adversarial proof tests |
| 32 | Receipts use the same outbox rules | `worker/test-db/payments.test.ts` (receipts) |
| 33 | UI hides, DB decides; role matrix as data | `authz/test/matrix.test.ts`; e2e `matrix`, `bypass`, `idor`; pgTAP `rls/role_matrix` |
| 34 | Customer/model text rendered as text only | ESLint bans `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML` in the web app; security suite stores `<script>` in tenant data and checks the public pages escape it |
| 35 | GET never changes state | e2e `public-pages.spec.ts`; security suite |
| 36 | Tokens random, hashed, never logged/leaked | `links/test/token.test.ts`; security suite (Referer, log scan); pgTAP `web/public_surface` |
| 37 | Secrets never in client bundle/response/log; write-only in UI | security suite build + response scans; integrations page has no read path |
| 38 | Money via core, tenant time zone | `web/test/display.test.ts` |
| 39 | Public endpoints rate-limited, uniform invalid answer | security suite (timing medians, uniform 404); pgTAP rate limits |
| 40 | No UI action sends/changes state except via pipelines | e2e `parity.spec.ts`, `actions.spec.ts` |
| 41 | Demo code/credentials never in production | `pnpm images:smoke` scans; security suite build markers; `demo/test/safety.test.ts` (no migration/seed passwords) |
| 42 | No unbacked measurements/claims in docs | repo:audit claims audit |
| 43 | No invented contacts/SLAs/prices/legal terms | convention + TODO placeholders; partly the claims audit |
| 44 | Documented commands executed in CI or marked | `pnpm docs:check` (step 10) |
| 45 | Schema-version guard | `ops/test-db/ops.test.ts` (worker refuses a newer DB); `ops/test/ops.test.ts` (constant = newest migration) |
| 46 | Secrets in history are leaked | repo:audit history scan with the planted-secret proof |

Rules with no automated enforcement: 8, 9, 10, 43 (partly). They govern how work is done, not what the code does;
the record for 9 is `.reports/verify-all.json`.

## (b) Catalog audit (`pnpm db:catalog-audit`, run on a freshly reset local database)

| Check | Result |
|---|---|
| Public tables without RLS | none |
| INSERT/ALL policies without WITH CHECK | none |
| Views in public without security_invoker | none |
| Public Storage buckets | none |
| SECURITY DEFINER functions executable by anon | none |
| SECURITY DEFINER functions executable by authenticated | 20, all accepted: 17 `private.*_impl` RPCs reached only through security-invoker wrappers (the `private` schema is not exposed by the API, `config.toml` schemas = public, graphql_public) and each re-checks role and tenant; `is_globally_paused_impl` (returns one flag); `my_tenant_ids`, `require_owner` (RLS helpers) |
| Default privileges granting to anon/authenticated | 15 entries, all Supabase platform defaults for objects owned by `supabase_admin` (public, graphql, graphql_public, supabase_functions) and `postgres` in `storage`. Our migrations create objects as `postgres` in public/private, enable RLS on every public table and revoke function execute explicitly |

The script lists each accepted item with its reason and exits 1 on anything new (proven: a probe table without RLS
made it fail). Hosted-project catalog: NOT VERIFIED.

## (c) Supply chain

- `pnpm audit` (2026-10-29): 1 low advisory, GHSA-gcqx-w48m-w2h4 in `deepmerge` 4.2.0-4.3.1, reached only through the
  `shadcn` CLI in apps/web (a code generator; no runtime import), no patched version. Accepted, recorded as F6.
- Install scripts: pnpm runs no dependency build scripts unless allowed; `pnpm-workspace.yaml` `allowBuilds` lists
  `sharp: false` and `unrs-resolver: false` explicitly. Prebuilt platform binaries come as optional packages.
- Lockfile: CI and the images install with `--frozen-lockfile`.
- Licences (`pnpm licences:report`, production dependencies of all workspace packages, 497 packages): MIT 404,
  ISC 23, BSD-2/3 18, Apache-2.0 9 and other permissive licences; 33 optional platform packages are not installed on
  this machine (licence not readable here). Review items: `@img/sharp-*` prebuilt binaries bundle libvips under
  LGPL-3.0-or-later (pulled in by Next.js; also in the web image); `@zone-eu/mailsplit` is MIT OR EUPL-1.1+ (MIT
  chosen by the licensee). No GPL/AGPL code was found in the declared licences. A declared licence field can be
  wrong; this is not legal advice.
- No container vulnerability scanner was run (none installed; NOT VERIFIED).

## (d) Suites re-run

Re-run in this session: the security suite (8 passed), accessibility (13), low bandwidth (3), staff e2e (99), the
e2e demo (1), DB tests incl. chaos (pgTAP PASS, 158 integration), image smoke, backup drill, demo selftest (13/13).
The adversarial suite and the full aggregate are re-run by `pnpm verify:all` in step 14 (results in the report).

## Findings

| Id | Severity | Finding | Status |
|---|---|---|---|
| F1 | High | A redelivered queue job (crash between recording a send and acking it) sent the NEXT reminder step seconds after the first, and could send while the invoice was parked for a human after an unknown message (rule 17) | Fixed: ADR 0052; failing tests first; SIGKILL test stable |
| F2 | Medium | `@dueloop/db` imported `@dueloop/core` without declaring it: a production install (the image) crashed at start | Fixed; repo:audit check added and proven on the old manifest |
| F3 | Medium | A logical backup restored by the documented procedure alone gives a database where every service refuses to start and nothing is scheduled or queued (no migration history, queues, cron jobs) | Fixed for those: extra dumps + `post-restore.sql`, verified by `pnpm backup:drill` |
| F4 | Medium | The same backup does not contain Vault secrets (channel/payment credentials) or Storage files (proofs) | Open (documented): runbook gives the manual steps; NOT automated |
| F5 | Low | Customer erasure could not be re-run after a failed storage call (unique event key) | Fixed (migration 0022 before first commit) with a test |
| F6 | Low | `deepmerge` advisory via the `shadcn` CLI | Accepted: not in a runtime path; no patch exists |
| F7 | Low | Committed fixtures used registrable domains (`example.de` etc., `x.com`) and a non-fictional US number | Fixed; repo:audit fixture-PII check |
| F8 | Info | The service-role key can read every Vault secret, and Supabase notes revoking that has no effect | Residual risk (threat model): the key stays server-side only |
| F9 | Low | Worker, processor and webhooks exit when the database connection is lost; they rely on a supervisor to restart | Open: compose uses `restart: unless-stopped`; the demo restarts them on reset |
| F10 | Low | Secret scanning is pattern-based (no entropy analysis, no third-party scanner) | Open: limitations.md |
| F11 | Info | LGPL-3.0-or-later libvips binaries ship inside the web image | Open: licence review before distributing images (DECISION) |
| F12 | Medium | Real-host deployment, hosted Supabase behaviour and the clean-clone CI job have not been run | Open: NOT VERIFIED |

No finding was downgraded to pass; open items are repeated in docs/limitations.md.
