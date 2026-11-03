# Redesign Phase 0: inventory

Produced 2 November 2026 on branch `redesign/phase-0` (same commit as `main`, f06c11d) for spec
[REDESIGN.md](REDESIGN.md) v1.1 §0.4. Conflicts with the spec are in [CONFLICTS.md](CONFLICTS.md).

## 1. Stack (installed versions, from `pnpm list` in `apps/web`)

| Area | Package | Installed | Notes |
|---|---|---|---|
| Runtime | Node | 24.19.0 | `.nvmrc`; scripts run `.ts` files with plain `node` (no `tsx`) |
| Package manager | pnpm | 12.15.0 | monorepo: `apps/web` + 21 packages under `packages/` |
| Framework | next | 16.4.3 | **App Router**, Turbopack. Middleware is `apps/web/proxy.ts` (Next 16 name). `apps/web/AGENTS.md`: read `node_modules/next/dist/docs/` before using Next APIs |
| UI runtime | react / react-dom | **19.3.0** | => `@react-three/fiber` major **9** (A2 holds) |
| Language | typescript | 6.0.3 (root) | strict, `noUncheckedIndexedAccess` |
| Styling | tailwindcss / @tailwindcss/turbopack | 4.3.3 | **Tailwind v4** with `@theme inline` in `app/(staff)/globals.css`; `tw-animate-css` 1.4.0 |
| Component kit | shadcn (style `radix-nova`) 4.22.1, radix-ui 1.8.1, class-variance-authority 0.7.1 | | 13 shadcn primitives in `components/ui/`. **Primitive library: Radix** (from the existing `components.json`, §7.3 step 2; Phase 8b added no dependency). 8b added `popover` (8a), `textarea` and a Radix-based `combobox` (CONFLICTS C-40) |
| Icons | lucide-react | 1.61.0 | already present: keep (spec §7) |
| Toasts | sonner | 2.0.8 | used via `components/ui/sonner.tsx` |
| Theme | next-themes | 0.4.6 | only read by `components/ui/sonner.tsx`; no ThemeProvider mounted, no theme switch |
| Validation | zod | 4.6.7 | server actions only; Zod 4 error style `{ error: "…" }` is what the repo uses |
| Forms | react-hook-form, @hookform/resolvers | **not installed** | forms are `useActionState` + server actions, mostly plain FormData |
| Motion | motion / framer-motion | **not installed** | CSS only (`tw-animate-css`) |
| 3D | three, @react-three/fiber | **not installed** | |
| Dates | luxon | 3.7.2 | |
| Auth/data | @supabase/ssr 0.12.7, @supabase/supabase-js 2.118.0 | | |
| Unit tests | vitest | 5.0.5 | root `vitest.config.ts` (+ db, adversarial, load configs) |
| Browser tests | @playwright/test 1.64.1, @axe-core/playwright 4.14.0 | | projects: e2e, security, a11y, lowbandwidth, demo, perf |
| Bundle analysis | @next/bundle-analyzer | not installed | Next 16.4 has a native `next build --analyze` (Turbopack), checked in `next build --help` |
| Lighthouse | lighthouse | not installed | not a repo dependency |

## 2. Route map (every `page.tsx` / `route.ts` in `apps/web/app`)

Route groups: two **root layouts**, `(staff)` (React app) and `(public)` (route handlers that return plain HTML),
plus `app/global-not-found.tsx`.

| Route | File | Screen | Notes |
|---|---|---|---|
| `/` | `(staff)/(app)/page.tsx` | **S05 Overview** | signed-in home; signed-out visitors get 307 to `/login` from `proxy.ts` (see A6 below) |
| `/login` | `(staff)/login/page.tsx` | **S01 + S02** | one page, two tabs (Sign in / Create account) |
| (none) | — | S03 Confirm email | **MISSING**: sign-up shows an inline "Check your inbox" message; no resend endpoint |
| `/onboarding` | `(staff)/onboarding/page.tsx` | S04 | one step: name, time zone, currency, quiet hours |
| `/invoices` | `(staff)/(app)/invoices/page.tsx` | S06 | |
| `/invoices/[id]` | `(staff)/(app)/invoices/[id]/page.tsx` | S07 | |
| `/customers` | `(staff)/(app)/customers/page.tsx` | S08 | |
| `/customers/[id]` | `(staff)/(app)/customers/[id]/page.tsx` | S09 | consent form inline |
| `/inbox` | `(staff)/(app)/inbox/page.tsx` | S10 (list) | inbound threads only |
| `/inbox/[customer]/[channel]` | `(staff)/(app)/inbox/[customer]/[channel]/page.tsx` | S10 (thread) | separate page, not a split view |
| `/approvals` | `(staff)/(app)/approvals/page.tsx` | S11 | grouped by customer; bulk approve; email edit-before-send |
| `/tasks`, `/tasks/[id]` | `(staff)/(app)/tasks/…` | S12 | list + detail pages |
| `/proofs`, `/proofs/[id]` | `(staff)/(app)/proofs/…` | S13 | list + detail pages |
| `/proofs/[id]/file` | `route.ts` | S13 (file) | sandboxed file CSP |
| `/messages` | `(staff)/(app)/messages/page.tsx` | **S14** | spec route `/unknown-sends` |
| `/payments/new?invoice=` | `(staff)/(app)/payments/new/page.tsx` | **S15** | a full page, not a dialog; preview then confirm |
| `/import` | `(staff)/(app)/import/page.tsx` | S16 | client wizard `import-wizard.tsx` (3 cards on one page) |
| `/settings` | `(staff)/(app)/settings/page.tsx` | S17 + S24 | kill switch inline (`kill-switch.tsx`) |
| `/settings/policies` | … | S18 | |
| `/settings/templates` | … | S19 | |
| `/settings/holidays` | … | S20 | |
| `/settings/members` | … | S21 | |
| `/settings/integrations` | … | S22 | email, WhatsApp, Slack, payment accounts |
| `/settings/api-keys` | … | S23 | |
| `/p/[token]` | `(public)/p/[token]/route.ts` | S25 (+S27 via `?done=`) | plain HTML string, `public/pp.css`, optional `pp-copy.js` |
| `/p/[token]/act` | `route.ts` (POST) | S25 actions | pay / promise / proof / copy |
| `/o/[token]` | `(public)/o/[token]/route.ts` | S26 (+S27) | |
| `/o/[token]/unsubscribe` | `route.ts` (POST) | — | RFC 8058 one-click; **UNMAPPED** (no UI) |
| invalid token | `lib/public/html.ts` `invalidLink()` | S28 | one response for every bad link |
| unmatched URL | `app/global-not-found.tsx` | S29 (outside shell) | unstyled on purpose |
| in-shell 404 | `(staff)/(app)/not-found.tsx` | S29 | |
| error boundary | `(staff)/(app)/error.tsx` | S30 | |
| loading | `(staff)/(app)/loading.tsx` | (M13) | |
| `/auth/confirm` | `app/auth/confirm/route.ts` | — | **UNMAPPED**: email-link handler |
| `/auth/auth-code-error` | `(staff)/auth/auth-code-error/page.tsx` | — | **UNMAPPED**: "That link did not work" page |
| `/counters` | `(staff)/(app)/counters/route.ts` | — | **UNMAPPED**: JSON for nav badges (30 s poll) |
| `/exports/{invoices,customers,audit}` | `route.ts` | — | **UNMAPPED**: CSV downloads |
| `/v1/invoices`, `/health`, `/ready` | `route.ts` | — | **UNMAPPED**: API / probes, no UI |
| — | — | **S32 Landing** | **MISSING** (to be added) |

**What `/` serves today (A6):** the signed-in **Overview** (S05). `lib/security-headers.ts:11-17` classes `/` as
`staff`, so `proxy.ts` refreshes the session and redirects signed-out visitors to `/login`; `/` also sends
`X-Robots-Tag: noindex, nofollow`. Sign-in, onboarding and auth confirm all `redirect("/")`. So A6 is **false**: per
the spec I must ask before moving the dashboard, and build S32 at `/welcome` meanwhile (CONFLICTS C-01).

## 3. Shared components (`apps/web/components`)

| File | What | Used by |
|---|---|---|
| `app-nav.tsx` | client nav with counter badges, polls `/counters` every 30 s | `(app)/layout.tsx` |
| `paused-banner.tsx` | tenant / global kill-switch banner | `(app)/layout.tsx` |
| `tenant-switcher.tsx` | plain form, shown only for >1 tenant | `(app)/layout.tsx` |
| `status-badge.tsx` | invoice status as a shadcn Badge, text only (no icon) | S06, S07, S09 |
| `empty-state.tsx` | dashed box, title + children | S05, S06, S08, S10–S14 |
| `action-form.tsx` (`ActionForm`, `SecretOnceForm`) | form bound to a server action + announced result | S07, S09, S17, S20–S23 |
| `action-result.tsx` | ok/error result line | all action forms |
| `payment-plan-form.tsx` | amount/decimal/date/bank-ref/note, Preview → Confirm (fingerprint) | S13 (proof confirm), S15 |
| `ageing-chart.tsx` | CSS bar chart of ageing buckets (inline width style) | S05 |
| `untrusted-text.tsx` (`UntrustedText`, `AiText`) | rule 34: text nodes only, `pre-wrap`, `dir=auto` | most screens |
| `ui/*` | shadcn: alert, badge, button, card, dropdown-menu, input, label, select, separator, skeleton, sonner, table, tabs | everywhere |

## 4. Forms and what they post to

All staff forms are React `<form action={serverAction}>` with `useActionState`. They work without JavaScript, and
the server actions read `FormData` directly (only login and onboarding use a Zod schema). Public forms are plain
HTML POSTs.

| Spec | Real form (file) | Posts to | Fields actually sent |
|---|---|---|---|
| F01/F02 | `login/login-form.tsx` | `signIn` / `signUp` (`login/actions.ts`, Zod: email, password ≥ 8) | email, password |
| F03 | — | **no endpoint** | — |
| F04 | `onboarding/onboarding-form.tsx` | `createBusiness` → RPC `create_tenant` | name, timezone, currency, quietStart, quietEnd (**no country**) |
| F05 | GET forms in `invoices/page.tsx:46` | URL params | q, status, bucket (age), customer; cursor `after` |
| F06 | `approvals/forms.tsx:15` | `decideApproval` → `decide_approval` | approval, decision, note (**required to reject**, see C-12) |
| — | `approvals/forms.tsx:34` | `editApproval` → `edit_approval` | approval, subject, body (email only) |
| — | `approvals/forms.tsx:60` | `bulkApprove` | approval[], confirm_count |
| F07 | `components/payment-plan-form.tsx` | `paymentAction` (preview/confirm) | invoice, amount, decimal (`.`/`,`), date, bank_ref, note, op, fingerprint |
| F08 | `tasks/[id]/task-form.tsx` | `resolveTask` → `resolve_task` / `reopen_task` | task, op, note (required, 3–500) |
| F09 | `proofs/[id]/proof-form.tsx` | `proofDecision` | F07 fields + no_bank_ref, op, reason |
| F10 | `messages/reconcile-form.tsx` | `reconcile` | message, checked, as (`sent`/`not_sent`); **no note** |
| F11 | `customers/[id]/page.tsx:61` | `consentAction` | op (grant/withdraw), customer, channel, source |
| F12 | `import/import-wizard.tsx` | `readColumns`, `previewImport`, `commitBatch`, `errorReport` (Zod mapping/options) | file, mapping JSON, options JSON |
| F13 | `settings/page.tsx:95` | `settingsAction` → `save_tenant_settings` | timezone, quiet_start, quiet_end, approval_mode, promise_acceptance, budget, bank_instructions, proof_ai_extraction (**no business name; one budget**) |
| F14a | `settings/policies/policy-form.tsx` | `policyAction` (op=impact, then confirm=1) → `save_policy` | policy, name, is_default, step_* arrays, escalate, grace |
| F14b | `settings/templates/template-form.tsx` | `templateAction`, `newWhatsAppTemplateAction`, `addStandardTemplatesAction` | |
| F14c | `settings/holidays/page.tsx` | `holidayAction` | op, date, label |
| F15 | `settings/members/page.tsx` | `memberAction` | op (invite/role/remove), email, role, user |
| F16 | `settings/integrations/page.tsx` | `integrationAction` | op, channel, provider, mode, smtp_*, webhook_secret, … |
| F17 | `settings/api-keys/page.tsx` | `apiKeyAction` → `create_api_key` / `revoke_api_key` | op, name, key |
| F18 | `settings/kill-switch.tsx` | `setPaused` → `set_outbound_paused` | paused, confirm (**typed word PAUSE / RESUME**) |
| F19/F20/F21 | HTML in `p/[token]/route.ts`, `o/[token]/route.ts` | `/p/[token]/act`, `/o/[token]` POST | action, promised date, file; CSRF via Fetch Metadata |
| F22 | `invoices/[id]/cancel-promise-form.tsx` | `cancelPromise` → `cancel_promise` | promise, note |
| — | `invoices/[id]/page.tsx:79` | `resumeInvoice` | invoice |
| — | `tenant-switcher.tsx` | `switchTenant` | tenant |
| — | `settings/page.tsx:155` | GET `/exports/audit` | from, to |

## 5. Domain sources

| Concept | Where | Shape |
|---|---|---|
| Invoice status | `packages/core/src/domain/types.ts:13` `INVOICE_STATUSES` | `as const` array, no Zod. `z.enum(INVOICE_STATUSES)` can reuse it without duplication |
| Channel | `packages/core/src/domain/types.ts:4` `CHANNELS` | `['email','whatsapp','sms']` |
| Transitions | `packages/core/src/domain/invoiceState.ts`; DB is final (ADR 0007) | |
| Roles + permission matrix | `packages/authz` `ROLES`, `PERMISSIONS`, `can()`; ADR 0042 table is test-locked | data |
| Nav gating | `apps/web/lib/nav.ts` | |
| Money | `packages/core/src/money.ts`: `currencyExponent`, `parseMajor`, `digitsToMajorString`, `toMajorString`; web display `apps/web/lib/money.ts` `formatMinor` | amounts travel as **text** minor units (bigint-safe), not JS numbers |
| Time | `packages/core/src/time.ts`, `apps/web/lib/time.ts` (`formatDate`, `formatInstant`, `tenantToday`) | IANA zones |
| DB types | `packages/db` (generated) | |

## 6. Critique addendum (checklist §4.1, against the code)

| Screen | Findings |
|---|---|
| Shell | No sidebar; a wrapping top nav (`(app)/layout.tsx:19-39`, `app-nav.tsx:41`). Badges are links but use `bg-primary` (near-black), not lime (`app-nav.tsx:57`). Badge `aria-label` is "N waiting" without the queue name (`app-nav.tsx:57`). Role shown as raw `owner` text (`layout.tsx:30`). No theme control; dark tokens exist under `.dark` but nothing sets it (`globals.css:93`). Skip link present (`layout.tsx:16`). Sending state shown only when paused (`paused-banner.tsx:3`). |
| S01/S02 | Tabs on one card (`login/page.tsx:14`); no show-password; server errors pass `error.message` from Supabase straight to the UI (`login/actions.ts:27,40`), not §5.6 copy; button label "Please wait…" (`login-form.tsx:40`). |
| S04 | Time zone is a 400-item Radix Select, not searchable (`onboarding-form.tsx:27-38`); currency is free text (`:42`); errors show raw RPC text (`actions.ts:33`). |
| S05 | Six equally weighted cards and a period form (`page.tsx:40-88`), no "what needs me" list; the title "Overview" says nothing about waiting work; "Promise-kept rate" uses float maths for display only (`page.tsx:36`). Money per currency joined with " · " (`:33`). Ageing bars are red for every overdue bucket (`ageing-chart.tsx:24`): the "red wall" §2.3 forbids. |
| S06 | Status label is raw enum with `_` replaced (`status-badge.tsx:15`), no icon (C6, D13); overdue/disputed/escalated all `destructive` red (`:5-8`). Filters need a submit click (`invoices/page.tsx:74`). Status `<select>` shows lower-case enum text (`:57`). Pagination is "First page / Next page" cursor only (`:120-131`). Balance right-aligned + tabular (good, C5). |
| S07 | Primary action "Record a payment" is an outline button (`[id]/page.tsx:45`); status badge separate from balance; raw `parked_reason` shown to users (`:64,69`); messages and timeline are separate cards; timeline is oldest-first (`:182`), spec wants newest-first. Customer/AI text is plain text (good, C10). |
| S08 | Columns name/email/phone/language/messages (`customers/page.tsx:50-54`); no balance or consent columns (data not loaded). |
| S09 | Consent shown as a text list with raw channel ids (`[id]/page.tsx:44`); consent form always expanded. |
| S10 | Table of threads; thread on a separate page; no split view. |
| S11 | Grouped by customer, each item has Approve + Reject + an edit `<details>` (`approvals/forms.tsx`); reject needs a reason (`:19`); "stale" after **3 days** (`approvals/page.tsx:11`) while approvals expire after **7** (`supabase/migrations/0008_queue.sql:160`): expiry is never shown (C2). Bulk approve form sits above the list and is the first thing on the page (`page.tsx:34`), with two filled buttons (C4). |
| S12 | Task type shown as raw enum (`tasks/page.tsx:55`); urgent badge red. AI draft labelled "AI-generated, untrusted" (`task-form.tsx:36`) (good). |
| S13 | List + detail pages; decision reuses `PaymentPlanForm` (good: never prefilled). |
| S14 | Title "Messages in an unknown state" vs nav "Unknown sends" (`messages/page.tsx:21` vs `lib/nav.ts:21`); two filled-ish buttons (`reconcile-form.tsx:18-23`). |
| S15 | Full page; Preview (outline) then Confirm; decimal separator choice; `date` max = tenant today (good). |
| S16 | Three numbered cards on one page; no stepper. |
| S17 | Current values shown, then the same values again as an edit form (`settings/page.tsx:61-147`) (C7). Time zone is a free-text field (`:98`); quiet hours are number inputs (`:103`). Settings sub-nav is a row of underlined links (`:39`). Kill switch typed word (C11 partly met). |
| S18–S23 | Each sub-page saves its own way (C7); `ActionForm` result line, no save bar. |
| S25–S28 | Plain HTML, system font, `pp.css` 2.3 KB, copy script 0.6 KB; no Stripe "Pay" when no gateway (good). |
| S29 | `global-not-found.tsx` is deliberately unstyled; in-shell 404 is minimal. |
| S30 | Shows digest only (good). |
| All | No raw hex in components (D12 starts clean); several `h-8` (32 px) controls below the 44 px target (`invoices/page.tsx:49`, `customers/page.tsx:35`, `tenant-switcher.tsx:17`). Every heading is `text-xl font-semibold`, so hierarchy is flat. |

## 7. Baseline

Commands run in this session, 2 November 2026, against the local Supabase stack that was already running.

| Suite | Command | Result |
|---|---|---|
| Unit / contract | `pnpm test` | **788 passed / 788** (47 files). The spec's "819" does not match (C-04) |
| pgTAP | `supabase test db` (first half of `pnpm db:test`) | **1720 / 1721**: `ops_retention.test.sql` #30 fails because the local DB carries migration `0027_mailbox` from the unmerged worktree branch `claude/inbox-functionality-7f64f5`; `main` stops at 0026 |
| DB integration | `npx vitest run --config vitest.db.config.ts` | **159 / 160**: `packages/ops/test-db/ops.test.ts:58` (watchdog chaos, expected 1 alert, got 0); run against the same shared DB |
| Adversarial | `pnpm test:adversarial` | **64 / 64** |
| Playwright e2e / a11y / security / lowbandwidth | `pnpm web:test:e2e` etc. | **NOT RUN**: every script starts with `supabase db reset`, which would wipe the local DB that the other worktrees share |
| Production build | `pnpm --filter @dueloop/web build` | **NOT MEASURED**: the build ran out of memory while collecting page data (15 workers, 2.1 GB free of 15.7 GB) twice. A stale `.next/dev/types` cache from 27 Oct also broke type-checking; I deleted that generated cache |
| Lighthouse | — | **NOT RUN**: needs a production build plus seeded users, and `lighthouse` is not installed |

Clean-baseline plan (needs your go-ahead, see the summary): reset the local DB to `main`'s migrations, rerun every
suite including Playwright, and build with more free memory (or a temporary worker cap) to get first-load JS sizes
and Lighthouse scores.
