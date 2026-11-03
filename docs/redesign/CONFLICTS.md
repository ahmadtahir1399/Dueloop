# Redesign: conflicts between the spec and the code

Each item: what the spec says, what the code does, and what I propose. Status **OPEN** means a user decision is
needed. **DEFAULT** means the spec's §11 default applies until the user says otherwise.

## Routing, security and rendering

**C-01 · `/` is the dashboard (A6 false) · OPEN.** Spec: landing (S32) at `/`, Overview at `/overview`. Code: `/` is
Overview (`app/(staff)/(app)/page.tsx`), classed `staff` in `lib/security-headers.ts:16`, so signed-out visitors
get a redirect to `/login`. `redirect("/")` appears in `login/actions.ts:28,43`, `onboarding/actions.ts:39`,
`onboarding/page.tsx:10` and `auth/confirm/route.ts:9`, and in e2e specs. Proposal (spec A6): build S32 at `/welcome`
now; move later only if you say so.

**C-02 · Static landing vs nonce CSP · OPEN.** Spec §4.9 / §8.2: render S32 statically. Code: every page gets a
per-request nonce CSP with `'strict-dynamic'` (`proxy.ts`, `security-headers.ts:33`), and the staff root layout calls
`connection()` to force dynamic rendering so the nonce reaches the scripts (`app/(staff)/layout.tsx:12-15`). A
static HTML page cannot carry a per-request nonce, so its scripts would be blocked. Options: (a) render S32
dynamically in its own root layout (no DB work, just HTML per request; keeps the CSP unchanged; my recommendation);
(b) a different CSP for S32 (hashes or `'self'` scripts): a security-header change outside §10.2.

**C-03 · Landing needs its own route class · OPEN.** Indexing S32 (§10.2 item 8) and serving it without the session
redirect means adding a route class (e.g. `marketing`) to `routeClass()` / `classHeaders()` and the proxy: no
session refresh, `X-Robots-Tag` not sent, the same CSP. That is an edit to `lib/security-headers.ts` and its tests.
I read §10.2 item 8 as allowing exactly this; please confirm.

## Baseline numbers

**C-04 · Test counts differ from the spec.** Spec D9: 819 unit / 160 integration. Measured: 788 unit (47 files),
160 DB-integration tests (159 pass on the shared DB), 1721 pgTAP, 64 adversarial. D9 will use the measured counts.

**C-05 · Baseline not clean on the shared local DB · OPEN.** The local DB has migration `0027_mailbox` from the
unmerged branch `claude/inbox-functionality-7f64f5` (a separate worktree). That breaks one pgTAP check, and maybe the
ops watchdog test. Every Playwright script runs `supabase db reset`. Question: may I reset the local DB to `main`'s
migrations (the other worktree can re-apply 0027)?

**C-06 · Production build runs out of memory · OPEN.** `next build` OOMs while collecting page data (15 workers,
about 2 GB free). The worker count can only be capped by `experimental.cpus` in `next.config.ts`, which §10.2 does
not allow. Options: free memory and retry; or allow a temporary, uncommitted cap for measuring only.

**C-07 · Spec commands that do not exist.** The D1 command (pnpm + tsx): `tsx` is not installed and the repo runs `.ts` with
plain `node`. I'll use `node scripts/check-contrast.ts` and add it as a package script. Also, `pnpm docs:check` checks
every `pnpm <name>` in Markdown, and `REDESIGN.md` mentions that tsx command, so committing the spec fails `docs:check` until
that script exists. `@next/bundle-analyzer` (D8): Next 16.4 has `next build --analyze` built in. Proposal: use that
and don't add the dependency.

## Fonts, theme, tokens

**C-08 · System fonts were a deliberate choice.** `app/(staff)/layout.tsx:12` says "System font stack only (no web
fonts, no third-party requests)". `next/font/google` self-hosts at build time (`font-src 'self'` already allows that),
so the spec does not break the CSP. But the build machine/CI must reach Google Fonts **at build time**. VERIFY that the
Docker build has network access, or vendor the font files and use `next/font/local`. Public pages (S25–S28) keep the
system font (§4.7, low-bandwidth budget in `e2e/lowbandwidth`).

**C-09 · Theme mechanism · SUPERSEDED by v1.2 (C-36).** The existing dark variant is the `.dark` class (`globals.css:5,93`) from shadcn, and
`next-themes` is installed but unmounted. The spec wants `data-theme` + cookie `dl-theme`. Proposal: switch the
custom variant to `[data-theme=dark]` + the `prefers-color-scheme` rule, set by the server from the cookie (no inline
script, so no nonce issue), and drop `next-themes` from `sonner.tsx` (theme comes from the same cookie).

**C-10 · Tokens vs shadcn variables.** Tailwind v4 + shadcn: components use `bg-primary`, `text-muted-foreground`
and so on. Proposal: `tokens.css` defines the spec's `--color-*` tokens, and the shadcn variables (`--primary`,
`--background`, …) are mapped onto them in `@theme`. Existing primitives restyle without a rewrite, and D12 holds.

## Screens: data the spec assumes but the code does not load

Showing these needs new queries, which is a data-flow change (§10.1). Each needs a yes/no.

**C-11 · S05 Overview · OPEN.** Spec KPIs: Outstanding, Overdue, Promised (+ next due), Collected this month; a
merged "Needs attention" list; balance by status. Code (`lib/data/overview.ts`): overdue per currency, recovered in
period, promise-kept rate, average days to pay, messages + cost, ageing buckets, a period selector. Counts for the
greeting exist (`nav_counters`). Proposal: keep the existing KPI data and restyle it into the spec layout. The
"Needs attention" list shows the four queue counts as linked rows (no new queries), unless you allow read-only
queries for the top items.

**C-12 · S11 Approvals · OPEN.** (a) Reject **requires** a reason of at least 3 characters, checked in the server action
(`approvals/actions.ts:16`); spec F06 says optional. Keep it required. (b) Bulk approve with a typed count and email
edit-before-send exist and are not in the spec; keep both, restyled. (c) "Reminder 2 of 4" and "will send at Tue 3 Nov
09:00" are not loaded; I'll drop them (expiry, `requested_at + 7 days`, is derivable and will be shown). (d) Code
marks items "stale" after 3 days; spec says show expiry. I'll show both.

**C-13 · S07 Pay link card · cannot be built.** Tokens are stored only as SHA-256 hashes (ADR 0045), so the server
cannot show or copy an active pay link. I'll drop the card. "More" menu actions write-off / cancel: no such
actions exist, so the menu holds only what exists (resume, cancel promise).

**C-14 · S06 Invoices.** Status tabs with counts: no count query (C-11 rule). "Next step" column: not in the list
query, so it is removed (Q7 default). "1–25 of 46": cursor pagination has no total, so I keep First/Next. The
existing filter is "Age" bucket, not "Due".

**C-15 · S08/S09 Customers.** Spec columns Open invoices, Balance and Consent are not in the list query. Keep the
existing columns, restyled. S09 "Conversation" block: link to the existing inbox thread instead of new queries.

**C-16 · S10 Inbox.** Inbox lists inbound threads; the thread is its own page. A desktop split view is a layout
change only (thread page rendered beside the list via a nested layout), with no new data. OK? On `main`, email replies
are not read: show the notice.

**C-17 · S14 Unknown sends.** Route is `/messages`. Outcomes are `sent` / `not_sent` plus a required "I checked"
checkbox; there is **no note field**. F10's note is dropped. Labels stay "It was sent" / "It was not sent" (spec
"Delivered" claims more than the provider told us).

**C-18 · S15 Record payment is a page with Preview → Confirm.** Spec: a 520 px dialog over S07 and one submit.
The fingerprint step is a safety feature (re-plans on the server, records only if unchanged), so I keep the two
steps. Proposal: keep `/payments/new` as a page styled as a centred panel; optionally make it a Next intercepting-route
dialog over S07 later. The decimal-separator choice (`.` or `,`) exists; the spec's Q11 default (`.` only) would
remove a feature, so I keep it.

**C-19 · S17 Settings · OPEN.** No business-name edit in `save_tenant_settings`, so F13's businessName is dropped.
The budget is **one** monthly amount in minor units of the tenant currency for WhatsApp + SMS together (email
unlimited; 0 blocks them), which answers Q13: money, not count. Extra fields the spec omits: approval mode, promise
acceptance, bank instructions, AI proof reading, audit export. Kept.

**C-20 · S24 Kill switch confirmation · OPEN.** Code: type `PAUSE` / `RESUME` (`settings/kill-switch.tsx`, checked in
`settings/actions.ts:13`); resume also needs typing. Spec: type the business name to stop, no typing to resume.
Changing it changes a server action's input check (§10.1) and e2e tests. Proposal: keep PAUSE/RESUME and adopt only
the dialog styling.

**C-21 · S01–S04 auth.** No separate `/sign-up`; sign-up is a tab on `/login` (proposal: keep one route, two
panels, with the beat-0 still; or add `/sign-up` as a second page with the same server action: allowed?). No S03
page and no resend endpoint: S03 becomes the existing inline message, with no resend button (F03 dropped). No reset
route (Q1: hide "Forgot?"). Onboarding has no country field and no sender step; quiet hours ARE collected. Proposal:
one form split into 2 visual steps (Business · Time & money), with an info note that a sender address must be set in
Settings › Integrations before anything is sent. Supabase's raw error text is shown on sign-in failure; mapping it to
§5.6 copy changes only display text (allowed?).

## Forms

**C-22 · RHF on public pages is impossible by design.** F19–F21 live on plain-HTML route handlers with no React and
no framework JS (ADR 0045, ADR 0050 low-bandwidth budget). Adding React there breaks those budgets. Proposal: F19–F21
stay native HTML forms with native constraints (`required`, `min`, `accept`) and get only CSS restyling.

**C-23 · RHF + progressive enhancement.** Staff forms work without JavaScript today (`kill-switch.tsx:10` comment,
server actions with `useActionState`). Proposal: RHF validates on the client, then submits the same `FormData` to the
same action. Without JS the native form still posts. Server actions keep their existing parsing, so D10 holds. The
spec's "form output type equals request type" test does not fit: actions take `FormData`, not typed JSON. Instead,
each form schema will be tested against the field names the action reads.

**C-24 · Money schema.** Spec §5.2 `MinorUnits = z.number()` and an `Intl`-based `minorDigits` / `parseMajorToMinor`.
Code: amounts are bigint-safe **text** and core already has `currencyExponent` / `parseMajor` /
`digitsToMajorString`. Proposal: the web domain schemas use core's functions and text minor units, so nothing is
duplicated or converted to float.

## Landing page and 3D

**C-25 · Images.** `pnpm-workspace.yaml` disables `sharp`'s build script. `next/image` optimisation needs sharp at
runtime (VERIFY for 16.4). The beat stills are pre-encoded AVIF/WebP, so I plan `next/image` with `unoptimized` (or a
plain `<img>` with width/height). No runtime image work on the 1 GB server.

**C-26 · © line and name (Q20/Q12).** Default "© 2026 Dueloop", noted here: the name is not trademark-checked.

**C-27 · Pricing (Q18), legal pages (Q19), analytics (Q21).** None exist, so none are rendered.

## Found during the build (3 November 2026)

**Decisions taken when the user said "build everything":** landing page at `/` (user's call), Overview moved to
`/overview`, auth at `/sign-in` and `/sign-up` (`/login` redirects), landing rendered per request with the
unchanged nonce CSP (C-02 option a), new route class `marketing` for `/` only (C-03), existing data only (C-11 to
C-17), PAUSE/RESUME kept (C-20), required reject reason and the Preview → Confirm payment kept (C-12, C-18).

**C-28 · Damping constant.** §6.2.2 gives λ = 6 and also "settles in about 120 ms"; λ = 6 needs ~0.5 s. The scene
uses λ = 25 for camera, card and pointer (≈120 ms). `keyframes.damp` defaults to 6.

**C-29 · The committed spec is v1.0 · RESOLVED in Phase 8a: v1.2 is now committed.** `docs/redesign/REDESIGN.md` in the repo is **v1.0** (no landing page,
no §4.9 or §6.2). The build follows **v1.1**, which the user supplied in the chat. Please commit v1.1 over the file.
`test/landing-copy.test.ts` reports its copy check as **skipped** until §4.9.4 is in the file.

**C-30 · Stills are WebP only.** §6.2.6 asks for AVIF and WebP. `sharp` is disabled in this repo and browsers have
no canvas AVIF encoder, so the stills script writes WebP (and a PNG for Open Graph).

**C-31 · 3D lighting and tilt.** (a) three.js r155+ uses physical light units, so the spec's 0.6 / 0.9 / 0.25
intensities rendered the cards grey; the scene multiplies them by π (rim ×12). (b) "Group tilt X −18°" showed the
ring from below in three's convention; the scene uses +18°, which gives the intended view from slightly above. Both
were checked by looking at rendered stills.

**C-32 · Custom select and date fields (user request).** The user asked for custom controls instead of native ones
(§7 prefers native `<select>` and `<input type="date">`). Built: `components/ui/choice-select.tsx` (Radix Select
listbox, posts a hidden input) and `components/ui/date-picker.tsx` (typeable YYYY-MM-DD input plus a calendar
popover with keyboard navigation). Consequences: without JavaScript a custom select cannot be changed (it posts its
default). e2e specs that used `selectOption` now use `e2e/support/choice.ts`. Public pay/opt-out pages keep native
controls (no React there by design, C-22).

**C-33 · The repo's `.env` points at a hosted Supabase project.** `SUPABASE_URL`, `DATABASE_URL`, `DIRECT_URL`,
`SUPABASE_DB_URL` and `WORKER_DATABASE_URL` in the root `.env` point at `*.supabase.co`, not the local stack. A dev
server started with plain `pnpm dev` talks to that project. During this build one dev server did, for a short time:
it served pages and received two failed sign-in attempts for `owner@e2e.test` (a user that does not exist there).
Nothing was written. All later checks ran with every database/auth variable overridden to the local stack.

**C-34 · Forms not moved to React Hook Form.** The import wizard (F12: file + state machine), policy editor (F14a:
dynamic step rows + impact check), template editor (F14b) and integrations (F16) keep their existing server-action
forms, restyled. One-button forms (resume, withdraw, revoke, remove, tenant switch) have no fields to validate. Every
other form in §5.3 uses RHF + zodResolver. D11 is therefore **partial**.

**C-35 · Not built or not measured.** ⌘K is a focus shortcut into the existing invoice search (no command dialog);
queue items do not animate out (M5) or move focus to the next item; S10 is not a split view; S15 stays a page;
Lighthouse (D6/D19), bundle size (D8), Core Web Vitals (D7) and the full Playwright suites need the production build
and a DB reset (C-05, C-06) and were **not run**.

## Phase 8 (spec v1.2, 3 November 2026)

**C-36 · 8a: why the theme buttons "did not work" (B5) · FIXED.** Reproduced on the v1.1 build (commit 21aa649), with
a dev server and with a production build (`next start`, real nonce CSP), both against the local stack. Findings:

1. **The only control was hidden, and only in the staff app.** System / Light / Dark lived inside the avatar
   `<details>` menu (`components/shell/shell-header.tsx`, v1.1). There was no ◐ header button (§3.1.4), and no
   control at all on the landing page, sign-in, sign-up or onboarding.
2. **The landing page ignored the choice.** Its root layout (`app/(marketing)/layout.tsx`, v1.1) never read the
   `dl-theme` cookie and rendered `<html>` without `data-theme`, so S32 always followed the OS. Picking Light in the
   app did nothing on the landing page.
3. **Every click was a full server round trip with no feedback.** The buttons submitted a Server Action that set an
   httpOnly cookie; Next.js then re-rendered the whole current page on the server (every data query of that page)
   before anything changed, including the pressed state. Measured on this machine with a local database: 350–435 ms
   per click in dev, 2.1 s for the first click on the production build, then about 50 ms. In one real mouse test the
   screen had still not changed 2 s after the click. A second click while one was pending aborted the first
   (`POST /overview … ERR_ABORTED` in the network log). NOT MEASURED: the hosted VM (1 OCPU, remote Supabase), where
   each click also waits for that page's remote queries, so the delay is longer there.

What was **not** the cause (checked): the CSS (`[data-theme]` blocks and the `@custom-variant` matched each other), the
CSP (the cookie approach had no inline script), and hydration (no mismatch warnings). The cookie's `Secure` flag is
fine on `localhost` and on the HTTPS demo.

**Fix (spec §3.1.4, v1.2):** next-themes 0.4.6 (`components/theme-provider.tsx`) with `attribute="class"`,
`defaultTheme="system"`, `enableSystem`, `storageKey="dl-theme"`, `disableTransitionOnChange` and the request's CSP
nonce (both root layouts read the proxy's `x-nonce` header). next-themes 0.4.6 puts that nonce on its pre-paint
`<script>` and on its transition-blocking `<style>` (checked in `node_modules/next-themes/dist/index.mjs`). Tokens: one
`.dark` block; `@custom-variant dark (&:is(.dark *))` (the line shadcn generated for this repo, in git history). The
`ThemeToggle` (native radios in a fieldset) changes the class on the client at once, with no server call. It sits in a
◐ header popover, in the account menu, in the landing header and in the landing menu sheet. Removed: the `dl-theme`
cookie, `setTheme` server action and `lib/theme.ts`. Proved by `e2e/staff/theme.spec.ts` (D21).

**C-37 · Theme needs JavaScript now.** next-themes applies the stored choice with a script. Without JavaScript the app
follows the OS only (the default, System); the v1.1 cookie worked without JavaScript. This is what §3.1.4 v1.2
asks for. Customer pages (S25–S28) are plain HTML with no control, unchanged.

**C-38 · Local database migrated forward to 0027.** `next start` refused to run (rule 45: schema 0026, build expects
0027) because `main` now ships `0027_mailbox`. I applied only that pending migration to the local stack with
`supabase migration up --local` (no reset, no data removed). C-05's question about resetting the DB is still open.

## Open questions answered by the code

| # | Answer |
|---|---|
| Q1 | No reset route: hide "Forgot?" |
| Q2 | No terms/privacy pages: no legal line |
| Q3 | Server enforces password ≥ 8 (`login/actions.ts:15`; Supabase local config says 6). No resend endpoint. Local `enable_confirmations = false` |
| Q4 | Yes: `TenantSwitcher`, shown for > 1 tenant |
| Q5 | No search endpoint; `/invoices?q=` and `/customers?q=` filter server-side. ⌘K can route to those |
| Q6 | Yes: Overview already shows one figure per currency |
| Q7 | Not in the list query: column removed |
| Q8 | Collectors **can** view approvals read-only (`approvals.view` = all roles; `approvals.decide` = owner, accountant) |
| Q9 | Owner only (`api_keys.manage`) |
| Q11 | Payment input accepts `.` or `,` (explicit selector) |
| Q12 | No logo: typographic wordmark |
| Q13 | Money: one monthly budget, minor units of the tenant currency, WhatsApp + SMS together |
| Q15 | No revoke RPC found: "approving sends at the next allowed time" |
| Q23 | `PUBLIC_APP_URL` / `NEXT_PUBLIC_APP_URL` exist (`.env.example:22,26`) |
| Q24 | Sign-up confirmation link goes to `/auth/confirm?next=/onboarding`: kept |
