# Prompt 6 report: dashboard, public pages, API

Branch `claude/invoice-followup-dashboard-api-58dd61`. Commits 8ef75c3 .. a9eb2b2 (steps 13-16 landed together with
prompt 7 steps 1-3 in a9eb2b2 because the files interleave), plus fixes found later: 84facfc, 69fb511, b6f2a37.
Run on one Windows 10 machine (Docker Desktop, Engine 29.8.0) against the local Supabase stack.

## 1. Built

- packages/authz: the role matrix as data (`PERMISSIONS`, `can()`), rendered into ADR 0042.
- Migrations 0017 (staff RPCs, last-owner guard, nav counters, audit export), 0018 (invoice_list view, inbox
  threads), 0019 (member_has_role), 0020 (public links, rate limits, API keys and idempotency, policy save, template
  edit guard, settings, the inbound-only 'web' channel).
- packages/links: opaque pay and opt-out tokens (32 random bytes, sha256 stored), issue/resolve/mark/revoke.
- apps/web staff screens: overview, invoices, customers, inbox, approvals, tasks, proofs (sandboxed file route),
  payments/new, messages, import, exports, settings (kill switch, members, policies, templates, holidays, API keys,
  integrations), polled counters.
- Public pages as plain HTML route handlers: `/p/<token>` (pay, promise, proof, copy), `/o/<token>` (opt-out,
  one-click unsubscribe); `pp.css`, `pp-copy.js`.
- REST API: `POST/GET /v1/invoices` with hashed keys and idempotency (docs/api.md).
- Worker: links issued before the outbox claim, footer opt-out link, RFC 8058 List-Unsubscribe (https only).
- Playwright projects: e2e (staff), security, a11y, lowbandwidth, demo, perf; `pnpm perf:seed`.
- ADRs 0042-0050; CLAUDE.md rules 33-40; CI phase 6.

## 2. Commands run (this session)

| Command | Result |
|---|---|
| `pnpm lint`, `pnpm typecheck` | exit 0 |
| `pnpm test` | 39 files, 698 tests passed (latest run, after prompt 7) |
| `pnpm db:test` | pgTAP: 26 files, 1708 tests, PASS; integration: 19 files, 159 tests passed |
| `pnpm web:test:e2e` | 99 passed |
| `pnpm web:test:security` | 8 passed |
| `pnpm web:test:a11y` | 13 passed |
| `pnpm web:test:lowbandwidth` | 3 passed |
| `pnpm e2e:demo` | 1 passed (52.3 s) after the time-zone fix in b6f2a37 |
| `pnpm perf:pages` | passed; numbers in section 7 |
| `pnpm verify:all` from a clean clone | see the prompt 7 report, section 2 |

The e2e demo prints a step / assertion / result table; every step passed in the runs above. The same seven steps
pass through `pnpm demo:selftest` (13/13, prompt 7).

## 3. Versions

Node 24.19.0, pnpm 12.15.0, Next.js 16.4.3, React 19.3.0, Tailwind CSS 4.3.3, shadcn CLI ^4.22.1,
@supabase/supabase-js 2.118.0, @supabase/ssr 0.12.7, Playwright 1.64.1 (Chromium), @axe-core/playwright 4.14.0,
zod 4.6.7, luxon 3.7.2, TypeScript 6.0.3, Vitest 5.0.5. No chart or table library: tables are shadcn/ui primitives.

## 4. Issues A-S

| Issue | Status | Evidence | Commit |
|---|---|---|---|
| A signed links | confirmed; opaque random tokens stored hashed instead of HMAC/JWT (ADR 0045) | `links/test/token.test.ts`, pgTAP `web/public_surface` | b6f8d0d |
| B prefetch | confirmed; GET never writes, actions are POSTs | e2e `public-pages.spec.ts`, security suite | b6f8d0d |
| C pay link replacement | confirmed; links issued in the worker before the claim (ADR 0046) | worker tests, e2e demo step 6 | b6f8d0d |
| D WhatsApp + links | confirmed; STOP-and-report: approved templates were not edited; options in ADR 0046 | - | open (decision) |
| E promise from the page | confirmed; enters the reply pipeline on the inbound-only 'web' channel | e2e `public-pages.spec.ts` | b6f8d0d |
| F unsubscribe | confirmed; RFC 8058 header for https links only | `messaging/test/footer-link.test.ts` | b6f8d0d |
| G untrusted text | confirmed; text-only rendering, lint bans on HTML sinks | security suite (stored `<script>`) | d9a7bc1, a9eb2b2 |
| H authorisation | confirmed; every mutation re-checks role and tenant in the DB | e2e `bypass.spec.ts`, `idor.spec.ts`, pgTAP `role_matrix` | 7b32f0c |
| I bigint | confirmed; money read as text, formatted by core | `db/test-db/bigint-json.test.ts`, `web/test/display.test.ts` | d9a7bc1 |
| J time display | confirmed; tenant zone everywhere | `web/test/display.test.ts` | d9a7bc1 |
| K policy edits | confirmed; system step ids, retired ids, next action refresh | pgTAP `web/public_surface` | b6f8d0d |
| L template edits | confirmed; edit guard, `needs_resubmission` for WhatsApp | pgTAP `web/public_surface` | b6f8d0d |
| M members | confirmed; last owner cannot be removed or demoted | `authz/test-db/last-owner.test.ts` | 8ef75c3 |
| N secrets write-only | confirmed; no read path in the UI | e2e, security suite | b6f8d0d |
| O API keys + REST | confirmed; prefix lookup, hashed secret, idempotency | e2e `api.spec.ts` | b6f8d0d |
| P rate limits | confirmed; Postgres fixed window, fail closed (ADR 0047) | pgTAP `web/public_surface` | b6f8d0d |
| Q exports | confirmed; formula neutralisation on every export | e2e `import-export.spec.ts` | ce950e7 |
| R scale | confirmed; keyset paging, indexes, 50k-invoice perf seed | `pnpm perf:pages` | a9eb2b2 |
| S test clock | confirmed, and NOT fully fixed in prompt 6: the e2e demo still depended on the time of day through the tenant's zone (it failed at 20:10 Karachi time). Fixed in prompt 7 | e2e demo asserts the tenant zone | b6f2a37 |

## 5. Permission matrix as enforced

The matrix lives in packages/authz as data. UI gating reads it; the database enforces it independently (RLS and
role checks inside every RPC). Drift: `authz/test/matrix.test.ts` (the ADR table equals the data), e2e
`matrix.spec.ts` (each role sees exactly its screens and actions), `bypass.spec.ts` (each role calling every RPC
directly, bypassing the UI, is refused where the matrix says deny), `idor.spec.ts` (cross-tenant ids), pgTAP
`rls/role_matrix` (every public table x operation x role, now including `kpi_snapshots`). All green in the runs above.

## 6. Security results

- Headers per route class (staff, auth, public, api, file): CSP with per-request nonces and `strict-dynamic`;
  `style-src-attr 'unsafe-inline'` is the one documented exception (ADR 0047); public pages `no-referrer`, `no-store`,
  `noindex`; the file route a sandbox CSP. Asserted by the security suite.
- Build output scanned for test markers and secrets, server log scanned for tokens, contact details and bodies:
  clean. Invalid, expired and revoked links answer identically; timing medians 5.4-6.4 ms in the measured run.
- IDOR and direct-RPC bypass suites green; the adversarial suite from prompt 4 green in the aggregate run.
- Weakened: nothing. Bugs the suites found and fixed: the proxy overwrote the file route's sandbox CSP; the public
  `form-action` blocked the hosted-checkout redirect; `Origin: null` under no-referrer refused our own forms (now
  Fetch Metadata); a missing proof object answered 500; two contrast and one label a11y issue.

## 7. Performance and low bandwidth

Machine: one Windows 10 laptop, local stack, NOT a production measurement.
- Pages on a 50,000-invoice tenant (docs/measurements/perf-pages.txt): invoices 39 ms, overdue filter 40 ms, search
  110 ms, ageing bucket filter 175 ms, customers 40 ms, overview 242 ms (medians, server time). The slowest SQL is the
  ageing KPI (about 200 ms) and the bucket filter (about 138 ms), both computing balances per row.
- Low bandwidth (400 ms RTT, 50 KB/s down, JavaScript off): pay page 2,080 bytes in 2 requests, 1,331 ms; opt-out
  page 619 bytes. Budgets 20 KB and 12 KB: met.

## 8. Decisions needed

Opaque tokens instead of JWT (made: ADR 0045; confirm); link TTLs (pay 60 days, opt-out 365); disputed-invoice pay
page behaviour (while disputed the page shows only an "under review" note, no pay, promise or proof actions); a promise made on the pay page has the power of a thread-matched reply;
no customer name on the pay page; policy save refreshes next actions; WhatsApp template edits require resubmission;
the invite mechanism (owners invite by email address; the answer is the same whether or not the address already has an account); REST inside the web app; Postgres as the rate-limit
store; polling instead of Realtime (ADR 0044); List-Unsubscribe only for https links. All listed in
docs/limitations.md.

## 9. Deviations from the guide

The build guide was not available; the work followed the prompt and the ADRs. Links are not reused (a fresh pair per
reminder, ADR 0046). WhatsApp reminders carry no pay link (issue D). Step labels in the policy editor are not
supported. Onboarding creates no templates or sending account. No separate sign-in rate limit.

## 10. Not verified

Live Stripe Checkout, live WhatsApp templates with links, real mailbox deliverability (spam placement), screen-reader
testing, any browser other than Chromium, any machine other than the one above, hosted Supabase.

## 11. Handoff to prompt 7 (as delivered)

Prompt 7 ran in the same session and consumed this handoff directly: the env schema (packages/config, generated
`.env.example` and docs/env-reference.md: secret / required by / used by), the four services and their commands
(docs/self-hosting.md), deployment assumptions (`PUBLIC_APP_URL` https, `TRUST_PROXY_HOPS`), the data flows
(docs/data-handling.md), the limitations list (docs/limitations.md), and what the demo and the clean-clone job must
start and cover (docs/demo-script.md, `.github/workflows/clean-clone.yml`).
