# Dueloop — Redesign Specification

Source of truth for the UI redesign · Version 1.2 · 3 November 2026 · v1.2 fixes five defects found in the first build (§0.5): hero 3D, micro-interactions, shadcn fields, auto-applied filters, theme switching

> **Who this is for.** A fresh Claude Code session with no memory of how this spec was written. Read the whole document before writing any code. Where this spec and the code disagree, **stop and record the conflict** in `docs/redesign/CONFLICTS.md` rather than guessing. Where the spec says **VERIFY**, check the installed package version or the official docs before using the API.

> **What this is not.** This is a visual and interaction redesign. It does not change business logic, API contracts, database schema, data flow, or the safety rules described in the product overview. See §10 *Out of scope*.

## 0. Read this first: how the spec was produced, and Phase 0

### 0.1 What the author could and could not see

The author had **only** the *Dueloop Product and Technical Overview* (v0.7.0, 2 Nov 2026). The source code was **not available**, so:

- No route paths, file paths, component names, or `package.json` contents in this spec are confirmed. Paths written like `apps/web/…` are **proposals** based on the overview ("pnpm monorepo", "Next.js web app").
- The per-screen design critique in §4 is based on the **product's behaviour as documented**, not on the current UI. You will add code-based findings in Phase 0.
- Every assumption is listed in §0.3 and every unknown in §11 *Open questions*.

### 0.2 Facts taken from the overview (treat as true)

| Area | Fact |
|---|---|
| Language/runtime | TypeScript on Node.js 24, pnpm monorepo |
| Web app | Next.js (dashboard, public pages, REST API in one `web` program) |
| Other programs | `worker`, `processor`, `webhooks` — **no UI, do not touch** |
| Data | Supabase Postgres 17 (RLS, state machine, ledger, pgmq, pg_cron), Auth, Storage, Vault |
| Tests | Vitest (819 unit/contract), pgTAP + integration (160), Playwright (browser E2E) |
| Roles | Owner, Accountant, Collector; role matrix stored as data and used by screens and tests |
| Invoice statuses | open, overdue, promised, disputed, escalated, paid, written off, cancelled |
| Security | CSP with nonces; untrusted text rendered as plain text only; public pages never change state on GET |
| Packaging | Docker, non-root, read-only filesystem; demo server has 1 OCPU / 1 GB RAM |

### 0.3 Assumptions (confirm or correct in Phase 0)

| ID | Assumption | If wrong |
|---|---|---|
| A1 | The web app uses the **Next.js App Router** (`app/` directory). | If Pages Router, replace `layout.tsx`/`template.tsx` instructions with `_app.tsx` equivalents and log it. |
| A2 | React **19** is installed. | If React 18: use `@react-three/fiber@8` instead of `@9` (R3F majors pair with React majors). |
| A3 | Styling approach is unknown. | Tokens ship as **CSS custom properties** (framework-agnostic). If Tailwind v4 is present, also map tokens in `@theme`; if Tailwind v3, map in `tailwind.config.ts`; if CSS Modules, consume variables directly. |
| A4 | Zod may already exist in the core package. | If the core defines schemas/enums, **import them**; never duplicate a domain enum in the UI. |
| A5 | Amounts are integers in minor units plus an ISO 4217 code (overview §7). | Not an assumption to change — it is a rule. |
| A6 | There is no landing page today. This spec **adds** one (S32) at `/` for signed-out visitors, aimed at small businesses signing up to hosted Dueloop. | If `/` already serves the signed-in dashboard, keep it working and **ask the user** before moving it; meanwhile build S32 at `/welcome`. |
| A7 | No dark mode exists today. | Dark mode follows `prefers-color-scheme` with a user override (see §3.1.4). |

### 0.4 Phase 0 — discovery (do this before Phase 1)

Produce `docs/redesign/INVENTORY.md` containing:

1. **Stack table** from every `package.json` in the repo (root, `apps/*`, `packages/*`): Next.js, React, TypeScript, styling libs, UI libs, form libs, Zod, motion libs, test libs — with exact installed versions (`pnpm why <pkg>`).
2. **Route map**: every `page.tsx`/`route.ts` under the web app, mapped to the screen IDs in §4.0. Mark anything not in §4.0 as **UNMAPPED**.
3. **Shared components**: every file under the web app's components folder(s), with which screens use it.
4. **Forms**: every `<form>` and every server action/route it posts to, with the request schema it sends.
5. **Domain sources**: where invoice status, roles/permissions matrix, money types and channel enums are defined.
6. **Critique addendum**: for each screen, list concrete issues against the checklist in §4.1 (usability, hierarchy, consistency, accessibility) with `file:line` references. Use this list to adjust the per-screen work, not to change the design direction.
7. **Baseline**: run the full existing test suite and record pass counts; run Lighthouse on Sign in, Overview, Invoices, Pay page (production build, mobile preset) and record scores.

Done when `INVENTORY.md` exists, every screen in §4.0 is mapped (or marked missing), and the baseline is recorded.

### 0.5 Version 1.2 · fixes after the first build (3 November 2026)

The first implementation of v1.1 was reviewed by the product owner. Five defects were reported. v1.2 fixes them, and **v1.2 wins wherever it conflicts with earlier text**.

| ID | Reported defect | Fix in this spec | Proved by |
|---|---|---|---|
| B1 | The landing hero animation is dull, laggy and looks "funky"; the 3D icons are not in shape | Rebuilt scene "The Loop Track" (§6.2.1, §6.2.4); icon pipeline from filled SVGs (§6.2.9); mandatory performance rules (§6.2.10); art-direction rubric (§6.2.11) | D15–D18, D23, D24, manual QA §6.2.7 |
| B2 | No micro-interactions anywhere on the website, and almost no animation in the app | Required micro-interaction catalogue, 43 rows (§6.5); `/dev/motion` gallery | D20 |
| B3 | Inputs and selects should be shadcn components, styled our way | shadcn Input and Select with a token bridge and our styling (§7.3) | D22 |
| B4 | Filters need a manual apply | Filters apply automatically, with the URL as the source of truth (§4.10) | D25 |
| B5 | Theme buttons don't work | Diagnose, then rebuild on next-themes with a class-based dark mode (§3.1.4) | D21 |

**Superseded by v1.2**:
- the ring-of-cards hero (v1.1 §6.2);
- the ban on `@react-three/drei` (now allowed from a short list);
- the 3D chunk budget (now a 280 KB target, 340 KB hard cap);
- the native `<select>` rule (v1.1 §7.2);
- the `dl-theme` cookie and `data-theme` attribute (v1.1 §3.1.4 and §10.2 item 1);
- the "moves only to explain" wording in §1.1, which is now "explain **and** respond".

**Order of work** for these fixes: Phase 8 in §9 (theme → fields → filters → micro-interactions → 3D).

---

## 1. Definition of done

Everything else in this document works backwards from this section.

### 1.1 What the finished app looks and feels like

- Opening the app feels like entering a **calm, well-kept ledger room**: a deep evergreen sidebar, paper-white working space, generous margins, and numbers aligned like a bank statement.
- Every screen answers **"what needs me now?"** within one glance: the page title says what it is, the primary action is the only filled green button, and counts of waiting work are visible in the navigation.
- Status is always readable **without colour**: every status chip has an icon and a word.
- The product **moves to explain and to respond**. An approved reminder leaves the queue, a recorded payment turns an invoice to Paid, a wizard step slides in the direction of progress. Every interactive element answers hover, focus and press with a small, consistent micro-interaction within 100 ms (§6.5). Nothing loops in the staff app except loading indicators. All 3D lives on the public landing page.
- Filters respond as you choose them, with no Apply button (§4.10). The theme switch works instantly and remembers the choice (§3.1.4). Every input and select looks and behaves the same, built on shadcn/ui in Dueloop's style (§7.3).
- Customers on the Pay page see a quiet, trustworthy page that works on a cheap phone on a slow connection, with no 3D, no web fonts blocking text, and no tracking.
- The landing page (S32) feels like a product you can touch: a real-time 3D infinity track where invoice cards flow, flip to paid at a glowing gate, and react to the pointer. Then, as you scroll, it carries one invoice through all seven steps until it is paid. It looks like a premium product render, runs smoothly, stays readable without motion, and is honest in every claim.
- Light and dark mode are both first-class.

### 1.2 Acceptance checks (all must pass)

| # | Check | How to verify | Target |
|---|---|---|---|
| D1 | Token contrast | `node apps/web/scripts/check-contrast.ts` (Phase 1; see CONFLICTS C-07) computes every pair in §3.1.3 | 0 failures; text ≥ 4.5:1, large text/UI edges ≥ 3:1 |
| D2 | Automated accessibility | `@axe-core/playwright` scan on every route in §4.0, light and dark (**VERIFY** package API) | 0 violations at `serious` or `critical` |
| D3 | Keyboard | Playwright script completes: sign in → approve a send → record a payment → sign out, **no mouse** | Passes; focus always visible |
| D4 | Reduced motion | Same E2E with `page.emulateMedia({ reducedMotion: 'reduce' })` | No transform animations run; 3D canvas never mounts; all flows still complete |
| D5 | Responsive | Playwright screenshots of every route at 390×844, 834×1194, 1440×900, light + dark | No horizontal page scroll; no clipped text; tables scroll inside their own box |
| D6 | Lighthouse (production build, mobile preset) | Sign in, Overview, Invoices, Pay page | Performance ≥ 90, Accessibility = 100, Best Practices ≥ 95 (landing page: see D19) |
| D7 | Core Web Vitals (lab) | Same pages | LCP ≤ 2.5 s, CLS ≤ 0.05, TBT ≤ 200 ms |
| D8 | 3D budget | `@next/bundle-analyzer` (**VERIFY**) | 3D chunk is lazy, target ≤ 280 KB gzip (hard cap 340), loaded **only** on S32; 0 KB of three/R3F/drei on every other route |
| D9 | No behaviour change | Existing Vitest, integration, pgTAP and adversarial suites | Same pass counts as Phase 0 baseline (819 / 160 / all) |
| D10 | No contract change | `git diff` on API route handlers, server actions' input schemas, DB migrations | No changes except those listed in §10.2 |
| D11 | Forms | Every form uses React Hook Form + Zod resolver; Vitest tests per schema (valid, each invalid case, copy matches §5.4) | 100% of forms in §5.3 |
| D12 | Visual consistency | `grep` for raw hex colours / px font sizes in components | 0 occurrences outside `tokens.css` and `features/landing/three/*` |
| D13 | Status without colour | Unit test renders each `StatusChip` and asserts icon + text present | All 8 statuses |
| D14 | Security posture kept | CSP header unchanged in strictness; no `dangerouslySetInnerHTML` added; no new third-party origins except the font host if not self-hosted | Passes review |
| D15 | 3D really renders | Playwright with software WebGL (§6.2.7): screenshot the stage at beats 0, 3 and 7 | Each screenshot is non-blank (pixel standard deviation above a threshold set in the test) and the three differ |
| D16 | Story stays in sync | Scroll test on S32 | `data-beat` goes 0→7 in order scrolling down and 7→0 scrolling up; the matching step has `aria-current="step"` |
| D17 | Pause works | Click Pause; take two stage screenshots 1 s apart at beat 0; reload | Screenshots identical; `data-3d-state="paused"`; preference remembered after reload |
| D18 | Fallbacks | Reduced motion; 390 px viewport; WebGL disabled | Reduced motion → Tier 0 stills; 390 px → Tier ≤ 1; no WebGL → stills; the story text is complete in every case |
| D19 | Landing quality | Lighthouse mobile preset on S32 (production build) | Performance ≥ 85, Accessibility = 100, Best Practices ≥ 95, SEO ≥ 95; LCP element is the H1 |
| D20 | Micro-interactions present | `/dev/motion` gallery + Playwright over every `data-motion` ID (§6.5) | All 43 MI/ML rows animate; with reduced motion each shows its fallback |
| D21 | Theme switching works | Playwright clicks System / Light / Dark with the production CSP (§3.1.4) | Class on `<html>` and body background change each time; kept after reload with no flash; System follows `emulateMedia` |
| D22 | shadcn fields | grep + axe + keyboard test (§7.3) | No native `<select>`; all inputs from `@/components/ui/input`; Select keyboard behaviour passes; every field state shown in `/dev/components` |
| D23 | 3D icons in shape | Silhouette test per icon (§6.2.9) | Intersection-over-union ≥ 0.92 against the source SVG for every icon |
| D24 | 3D smooth and within budget | `window.__dlLoopStats` in the dev build (§6.2.7) + manual FPS from the overlay | Draw calls ≤ 70 and triangles ≤ 150 000 at every beat (automated); FPS targets of §6.2.5 met on real devices (recorded in `3D-QA.md`) |
| D25 | Filters auto-apply | Playwright on every filtered list (§4.10) | No Apply button exists; changes apply on select or after the 300 ms debounce; URL updates; Back restores; no scroll jump; count announced |

---

## 2. Vibe and direction

**Green-led, premium, calm but alive.**

### 2.1 Mood

Dueloop's job is to be polite on someone else's behalf, and to be trusted with money records. The interface should therefore feel:

- **Calm** — low visual noise, one accent at a time, no red walls even when much is overdue. Overdue is a fact, not an alarm.
- **Premium** — careful typography, tabular numerals, precise alignment, restrained shadows, real whitespace. Quality is shown through restraint and finish, not decoration.
- **Alive** — every control responds to the hand (hover, focus, press) with small, consistent micro-interactions; motion confirms what just happened; a real 3D loop at the front door that never stands still; a lime accent only where something is "live" (focus, counters of waiting work, the active progress step).

### 2.2 References (described, not named)

1. **A private-bank statement printed on heavy paper**: deep green header band, off-white body, every figure in a tabular column, small caps labels. → Our ledger tables and KPI tiles.
2. **A botanical glasshouse at dusk**: dark green frames, soft light, living things growing slowly. → The dark sidebar and the inverse "status" panel; the slow 3D loop.
3. **A well-designed train timetable**: dense but legible, status shown by symbol + word, nothing decorative. → Status chips, timelines, the Approvals queue.
4. **A museum's moving model under a glass case**: one clear mechanism, lit softly, turning slowly so you understand it by watching. → The landing-page 3D: real, tactile, explanatory, never a light show.
5. **A quality notebook app's settings pages**: plain forms with generous labels, help text under fields, save bars that appear only when something changed. → Settings.

### 2.3 Avoid

- Neon or rainbow gradients, glassmorphism, frosted panels, glows behind cards.
- Red as a page-level colour; red only inside error chips/messages and destructive buttons.
- Count-up number animations on money (they make amounts briefly wrong).
- Emoji, mascots, illustrated people, stock photos.
- Left-border "accent" cards, pill-shaped everything, oversized drop shadows.
- Shake animations on errors (vestibular trigger; also reads as scolding).
- Any 3D, autoplay or parallax on staff work screens or on the customer Pay page.

---

## 3. Design tokens

All tokens live in **one file**: `apps/web/src/styles/tokens.css` (path proposal; put it where the app's global CSS lives). Components reference **semantic** tokens only (`--color-text-muted`), never primitive scales (`--green-600`) and never raw hex.

### 3.1 Colour

#### 3.1.1 Primitive scales

**Evergreen (primary)**

| Step | Hex | Typical use |
|---|---|---|
| 50 | `#EEF7F1` | primary-soft background, success background |
| 100 | `#D6EDDF` | selected row background |
| 200 | `#ADDBC0` | inverse muted text; dark-mode primary-soft text |
| 300 | `#7DC29C` | dark-mode link, dark-mode hover |
| 400 | `#4DA477` | dark-mode primary button |
| 500 | `#2D875B` | **decorative only** (charts, 3D). Never a text background (white on it = 4.44:1 ✗) |
| 600 | `#1F6E48` | **primary**: buttons, links, focus ring (light) |
| 700 | `#1A5A3C` | primary hover; success text |
| 800 | `#164831` | primary active; inverse raised |
| 900 | `#123A28` | dark-mode primary-soft background |
| 950 | `#0A2318` | inverse surface (sidebar); accent ink |

**Stone (neutrals, slightly green-tinted)**

| Step | Hex | Typical use |
|---|---|---|
| 0 | `#FFFFFF` | surface (cards, tables, inputs) |
| 50 | `#F7F8F6` | page background |
| 100 | `#EEF0EC` | sunken surface, neutral chip |
| 200 | `#DDE1DB` | hairline borders, dividers (decorative) |
| 300 | `#C3C9C1` | secondary button border |
| 400 | `#98A096` | disabled icon |
| 500 | `#6E776D` | input borders, icons, text **≥ 24 px only** |
| 600 | `#555D54` | muted text (any size) |
| 700 | `#3F463F` | secondary body text |
| 800 | `#2A302A` | escalated chip background |
| 900 | `#1A1F1B` | body text |
| 950 | `#0E120F` | — |

**Accent — Lime** `#C8F169`. Non-text "alive" signal: focus glow in dark mode, waiting-work count badges (with ink `#0A2318`), active wizard step, the 3D hero. **Never** as text on light surfaces (1.29:1 ✗).

**Status primitives**

| Role | Light text | Light bg | Dark text | Dark bg | Border (light / dark) |
|---|---|---|---|---|---|
| Success | `#1A5A3C` | `#EEF7F1` | `#7DC29C` | `#10261A` | `#ADDBC0` / `#1F4A33` |
| Warning | `#8A5A00` | `#FFF4DB` | `#F2C14E` | `#2A2110` | `#F0D28A` / `#4A3A12` |
| Error | `#B42318` | `#FEF0EE` | `#FF8A7A` | `#2C1412` | `#F6C2BB` / `#5A2420` |
| Info | `#2856A8` | `#EDF3FF` | `#8CB4FF` | `#131D33` | `#BBD0F7` / `#25365C` |

**Dark-mode neutrals**: bg `#0C110E`, surface `#141A16`, surface-raised `#1B231E`, border `#2A332D`, border-strong `#6B776F`, text `#E8EDE9`, text-muted `#9AA59D`.

#### 3.1.2 Semantic tokens

```css
/* tokens.css — illustrative excerpt; the full file defines every token in the tables */
:root {
  color-scheme: light;
  --color-bg: #F7F8F6;
  --color-surface: #FFFFFF;
  --color-surface-sunken: #EEF0EC;
  --color-surface-inverse: #0A2318;
  --color-surface-inverse-raised: #164831;
  --color-border: #DDE1DB;
  --color-border-strong: #6E776D;
  --color-text: #1A1F1B;
  --color-text-secondary: #3F463F;
  --color-text-muted: #555D54;
  --color-text-subtle: #6E776D;          /* >= 24px or icons only */
  --color-text-inverse: #FFFFFF;
  --color-text-inverse-muted: #ADDBC0;
  --color-primary: #1F6E48;
  --color-primary-hover: #1A5A3C;
  --color-primary-active: #164831;
  --color-on-primary: #FFFFFF;
  --color-primary-soft: #EEF7F1;
  --color-primary-soft-text: #1A5A3C;
  --color-link: #1F6E48;
  --color-accent: #C8F169;
  --color-on-accent: #0A2318;
  --color-focus-ring: #1F6E48;
  --color-success-text: #1A5A3C; --color-success-bg: #EEF7F1; --color-success-border: #ADDBC0;
  --color-warning-text: #8A5A00; --color-warning-bg: #FFF4DB; --color-warning-border: #F0D28A;
  --color-error-text:   #B42318; --color-error-bg:   #FEF0EE; --color-error-border:   #F6C2BB;
  --color-info-text:    #2856A8; --color-info-bg:    #EDF3FF; --color-info-border:    #BBD0F7;
}

/* Dark (v1.2): one class-based block. next-themes adds .dark to <html>, including when following the system (§3.1.4). */
.dark {
  color-scheme: dark;
  /* same token names, dark values from §3.1.1 */
}
```

Dark-mode semantic values: `--color-primary: #4DA477`, `--color-on-primary: #0A2318`, `--color-primary-hover: #7DC29C`, `--color-primary-active: #ADDBC0`, `--color-primary-soft: #123A28`, `--color-primary-soft-text: #ADDBC0`, `--color-link: #7DC29C`, `--color-focus-ring: #C8F169`, `--color-surface-inverse: #0A2318` (sidebar stays the same; it already reads as dark), plus the status and neutral values above.

#### 3.1.3 Verified contrast pairs

Computed with the WCAG 2.x relative-luminance formula (script in Phase 1 must reproduce these numbers).

**Light**

| Pair | Ratio | Needed |
|---|---|---|
| text `#1A1F1B` on bg `#F7F8F6` | 15.70 | 4.5 |
| text on surface `#FFFFFF` | 16.72 | 4.5 |
| text on surface-sunken `#EEF0EC` | 14.58 | 4.5 |
| text-muted `#555D54` on bg | 6.40 | 4.5 |
| text-muted on surface | 6.82 | 4.5 |
| text-muted on surface-sunken | 5.94 | 4.5 |
| text-subtle `#6E776D` on surface (≥ 24 px, icons) | 4.64 | 3.0 |
| link `#1F6E48` on surface / on bg | 6.21 / 5.83 | 4.5 |
| on-primary `#FFFFFF` on primary `#1F6E48` / hover / active | 6.21 / 8.17 / 10.47 | 4.5 |
| primary-soft-text `#1A5A3C` on primary-soft `#EEF7F1` | 7.47 | 4.5 |
| border-strong `#6E776D` vs surface (input edge) | 4.64 | 3.0 |
| focus ring `#1F6E48` vs bg / surface | 5.83 / 6.21 | 3.0 |
| success / warning / error / info text on own bg | 7.47 / 5.42 / 5.92 / 6.32 | 4.5 |
| error text on surface (field message) | 6.57 | 4.5 |
| escalated chip `#FFFFFF` on `#2A302A` | 13.51 | 4.5 |
| neutral chip `#3F463F` on `#EEF0EC` | 8.48 | 4.5 |
| inverse text `#FFFFFF` on `#0A2318` | 16.58 | 4.5 |
| inverse muted `#ADDBC0` on `#0A2318` / on `#164831` | 10.79 / 6.82 | 4.5 |
| accent ink `#0A2318` on lime `#C8F169` | 12.82 | 4.5 |

**Dark**

| Pair | Ratio | Needed |
|---|---|---|
| text `#E8EDE9` on bg `#0C110E` / surface `#141A16` / raised `#1B231E` | 16.08 / 14.90 / 13.57 | 4.5 |
| text-muted `#9AA59D` on bg / surface / raised | 7.48 / 6.93 / 6.31 | 4.5 |
| link `#7DC29C` on surface | 8.47 | 4.5 |
| on-primary `#0A2318` on primary `#4DA477` / hover `#7DC29C` | 5.44 / 7.95 | 4.5 |
| primary-soft-text `#ADDBC0` on `#123A28` | 8.23 | 4.5 |
| border-strong `#6B776F` vs surface | 3.78 | 3.0 |
| focus ring lime vs bg / surface | 14.74 / 13.66 | 3.0 |
| success / warning / error / info text on own bg | 7.66 / 9.46 / 7.54 / 8.06 | 4.5 |
| error text on surface | 7.71 | 4.5 |
| escalated chip `#0E120F` on `#E8EDE9` | 15.94 | 4.5 |
| neutral chip `#C3C9C1` on `#2A302A` | 8.01 | 4.5 |

**Forbidden pairs** (the contrast script must assert they are never used as text pairs): white on green-500 (4.44), stone-500 text below 24 px on bg (4.36), lime text on white (1.29).

#### 3.1.4 Theme switching (v1.2: rebuilt)

> **v1.2.** In the first build the theme buttons did nothing (defect B5, §0.5). This section replaces the v1.1 cookie approach.

**Step 1: diagnose before fixing.** Find out why the buttons failed and write the root cause in `docs/redesign/CONFLICTS.md`. Common causes:
- the toggle is rendered in a Server Component, so its `onClick` never attaches;
- the toggle writes a cookie or storage, but nothing updates the class or attribute on `<html>`;
- dark tokens exist only inside `@media (prefers-color-scheme: dark)`, so a manual choice has no CSS to switch to;
- Tailwind's `dark:` variant expects `.dark`, while the tokens use `[data-theme]`, or the other way round;
- the CSP blocks the inline script that applies the theme before paint;
- a hydration mismatch throws away the toggle's state.

**Step 2: the required implementation.**

- **Library: `next-themes`** (the setup shadcn documents for Next.js). Root layout: `<html lang="en" suppressHydrationWarning>`, wrapped in a client `ThemeProvider` with:
  - `attribute="class"`
  - `defaultTheme="system"`
  - `enableSystem`
  - `storageKey="dl-theme"`
  - `disableTransitionOnChange`
  - `nonce={nonce}`, where `nonce` is the app's existing CSP nonce for the request. **VERIFY** how the app exposes it (middleware header).

  The `nonce` prop exists so next-themes' injected script can be allowed by a CSP (next-themes README). Without it, the theme will not apply before paint.
- **Tokens**: replace the two dark blocks in §3.1.2 (the `@media` block and the `[data-theme="dark"]` block) with **one** block: `.dark { color-scheme: dark; /* dark values from §3.1.1 */ }`. Following the system preference is now next-themes' job.
- **Tailwind v4**: the `dark:` variant must follow the same class. Use the variant line from shadcn's current generated CSS (it is `@custom-variant dark (&:is(.dark *));` as far as the author knows; **VERIFY** in the generated `globals.css`).
- **Toggle component (`ThemeToggle`)**: a three-option segmented control: System, Light, Dark. Each option has an icon and a visible label (labels can hide below 360 px, with `aria-label` kept). Build it as native radio inputs in a `fieldset` with `legend` "Theme" (visually hidden), styled as a pill group. It calls `setTheme("system" | "light" | "dark")` from `useTheme()`. Until mounted on the client, render a same-size placeholder, because next-themes says theme UI must wait for mount to avoid hydration mismatches. Motion: MI30.
- **Where**: in the header (a "◐" icon button that opens a popover with the control) and in the user menu. The landing page header gets the control too.
- **Customer pages (S25–S28)**: no control. They follow the visitor's stored or system theme.
- **Removed**: the `dl-theme` cookie and server-side `data-theme` rendering from v1.1 (§10.2 item 1 is superseded).

**Acceptance (D21)**: a Playwright test clicks Light, Dark, then System. After each click, `<html>` has the expected class and `getComputedStyle(document.body).backgroundColor` matches that theme's `--color-bg`. After reload, the choice is kept with no flash (a screenshot taken immediately after `DOMContentLoaded` already shows the right theme). With System selected, `page.emulateMedia({ colorScheme: 'dark' })` switches the page to dark. The test runs with the production CSP enabled.

#### 3.1.5 Invoice status → visual mapping

| Status | Chip style | Icon (outline, 16 px) | Label |
|---|---|---|---|
| open | neutral | circle | Open |
| overdue | warning | clock | Overdue |
| promised | info | calendar-check | Promised |
| disputed | error | flag | Disputed |
| escalated | escalated (dark chip) | user-raised-hand or "person" | Needs a person |
| paid | success | check-circle | Paid |
| written_off | neutral, text-muted | minus-circle | Written off |
| cancelled | neutral, text-muted (no strikethrough — it hurts legibility) | x-circle | Cancelled |

The status **value** comes from the existing domain enum (A4). The label strings above are UI copy only.

### 3.2 Typography

| Role | Family | Why |
|---|---|---|
| Display | **Bricolage Grotesque** (SIL OFL 1.1, variable) | Warm, slightly idiosyncratic grotesque: gives headings a human voice (reminders should feel polite, not robotic) while staying crisp at large sizes. Free licence. Variable weight lets one file serve 600–800. |
| Body / UI / numbers | **Inter** (SIL OFL 1.1, variable) | Designed for screens; very legible at 13–15 px in dense tables; has **tabular figures** (`font-variant-numeric: tabular-nums`) so money columns align; wide language coverage for future translations. |

Loading: use `next/font/google` (self-hosts at build time, no runtime request to Google; keeps CSP simple):

```ts
// apps/web/src/app/fonts.ts  — VERIFY export names in next/font/google for the installed Next.js version
import { Inter, Bricolage_Grotesque } from "next/font/google";

export const fontBody = Inter({ subsets: ["latin"], variable: "--font-body", display: "swap" });
export const fontDisplay = Bricolage_Grotesque({
  subsets: ["latin"], variable: "--font-display", display: "swap", weight: "variable",
});
```

**VERIFY**: (1) `Bricolage_Grotesque` is the exported name; (2) whether its variable font exposes `opsz`/`wdth` axes in addition to `wght` — this spec uses **only `wght`**, so the design does not depend on the answer. If `weight: "variable"` is not accepted, list explicit weights `["600","700","800"]`.

Rules: Display face only for page titles (`display-*`), KPI figures, the auth hero and empty-state titles. Everything else is Inter. Every element showing money, counts, dates or IDs gets `font-variant-numeric: tabular-nums`.

**Type scale** (root 16 px; fluid sizes use `clamp()` between 390 px and 1440 px viewports)

| Token | Size | Line height | Weight | Tracking | Family | Use |
|---|---|---|---|---|---|---|
| `display-2xl` | `clamp(2.75rem, 1.9rem + 3.5vw, 4.5rem)` | 1.0 | 700 | −0.03em | display | Auth hero |
| `display-xl` | `clamp(2.25rem, 1.8rem + 1.9vw, 3.5rem)` | 1.05 | 700 | −0.025em | display | Pay page amount |
| `display-lg` | `clamp(1.75rem, 1.5rem + 1.1vw, 2.5rem)` | 1.1 | 700 | −0.02em | display | Page titles |
| `display-md` | `clamp(1.625rem, 1.5rem + 0.5vw, 2rem)` | 1.1 | 700 | −0.02em | display | KPI figures |
| `heading-lg` | 1.5rem | 1.25 | 650 | −0.01em | display | Section titles |
| `heading-md` | 1.25rem | 1.3 | 600 | −0.005em | body | Card titles, dialog titles |
| `heading-sm` | 1.0625rem | 1.35 | 600 | 0 | body | Sub-sections, table group headers |
| `body-lg` | 1.0625rem | 1.6 | 400 | 0 | body | Pay page, empty-state text |
| `body-md` | 0.9375rem | 1.55 | 400 | 0 | body | **Default app text** |
| `body-sm` | 0.875rem | 1.5 | 400 | 0 | body | Table cells, help text |
| `caption` | 0.8125rem | 1.45 | 500 | 0 | body | Meta lines, timestamps |
| `label` | 0.75rem | 1.4 | 600 | 0.06em, uppercase | body | Column headers, overlines (always `--color-text-muted` or darker) |

Minimum text size anywhere: 12 px. Maximum line length for prose: 68ch.

### 3.3 Spacing (4 px base)

| Token | Value | | Token | Value |
|---|---|---|---|---|
| `space-0` | 0 | | `space-6` | 24 px |
| `space-1` | 4 px | | `space-8` | 32 px |
| `space-2` | 8 px | | `space-10` | 40 px |
| `space-3` | 12 px | | `space-12` | 48 px |
| `space-4` | 16 px | | `space-16` | 64 px |
| `space-5` | 20 px | | `space-20` | 80 px |

Layout constants: page gutter 16 px (mobile) / 24 px (tablet) / 40 px (desktop); max content width 1280 px; sidebar 264 px (desktop) / 72 px rail (tablet); minimum touch target 44×44 px; table row height 52 px (comfortable) / 40 px (compact, user toggle stored in the theme cookie).

### 3.4 Radius

| Token | Value | Use |
|---|---|---|
| `radius-xs` | 6 px | Checkboxes, small tags |
| `radius-sm` | 8 px | Inputs, small buttons |
| `radius-md` | 10 px | Buttons, nav items |
| `radius-lg` | 12 px | Menus, popovers, toasts |
| `radius-xl` | 16 px | Cards, panels, dialogs |
| `radius-2xl` | 24 px | Auth hero card, Pay page card |
| `radius-full` | 9999 px | Chips, count badges, avatars |

### 3.5 Shadows / elevation

Light mode uses soft green-tinted shadows; dark mode replaces shadow with a lighter surface + 1 px border.

| Token | Light | Dark | Use |
|---|---|---|---|
| `elev-0` | none | none | Page, flat cards (cards use a 1 px border instead) |
| `elev-1` | `0 1px 2px rgb(10 35 24 / .06), 0 1px 1px rgb(10 35 24 / .04)` | `surface-raised` + border | Sticky table header, hovered card |
| `elev-2` | `0 4px 12px -2px rgb(10 35 24 / .08), 0 2px 4px -2px rgb(10 35 24 / .06)` | raised + border + `0 4px 12px rgb(0 0 0 / .4)` | Menus, select lists |
| `elev-3` | `0 12px 32px -8px rgb(10 35 24 / .18), 0 4px 8px -4px rgb(10 35 24 / .08)` | raised + border + `0 12px 32px rgb(0 0 0 / .5)` | Popovers, toasts, save bar |
| `elev-4` | `0 24px 64px -12px rgb(10 35 24 / .28)` | raised + border + `0 24px 64px rgb(0 0 0 / .6)` | Dialogs, sheets |

### 3.6 Z-index

| Token | Value | | Token | Value |
|---|---|---|---|---|
| `z-base` | 0 | | `z-overlay` | 400 |
| `z-raised` | 10 | | `z-dialog` | 500 |
| `z-sticky` | 100 | | `z-popover-in-dialog` | 550 |
| `z-header` | 200 | | `z-toast` | 600 |
| `z-dropdown` | 300 | | `z-skip-link` | 700 |

### 3.7 Motion tokens

| Token | Value | Use |
|---|---|---|
| `duration-instant` | 80 ms | Press feedback, colour changes |
| `duration-fast` | 140 ms | Hover, field messages, icon swaps |
| `duration-base` | 220 ms | Most enter/exit, row removal, page enter |
| `duration-slow` | 320 ms | Dialogs, sheets, status morph |
| `duration-slower` | 480 ms | Wizard step slide, first-load stagger total |
| `duration-scene` | 900 ms | One-shot moments inside the 3D scene that are not scroll-scrubbed (beat-7 green wave) |
| `duration-ambient` | 60 000 ms | One full revolution of the 3D loop |
| `ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | Default for state changes |
| `ease-enter` | `cubic-bezier(0.05, 0.7, 0.1, 1)` | Things arriving |
| `ease-exit` | `cubic-bezier(0.3, 0, 0.8, 0.15)` | Things leaving (pair with ~70% of enter duration) |
| `ease-settle` | `cubic-bezier(0.34, 1.36, 0.64, 1)` | Small elements landing (chips, badges) — slight overshoot; never on large surfaces |
| `ease-linear` | `linear` | Progress bars, ambient rotation |

Reduced motion: under `@media (prefers-reduced-motion: reduce)` every `duration-*` except `instant` becomes `1ms` for **transform/layout** properties; opacity and colour transitions keep `duration-fast`. In JS, Motion's `<MotionConfig reducedMotion="user">` at the app root (§6.4).

### 3.8 Breakpoints

| Name | Min width | Layout |
|---|---|---|
| `mobile` | 0 | Single column; top bar + menu sheet; tables become stacked cards |
| `tablet` | 768 px | Icon rail sidebar (72 px) expandable; tables scroll horizontally in their box |
| `desktop` | 1024 px | Full sidebar (264 px); split views (list + detail) on Inbox, Approvals, Tasks, Proofs |
| `wide` | 1440 px | Content max 1280 px, centred; Overview shows 4 KPI tiles in one row |

---

## 4. Layout per screen

### 4.0 Screen inventory (IDs used throughout)

32 screens. Route paths are **proposals**; map them to real routes in Phase 0.

| ID | Screen | Proposed route | Roles | Group |
|---|---|---|---|---|
| S01 | Sign in | `/sign-in` | public | Auth |
| S02 | Sign up | `/sign-up` | public | Auth |
| S03 | Confirm email | `/confirm-email` | public | Auth |
| S04 | Onboarding | `/onboarding` | new owner | Auth |
| S05 | Overview | `/overview` (signed-in home) | all | Daily work |
| S06 | Invoices list | `/invoices` | all | Daily work |
| S07 | Invoice detail | `/invoices/[id]` | all (actions by role) | Daily work |
| S08 | Customers list | `/customers` | all | Daily work |
| S09 | Customer detail | `/customers/[id]` | all (consent: owner, accountant) | Daily work |
| S10 | Inbox | `/inbox` | all | Daily work |
| S11 | Approvals | `/approvals` | owner, accountant (collector: read-only or hidden — see §11) | Decisions |
| S12 | Tasks | `/tasks` | all | Decisions |
| S13 | Proofs | `/proofs` | all view; owner, accountant decide | Decisions |
| S14 | Unknown sends | `/unknown-sends` | owner, accountant | Decisions |
| S15 | Record payment (dialog) | over S07 | owner, accountant | Decisions |
| S16 | Import wizard | `/import` | owner, accountant | Setup |
| S17 | Settings · General | `/settings` | owner edits; accountant views | Setup |
| S18 | Settings · Policies | `/settings/policies` | owner, accountant | Setup |
| S19 | Settings · Templates | `/settings/templates` | owner, accountant | Setup |
| S20 | Settings · Holidays | `/settings/holidays` | owner, accountant | Setup |
| S21 | Settings · Members | `/settings/members` | owner | Setup |
| S22 | Settings · Integrations | `/settings/integrations` | owner edits; accountant views | Setup |
| S23 | Settings · API keys | `/settings/api-keys` | owner (see §11) | Setup |
| S24 | Kill switch (dialog) | from S17 / user menu | owner | Setup |
| S25 | Pay page | `/p/[token]` | customer | Public |
| S26 | Opt-out page | `/o/[token]` | customer | Public |
| S27 | Action done | after POST on S25/S26 | customer | Public |
| S28 | Link not valid | invalid/expired/revoked token | customer | Public |
| S29 | Not found | 404 | staff | System |
| S30 | Error | error boundary | staff | System |
| S31 | Empty states | pattern on S06–S14, S18–S23 | all | System |
| S32 | Landing page | `/` (signed out) | public | Marketing |

### 4.1 Critique checklist (apply per screen in Phase 0, then fix)

Known risks from the documented behaviour (verify against the code; add `file:line`):

| # | Area | Risk to check | Fix in this redesign |
|---|---|---|---|
| C1 | Usability | Counters for approvals/tasks/proofs/unknown sends exist but may not lead to the next item | Every count badge is a link to its filtered queue; queues open on the oldest item |
| C2 | Usability | "Approval expires after 7 days" may be invisible | Show "Expires in N days" on each approval; sort by soonest expiry |
| C3 | Usability | Paused invoices (unknown send, promise) need a visible reason and a "Resume" action | Banner on S07 with reason + action (role-gated) |
| C4 | Hierarchy | Multiple filled buttons on one screen | One primary per view (§7 Button rules) |
| C5 | Hierarchy | Money not aligned | Right-align amounts, tabular numerals, currency code in a muted suffix |
| C6 | Consistency | Status shown with different colours/labels across screens | Single `StatusChip` (§3.1.5) |
| C7 | Consistency | Settings forms save differently | One `SettingsForm` pattern with sticky save bar |
| C8 | Accessibility | Role-hidden menu items still reachable by keyboard / screen reader | Hidden items are not rendered (server decides; DB is final authority) |
| C9 | Accessibility | Icon-only buttons without names | `aria-label` on every icon-only button |
| C10 | Accessibility | Customer/AI text rendered as HTML | Keep plain-text rendering (security rule); style with `white-space: pre-wrap` |
| C11 | Safety UX | Kill switch can be pressed by accident | Typed confirmation dialog (S24) |
| C12 | Safety UX | "Already paid" claims could look like payments | Claims use warning style and the words "Claim — not confirmed" |

### 4.2 App shell (applies to S05–S24, S29, S30)

**Desktop ≥ 1024 px**

```
┌───────────────────────┬──────────────────────────────────────────────────────────┐
│ ◯ Dueloop             │ [Business ▾]                 [Search  ⌘K]   [◐] [Avatar▾]│ ← header 64px
│                       ├──────────────────────────────────────────────────────────┤
│ Overview              │  ┌ Kill-switch / sending-paused banner (only when on) ┐  │
│ Invoices              │  └────────────────────────────────────────────────────┘  │
│ Customers             │                                                          │
│ Inbox                 │  PAGE TITLE (display-lg)          [Secondary] [Primary]  │
│ ── Needs you ──       │  one-line description (body-md, muted)                   │
│ Approvals        (3)  │                                                          │
│ Tasks            (2)  │  ┌──────────────────── page content ──────────────────┐  │
│ Proofs           (1)  │  │                                                    │  │
│ Unknown sends    (1)  │  └────────────────────────────────────────────────────┘  │
│ ── Setup ──           │                                                          │
│ Import                │                                                          │
│ Settings              │                                                          │
│                       │                                                          │
│ Sending: On  ●        │                                                          │
└───────────────────────┴──────────────────────────────────────────────────────────┘
  264px, inverse surface            content max 1280px, gutter 40px
```

| Element | Purpose |
|---|---|
| Wordmark | Home link to Overview; brand presence |
| Nav groups (Daily / Needs you / Setup) | Separate routine browsing from queues that need a decision |
| Count badges (lime, ink text) | Show waiting work; each is a link into the filtered queue (C1) |
| Sending status at nav bottom | Always shows whether reminders are going out; links to kill switch (owner) |
| Business switcher | Only rendered if the user belongs to >1 business (§11 Q4) |
| Search (⌘K / Ctrl K) | Jump to invoice by number or customer by name; uses existing search endpoint only (§11 Q5) |
| Theme control (◐) | System / Light / Dark |
| Avatar menu | Role shown as text, sign out |
| Paused banner | Visible on every page when the business or operator kill switch is on |
| Page title + description | Where am I, what is this for |
| Page actions | At most one primary + one secondary |

**Tablet 768–1023 px**: sidebar collapses to a 72 px icon rail with tooltips (labels visible on focus/hover); a toggle expands it as an overlay (`z-overlay`). Count badges become dots with the number in the tooltip and `aria-label`.

**Mobile < 768 px**

```
┌──────────────────────────────────┐
│ ☰  Dueloop      [Search] [Avtr]  │ ← 56px top bar
├──────────────────────────────────┤
│ Sending paused — owners can… [›] │ (banner only when relevant)
│ PAGE TITLE                       │
│ description                      │
│ [Primary action — full width]    │
│ ┌──────────────────────────────┐ │
│ │ content (cards, not tables)  │ │
│ └──────────────────────────────┘ │
└──────────────────────────────────┘
☰ opens a left sheet with the full nav (same groups and counts).
```

(Icons in wireframes are placeholders; the real UI uses one outline icon set — §7.)

### 4.3 Auth group

**S01 Sign in — desktop**

```
┌──────────────────────────────────────┬───────────────────────────────────────────┐
│ ◯ Dueloop                            │                                           │
│                                      │       [ STILL OF THE LOOP, beat 0 ]       │
│  Welcome back                        │        image rendered from the landing    │
│  (display-xl)                        │        page scene (§6.2.6); no WebGL      │
│                                      │                                           │
│  Email     [________________]        │   "Polite reminders. Clear records.       │
│  Password  [____________] [Show]     │    People in charge."  (body-lg, inverse) │
│                       Forgot? (§11)  │                                           │
│  [ Sign in ———————————————— ]        │                                           │
│  New here? Create an account         │                                           │
└──────────────────────────────────────┴───────────────────────────────────────────┘
   form column 480px on bg                hero column fills, inverse surface
```

| Element | Purpose |
|---|---|
| Wordmark | Identity |
| Title | Confirms the screen |
| Email / Password | Credentials (Supabase Auth, unchanged) |
| Show password toggle | Reduces typing errors |
| Forgot link | Only if a reset route exists (§11 Q1); otherwise remove |
| Sign in button | Single primary action |
| Create account link | Route to S02 |
| Loop still | Visual continuity with the landing page; no WebGL here (§6.2.8) |
| Tagline | States the three product promises in plain words |

Tablet: hero becomes a 240 px tall band above the form. Mobile: the still shrinks to a 160 px band above the form.

**S02 Sign up** — same frame as S01. Fields: email, password, confirm password; legal line only if terms exist (§11 Q2). Primary: "Create account".

**S03 Confirm email**

```
┌──────────────────────────────────────┐
│ ◯ Dueloop                            │
│  Check your inbox                    │
│  We sent a link to a***@domain.com.  │
│  Open it to continue.                │
│  [ Resend link ] (disabled 60s, shows│
│    countdown)                        │
│  Wrong address? Sign up again        │
└──────────────────────────────────────┘
```

Purpose: one instruction, one recovery action. Resend cooldown length must match the server's rate limit (§11 Q3).

**S04 Onboarding** — stepper, one question group per step:

```
┌────────────────────────────────────────────────────────────  ┐
│ ◯ Dueloop                                Step 2 of 3         │
│ ●───────●───────○   Business · Time & money · Sender         │
│                                                              │
│  Time and money (display-lg)                                 │
│  Time zone   [Asia/Karachi           ▾]  (searchable)        │
│  Currency    [PKR — Pakistani rupee  ▾]                      │
│                                                              │
│  [ Back ]                                 [ Continue ]       │
└────────────────────────────────────────────────────────────  ┘
```

Steps: (1) Business name, country; (2) time zone, default currency; (3) "Add a sender address" — explains that **no reminder can go out until this is done**, with a button to Settings › Integrations or "Do it later". Only include fields the existing onboarding endpoint accepts (Phase 0 §0.4 item 4); drop any step without a backing field. Mobile: stepper collapses to "Step 2 of 3" text + progress bar.

### 4.4 Daily work

**S05 Overview — desktop**

```
┌ PAGE: "Good evening. 7 things need you." ──────────────── [Import] [Review approvals] ┐
│ Monday 2 November · amounts in USD                                                    │
├──────────────┬──────────────┬──────────────┬──────────────┐                           │
│ Outstanding  │ Overdue      │ Promised     │ Collected    │  ← KPI tiles (display-md) │
│ 84,210       │ 31,940       │ 9,600        │ 22,475       │    each links to filtered │
│ 46 invoices  │ 18 invoices  │ next: 15 Nov │ this month   │    invoices list          │
├──────────────┴──────────────┴──────────────┴──────────────┤                           │
│ NEEDS ATTENTION                              │ OPEN BALANCE BY STATUS (inverse card)  │
│ [Approval] Reminder 2 · Northwind  12,400 [Review]│ Overdue   ████████░░  31,940      │
│ [Unknown]  Result unclear · Bluefin 3,150 [Check] │ Open      ██████░░░░  27,370      │
│ [Claim]    "Already paid" · Okafor  1,820 [Verify]│ Promised  ██░░░░░░░░   9,600      │
│ [Proof]    Bank slip · Linden         640 [Decide]│ …                                 │
│ [Dispute]  "Invoice wrong" · Harbor 5,300 [Open]  │ Sending: On · Quiet hours 21–08   │
│ View all (12) ›                                   │                                   │
└───────────────────────────────────────────────────┴───────────────────────────────────┘
```

| Element | Purpose |
|---|---|
| Greeting title with count | Answers "what needs me?" in one line; count = sum of the four queues |
| Date + currency note | Context for the figures; multi-currency shows a currency selector instead (§11 Q6) |
| KPI tiles | Four receivable totals from existing data; each links to a filtered list |
| Needs attention list | Merged, oldest-first list of the four queues; each row has exactly one action |
| Balance by status bars | Where money is stuck; bars are decorative, figures carry the meaning |
| Sending line | Reassures that reminders are running and when they pause |

Remove any existing Overview element that is not in this table unless Phase 0 shows a real use. Tablet: KPI tiles 2×2; status card below the list. Mobile: KPI tiles as a horizontal scroll-snap row (each 80% width) **or** 2×2 if all four fit at ≥ 160 px; list rows stack (chip + title on line 1, amount + action on line 2).

**S06 Invoices list — desktop**

```
┌ Invoices ────────────────────────────────────────────────────── [Export] [Import] ┐
│ [Search number or customer…]  Status: [All ▾]  Due: [Any ▾]  [Clear filters]      │
│ Tabs: All 46 · Overdue 18 · Promised 4 · Disputed 2 · Needs a person 3 · Paid     │
├────────────┬────────────────────┬──────────┬──────────┬────────────┬──────────────┤
│ NUMBER     │ CUSTOMER           │ DUE      │ STATUS   │   BALANCE  │ NEXT STEP    │
├────────────┼────────────────────┼──────────┼──────────┼────────────┼──────────────┤
│ INV-2041   │ Northwind Traders  │ 24 Oct   │ ◷Overdue │ 12,400.00  │ Approval wait│
│ …          │                    │          │          │            │              │
├────────────┴────────────────────┴──────────┴──────────┴────────────┴──────────────┤
│ 1–25 of 46                                                  [‹ Prev] [Next ›]     │
└───────────────────────────────────────────────────────────────────────────────────┘
```

| Element | Purpose |
|---|---|
| Search | Find a specific invoice fast |
| Status/Due filters + status tabs | Tabs for the common cuts, shadcn Selects for the rest; **every change applies at once** and is reflected in the URL (§4.10). No Apply button |
| Number (link) | Opens S07 |
| Balance (right-aligned, tabular) | Money owed now |
| Next step | What the system or a person will do next (from existing data; if not available, remove column — §11 Q7) |
| Pagination | Uses existing API pagination; do not change page size defaults |
| Export | Existing export permission (all roles) |

Mobile: each row becomes a card: number + status chip / customer / due + balance. Tablet: table scrolls horizontally inside its box; number column sticky.

**S07 Invoice detail — desktop**

```
┌ ‹ Invoices   INV-2041 · Northwind Traders                 [Record payment] [⋯ More] ┐
│ ┌─ Paused: result of last send is unknown. A person must check. [Resolve] ───────┐  │
├────────────────────────────────────────────┬────────────────────────────────────────┤
│ BALANCE 12,400.00 USD   ◷ Overdue (9 days) │ CUSTOMER                               │
│ Issued 10 Oct · Due 24 Oct · Total 12,400  │ Northwind Traders  ›                   │
│                                            │ Email ✓ consent · WhatsApp ✗ no consent│
│ TIMELINE (append-only, newest first)       │                                        │
│ ● 2 Nov  Reminder 2 proposed — awaiting    │ PAY LINK                               │
│          approval (expires in 6 days)      │ Active · [Copy link]                   │
│ ● 25 Oct Reminder 1 sent · email           │                                        │
│ ● 10 Oct Imported from CSV (row 14)        │ PAYMENTS                               │
│                                            │ none yet                               │
│                                            │ PROMISES                               │
│                                            │ none                                   │
└────────────────────────────────────────────┴────────────────────────────────────────┘
```

| Element | Purpose |
|---|---|
| Back link + title | Orientation |
| Record payment (primary, owner/accountant) | Most common decision; opens S15 |
| More menu | Secondary role-gated actions: resume, cancel promise, write off, cancel — each only if the existing API supports it |
| Pause banner | Explains why reminders are paused and the next action (C3) |
| Balance + status | The two facts that matter most |
| Timeline | Full history; customer/AI text rendered as plain text (C10) |
| Customer card | Consent per channel at a glance; links to S09 |
| Pay link | Copy for phone conversations |
| Payments / Promises | Ledger entries and promise dates; read-only here |

Mobile: single column order — banner, balance+status, primary action (full width), timeline, customer, pay link, payments, promises.

**S08 Customers list** — list template (like S06) with columns: Name · Contact (email/phone masked to last 4 for collectors if the API already masks; do not add masking logic) · Open invoices · Balance · Consent (two small icons with text "Email", "WhatsApp" and ✓/✗). Mobile: cards.

**S09 Customer detail**

```
┌ ‹ Customers   Northwind Traders ─────────────────────────────────── [⋯ More]  ┐
├──────────────────────────────────────┬────────────────────────────────────────┤
│ INVOICES (mini table, 5 rows + all ›)│ CONSENT                                │
│                                      │ Email    Granted 3 Sep (import)  [Edit]│
│ CONVERSATION (latest 5 messages ›)   │ WhatsApp Not granted             [Edit]│
│                                      │ Opt-out  None                          │
│                                      │ CONTACT  email, phone, time zone       │
└──────────────────────────────────────┴────────────────────────────────────────┘
```

Consent "Edit" (owner/accountant) opens the Consent form (F11). Re-subscribing an opted-out customer has **no screen** by design (overview §15); show "Opted out on {date}. Only an operator can reverse this." Purpose of each block: invoices = money context; conversation = tone context; consent = what we are allowed to send.

**S10 Inbox — desktop split view**

```
┌ Inbox ── [All channels ▾] [Unread only □] ─────────────────────────────────────── ┐
├───────────────────────────┬───────────────────────────────────────────────────────┤
│ Northwind · email   2 Nov │ Northwind Traders · Email                    [Open ›] │
│ "Reminder 2" (sent)       │ ───────────────────────────────────────────────────── │
│ Okafor · WhatsApp  1 Nov  │  ┌ sent 25 Oct ─────────────┐                         │
│ "I already paid" ●        │  │ Dear …                   │                         │
│ …                         │  └──────────────────────────┘                         │
│                           │                ┌ received 26 Oct ───────────────┐     │
│                           │                │ I already paid (plain text)    │     │
│                           │                └────────────────────────────────┘     │
│                           │  Linked task: Verify payment claim ›                  │
└───────────────────────────┴───────────────────────────────────────────────────────┘
```

No reply composer (sending is only through the policy pipeline; Inbox is read-only). Show the notice "Email replies are not read yet. They go to your own inbox." while that limitation exists (overview §6). Mobile: list → tap → full-screen thread with back button.

### 4.5 Decisions

All four queues (S11–S14) share the **Queue template**: split view on desktop (list 400 px + detail), list → detail on mobile; filters at top; detail pane has the item's facts, the evidence, and **exactly two decision buttons** where applicable. After a decision, the item leaves the list (motion M5) and focus moves to the next item's title.

**S11 Approvals**

```
┌ Approvals (3) ─────────────────────────────────────────── sort: [Expires soonest ▾]┐
├───────────────────────────┬────────────────────────────────────────────────────────┤
│ Northwind · Reminder 2    │ Reminder 2 of 4 · Email · to n***@northwind.example    │
│ email · expires in 6 days │ Invoice INV-2041 · 12,400.00 USD · overdue 9 days      │
│ Bluefin · Reminder 1      │ Will send: next allowed time — Tue 3 Nov, 09:00 (their │
│ …                         │ time). Quiet hours and holidays apply.                 │
│                           │ ┌ Message preview (plain text, as the customer sees) ┐ │
│                           │ │ Subject: Friendly reminder: invoice INV-2041       │ │
│                           │ │ …                                                  │ │
│                           │ └────────────────────────────────────────────────────┘ │
│                           │ This approval covers this one message only.            │
│                           │ [ Reject… ]                              [ Approve ]   │
└───────────────────────────┴────────────────────────────────────────────────────────┘
```

Purpose: the approver must see recipient (masked), channel, invoice facts, when it will go, and the exact text. Reject opens F06 (optional reason). Approve is immediate (no extra confirm) — it is reversible until the send runs only if the API supports revoking; otherwise state "Approving sends this message at the next allowed time."

**S12 Tasks** — list items show type chip (Unclear reply / Payment claim / Dispute / Refund / Chargeback), customer, age. Detail: the originating message (plain text), any AI suggestion labelled **"Suggestion — not applied"** with confidence wording only if the API returns it, links to invoice, and a Resolve form (F08). Refund/Chargeback tasks use the error chip and sort first ("urgent" per overview §7).

**S13 Proofs** — detail shows the uploaded file preview (image inline, PDF as first-page thumbnail if available, else file card), any extracted hints labelled **"Read from the image — check before using"**, and the invoice balance. Decisions: **Confirm payment…** opens F09 prefilled **only with the invoice currency** (never with extracted amounts — overview rule); **Reject…** asks for a reason.

**S14 Unknown sends** — detail shows provider, message id/idempotency key (monospace-style tabular text, copy button), attempted time, and the invoice's paused state. Decision form F10: "What did the provider say?" (Delivered / Not delivered) + note. Copy above buttons: "Dueloop will never resend this automatically."

**S15 Record payment dialog** — see form F07; dialog width 520 px; mobile full-screen sheet.

### 4.6 Setup

**S16 Import wizard**

```
┌ Import invoices ─────────────────────────────────────────────────────────────────┐
│ ●───────●───────○───────○   Upload · Match columns · Preview · Done              │
│ MATCH COLUMNS                                                                    │
│ Your column        →  Dueloop field              Sample                          │
│ "Inv No"           →  [Invoice number    ▾] ✓    INV-2041                        │
│ "Client"           →  [Customer name     ▾] ✓    Northwind Traders               │
│ "Amt"              →  [Amount            ▾] ✓    12400.00                        │
│ "Phone"            →  [Don't import      ▾]      +92 …                           │
│ Required fields not matched: Due date                                            │
│ [ Back ]                                              [ Preview (dry run) ]      │
└──────────────────────────────────────────────────────────────────────────────────┘
```

Steps: Upload (drop zone + file button; accepted types/size from server) → Match columns (F12) → Preview (dry-run counts: new, updated, unchanged, errors; first 20 rows; "Download error report") → Done (committed counts; "Importing the same file again changes nothing"). The Commit button is on Preview and is disabled while errors > 0 **only if** the existing API refuses partial commits — match the API.

**S17–S23 Settings template**

```
┌ Settings ───────────────────────────────────────────────────────────────────────┐
├──────────────────┬──────────────────────────────────────────────────────────────┤
│ General        ● │ GENERAL (heading-lg)                                         │
│ Policies         │ Business name      [Acme Ltd              ]                  │
│ Templates        │ Time zone          [Asia/Karachi ▾]                          │
│ Holidays         │ Quiet hours        [21:00] to [08:00]                        │
│ Members          │ Monthly budget     WhatsApp [  0 ] SMS [ 0 ] (minor units…)  │
│ Integrations     │ ── Danger zone ──                                            │
│ API keys         │ Stop all sending   [ Stop sending… ]  (owner only)           │
│                  │                                                              │
├──────────────────┴──────────────────────────────────────────────────────────────┤
│ Save bar (appears only when dirty):  Unsaved changes  [Discard]  [Save changes] │
└─────────────────────────────────────────────────────────────────────────────────┘
```

- Sub-nav (left on desktop, top scrollable tabs on mobile) lists only sections the role can view.
- Read-only roles see values as text, not disabled inputs.
- **S18 Policies**: ordered steps table (Day offset · Channel · Template · [Edit][Remove]) + "Add step". Saving runs the existing **impact check**; show its result in a dialog ("This change affects N invoices: …") before the final save.
- **S19 Templates**: list by channel; editor with subject (email), body textarea, variable chips that insert tokens, live plain-text preview with sample data, server banned-phrase errors shown inline at the field.
- **S20 Holidays**: calendar-month view on desktop + list; list only on mobile.
- **S21 Members**: table (name, email, role, status) + "Invite member" dialog (F15).
- **S22 Integrations**: one card per integration (Email sender, WhatsApp, Stripe, Slack) with status pill ("Connected", "Not set", "Needs attention"); secrets are **write-only**: show "Set · last changed 2 Nov" and a "Replace" button, never the value.
- **S23 API keys**: table (name, created, last used, prefix) + "Create key" dialog; the full key is shown **once** with a copy button and the text "You won't see this again."

**S24 Kill switch dialog**

```
┌ Stop all sending for Acme Ltd? ─────────────────────┐
│ No reminders or receipts will go out until an owner │
│ turns sending back on. Nothing already sent changes.│
│ Type the business name to confirm:                  │
│ [ Acme Ltd____________ ]                            │
│ [ Cancel ]                       [ Stop sending ]   │ ← destructive style
└─────────────────────────────────────────────────────┘
```

Turning sending back on uses the same dialog pattern without typed confirmation.

### 4.7 Customer-facing pages (S25–S28)

Rules: no app shell, no 3D, no motion beyond fade/colour, system font fallback renders immediately (`display: swap`), works without JavaScript for viewing (actions are POST forms; progressive enhancement adds inline validation), `noindex`, no cache — keep existing headers.

**S25 Pay page — mobile first**

```
┌──────────────────────────────────┐
│ Acme Ltd (business name)         │
│ Invoice INV-2041                 │
│ 12,400.00 USD   (display-xl)     │
│ Due 24 Oct 2026 · Overdue        │
│ [ Pay by card ]  (Stripe link)   │ ← primary, only if a pay link exists
│ ── or pay by bank transfer ──    │
│ Bank: …  Account: …  Ref: INV-…  │ [Copy] per line
│ ──────────────────────────────── │
│ Already paid?  [Upload proof]    │
│ Need more time? [Promise a date] │
│ [Request a copy of the invoice]  │
│ Stop reminders ›                 │
└──────────────────────────────────┘
```

Desktop: centred card 560 px wide on `bg`. Each secondary action expands an inline form (F16 promise, F17 proof upload) rather than navigating. Purpose: pay now is the dominant path; alternatives are calm and visible.

**S26 Opt-out** — one sentence, one destructive-styled button "Stop reminders", and "Keep receiving reminders" link back. **S27 Action done** — icon, title ("Thanks — we've told Acme Ltd"), what happens next. **S28 Link not valid** — identical copy for invalid/expired/revoked: "This link can't be used. Contact Acme Ltd for a new one." (business name only if the server already provides it safely; otherwise generic).

### 4.8 System screens

- **S29 Not found**: inside the app shell; title "We can't find that page", links to Overview and Invoices.
- **S30 Error**: inside the shell when possible; "Something went wrong" + "Try again" (calls the boundary reset) + error digest for support (never the message body or PII).
- **S31 Empty states**: icon (outline, 48 px, `text-subtle`), title (heading-md), one sentence, one action. Copy per screen:

| Screen | Title | Sentence | Action |
|---|---|---|---|
| S06 | No invoices yet | Import a CSV or connect the API to get started. | Import invoices |
| S06 (filtered) | Nothing matches | Try another status or clear the filters. | Clear filters |
| S08 | No customers yet | Customers are added when you import invoices. | Import invoices |
| S10 | No messages yet | Sent reminders and replies will appear here. | — |
| S11 | Nothing to approve | New reminders that need approval will appear here. | — |
| S12 | No open tasks | Unclear replies and payment claims will appear here. | — |
| S13 | No proofs to check | Customers can upload proof from their pay page. | — |
| S14 | No unknown sends | Good news: every send has a known result. | — |
| S18 | No reminder steps | Add the first step to start reminding customers. | Add step |
| S20 | No holidays | Add dates when no reminders should go out. | Add holiday |
| S23 | No API keys | Create a key to send invoices from your own system. | Create key |

### 4.9 Landing page (S32)

**Audience**: owners and accountants of small businesses deciding whether to try hosted Dueloop.
**Job of the page**: in 10 seconds, explain what Dueloop does and why it is safe to trust with money records. Then let the visitor *see* the product loop in a real, working 3D scene.
**Primary action**: "Create an account" → S02. **Secondary**: "See how it works" → `#how` anchor.
**Route**: `/` for signed-out visitors; signed-in visitors are redirected to Overview (§10.2 item 7). Render statically: no per-request server work on the 1 GB demo server.

**Copy rules (hard)**
- Claim only what the overview says is built. Do **not** mention SMS, email-reply reading, translations, white-labelling or billing.
- No testimonials, customer logos, user counts, ratings or invented statistics. No compliance or legal claims; the FAQ says "not legal advice".
- WhatsApp and AI are always described as **optional**.
- Pricing is rendered only after the user answers Q18; until then the section is not rendered at all (no "coming soon").

#### 4.9.1 Page structure

| # | Section (id) | Purpose | Contents |
|---|---|---|---|
| 1 | Header | Navigate, sign in, convert | Wordmark · links: How it works, Safety, Payments, FAQ · "Sign in" link · "Create account" button |
| 2 | Hero (`#top`) | Say what it is; show the loop live | H1, sub-line, two CTAs, trust line; 3D stage (beat 0) with Pause control |
| 3 | Promises | Three reasons in one glance | Remind · Understand · Get paid |
| 4 | How it works (`#how`) | Explain the flow, synced to 3D | Seven steps; the sticky 3D stage plays beats 1–7 as you scroll |
| 5 | Safety (`#safety`) | Earn trust with money | The three product promises + approvals, kill switch, quiet hours |
| 6 | Payments (`#payments`) | Show how money is confirmed | Pay link · bank transfer · proof upload · the ledger always balances |
| 7 | Channels and AI | Set expectations | Email; WhatsApp (optional); AI suggestions (optional) |
| 8 | Team roles | Show control | Owner · Accountant · Collector |
| 9 | Pricing (`#pricing`) | Price clarity | Rendered only after Q18 |
| 10 | FAQ (`#faq`) | Remove last doubts | 6 questions, native `<details>` |
| 11 | Final CTA | Convert | Headline + "Create an account" |
| 12 | Footer | Housekeeping | Wordmark, Sign in, Create account, legal links only if they exist (Q19), © line (Q20) |

#### 4.9.2 Wireframes

**Desktop ≥ 1024 px — hero, promises, and the sticky story stage**

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ◯ Dueloop     How it works  Safety  Payments  FAQ       Sign in  [Create account]│ ← header 72px,
├──────────────────────────────────────────────────────────────────────────────────┤   transparent on
│ HERO (inverse surface, 100vh min 640px)                                          │   hero (M24)
│                                       ┌──────────────────────────────────────┐   │
│  Get paid on time, without the        │                                      │   │
│  awkward follow-ups. (display-2xl)    │     3D STAGE · beat 0                │   │
│                                       │     ∞ track, 10 cards flowing;       │   │
│  Dueloop sends polite reminders on a  │     cards flip to paid in the lime   │   │
│  schedule you control … (body-lg)     │     gate; icons float around it      │   │
│                                       │                                      │   │
│  [Create an account]  See how it works│                           [❚❚ Pause] │   │
│  No card details pass through Dueloop.└──────────────────────────────────────┘   │
├──────────────────────────────────────────────────────────────────────────────────┤
│ PROMISES (bg)  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│                │ Remind       │  │ Understand   │  │ Get paid     │              │
│                │ 2 lines      │  │ 2 lines      │  │ 2 lines      │              │
│                └──────────────┘  └──────────────┘  └──────────────┘              │
├──────────────────────────────────────────────────────────────────────────────────┤
│ HOW IT WORKS (#how)          the stage below is position: sticky; top: 72px      │
│  ┌ Step 1 · Import ────────┐ ┌──────────────────────────────────────────────┐    │
│  │ 80vh tall text block    │ │                                              │    │
│  └─────────────────────────┘ │   3D STAGE · beats 1–7, scrubbed by scroll   │    │
│  ┌ Step 2 · Plan ──────────┐ │   (same canvas as the hero: one WebGL        │    │
│  │ …                       │ │    context for the whole page)               │    │
│  └─────────────────────────┘ │                                              │    │
│  … Steps 3–7 …               │                                 [❚❚ Pause]   │    │
│                              └──────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────────┘
```

Layout mechanics: hero and How-it-works sit inside one **story wrapper** (`<section data-story>`). The wrapper has two columns: text on the left (hero text, then seven step blocks each `min-height: 80vh`) and a right column holding one `position: sticky; top: 72px; height: calc(100vh - 96px)` **stage** with the single `<Canvas>`. The hero is beat 0 of the same story, so the canvas never remounts.

**Desktop — lower sections**

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ SAFETY (#safety, inverse surface)                                                │
│  Built to be careful with money (display-lg)                                     │
│  ┌───────────────────────┐ ┌───────────────────────┐ ┌───────────────────────┐   │
│  │ "Already paid" never  │ │ AI suggests. Rules    │ │ Never sent twice      │   │
│  │ closes an invoice     │ │ decide.               │ │ by accident           │   │
│  └───────────────────────┘ └───────────────────────┘ └───────────────────────┘   │
│  Approvals · Stop-all switch · Quiet hours and holidays (3 inline items)         │
├──────────────────────────────────────────────────────────────────────────────────┤
│ PAYMENTS (#payments)        ┌ Ledger card (illustrative) ─────────────────────┐  │
│  Customers pay you          │ Received 12,400.00 = Applied 12,400.00 + Credit │  │
│  directly. (display-lg)     │ 0.00                         ◯ Paid             │  │
│  · Card, via your own       └─────────────────────────────────────────────────┘  │
│    Stripe account                                                                │
│  · Bank transfer, confirmed by an owner or accountant                            │
│  · Proof upload, checked by a person                                             │
├──────────────────────────────────────────────────────────────────────────────────┤
│ CHANNELS & AI   [Email]  [WhatsApp · optional]  [AI suggestions · optional]      │
├──────────────────────────────────────────────────────────────────────────────────┤
│ TEAM ROLES      Owner · Accountant · Collector (3 columns, one line each)        │
├──────────────────────────────────────────────────────────────────────────────────┤
│ FAQ (#faq)      ▸ Does Dueloop hold my money?                                    │
│                 ▸ Do I have to use AI?        … (6 items, <details>)             │
├──────────────────────────────────────────────────────────────────────────────────┤
│ FINAL CTA (inverse)   Start with your next overdue invoice.  [Create an account] │
├──────────────────────────────────────────────────────────────────────────────────┤
│ FOOTER   ◯ Dueloop   Sign in · Create account · (legal links if they exist)   ©  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**Tablet 768–1023 px**: header links collapse into a menu button; story wrapper becomes one column with the stage sticky at the top (`height: 46vh`) and step blocks scrolling beneath it (each `min-height: 70vh`, with a solid surface background so text never sits on the canvas). Safety and promise cards: 2 + 1 grid. 3D runs at **Tier 1** (§6.2.3).

**Mobile < 768 px**

```
┌──────────────────────────────────┐
│ ◯ Dueloop       [Menu] [Sign in] │ ← 56px
├──────────────────────────────────┤
│ Get paid on time, without the    │
│ awkward follow-ups.              │
│ Dueloop sends polite reminders … │
│ [Create an account — full width] │
│ See how it works ↓               │
├──────────────────────────────────┤
│ ┌──────────────────────────────┐ │ ← stage sticky, 42vh;
│ │ 3D stage (Tier 1) or still   │ │   Tier 1 on capable phones,
│ │                   [❚❚]       │ │   still images otherwise
│ └──────────────────────────────┘ │
│ ┌ Step 1 · Import ─────────────┐ │ ← step cards scroll over
│ │ text on surface background   │ │   a solid surface
│ └──────────────────────────────┘ │
│ … Promises, Safety, Payments,    │
│ Channels, Roles, FAQ, CTA, footer│
└──────────────────────────────────┘
```

On mobile the hero text comes **before** the stage, so the H1 is the LCP element and is readable immediately.

#### 4.9.3 Element purposes

| Element | Purpose |
|---|---|
| Header links | Jump to the four sections that answer the main doubts |
| "Create account" (header + hero + final CTA) | The one conversion; the same label everywhere. On inverse surfaces it uses `--color-accent` with `--color-on-accent` (lime, 12.82:1); on light surfaces it is the normal primary button |
| "Sign in" link | Returning users |
| H1 + sub-line | What it does, in plain words |
| Trust line | The most important safety fact for a first-time visitor |
| 3D stage | Shows the product idea (invoices go round and come back paid); in the story it illustrates each step |
| Pause control | Lets visitors stop motion (WCAG 2.2.2); remembered |
| Step blocks | The words that the 3D illustrates; they carry all the meaning |
| Safety cards | The three product promises from the overview |
| Ledger card | Shows "money received = applied + credit" visually (illustrative, not live data) |
| FAQ | Answers doubts without a sales call |

Remove anything not in this table.

#### 4.9.4 Copy deck

| Slot | Copy |
|---|---|
| H1 | Get paid on time, without the awkward follow-ups. |
| Sub-line | Dueloop sends polite invoice reminders on a schedule you control, keeps a clear record of every promise and payment, and leaves every important decision to a person. |
| Primary CTA | Create an account |
| Secondary CTA | See how it works |
| Trust line | No card details pass through Dueloop. Customers pay you directly. |
| Promise · Remind | Scheduled reminders by email or WhatsApp that respect quiet hours, holidays and consent. |
| Promise · Understand | Replies become promises, disputes or tasks. AI can suggest a meaning; rules decide. |
| Promise · Get paid | Pay links, bank transfer details and proof uploads, all recorded in one ledger. |
| Step 1 · Import | Bring in invoices from a CSV or the REST API. You preview every change first, and importing the same file twice changes nothing. |
| Step 2 · Plan | Your policy decides who is contacted, when, on which channel and with which wording. |
| Step 3 · Approve | Want to check messages first? Each reminder waits for a person to approve it. One approval covers one message. |
| Step 4 · Send | Right before sending, Dueloop checks the latest invoice, consent, quiet hours, holidays and your budget. Then it sends once. |
| Step 5 · Respond | Customers can pay, promise a date, upload proof or ask for a copy from a private page. No account needed. |
| Step 6 · Confirm | Money counts only when Stripe confirms it, or when an owner or accountant records it with a bank reference. |
| Step 7 · Close | The ledger updates, the invoice is marked paid and a receipt goes out. The loop is closed. |
| Safety H2 | Built to be careful with money |
| Safety 1 | "Already paid" never closes an invoice. Only a verified payment or an authorised person can confirm money. |
| Safety 2 | AI suggests, rules decide. Model output can never change an invoice or send a message by itself. |
| Safety 3 | Never sent twice by accident. If a send's result is unclear, Dueloop pauses and a person checks. |
| Safety inline | Approvals before sending · One switch to stop all sending · Quiet hours and holidays |
| Payments H2 | Customers pay you directly. |
| Payments body | Dueloop never holds money. Card payments go through your own Stripe account, bank transfers are confirmed by an owner or accountant, and uploaded proof is always checked by a person. Every receipt balances: money received equals amount applied plus credit. |
| Channels | Email · WhatsApp (optional, with the customer's consent) · AI suggestions (optional: with AI off, every reply goes to a person) |
| Roles | Owner: everything, including the stop-all switch. Accountant: approvals, payments, imports and policies. Collector: follows up and works tasks. |
| FAQ 1 | **Does Dueloop hold my money?** No. Customers pay you directly; Dueloop records what happened. |
| FAQ 2 | **Do I have to use AI?** No. With AI off, every customer reply goes to a person as a task, and the rest of Dueloop works the same. |
| FAQ 3 | **Can I check messages before they go out?** Yes. Require approval and every reminder waits for a person. |
| FAQ 4 | **How do invoices get in?** Upload a CSV with a preview and error report, or send them through the REST API. |
| FAQ 5 | **Is my business's data kept separate?** Yes. Each business's data is separated by the database itself. |
| FAQ 6 | **Is this legal advice for debt collection?** No. Rules differ by country, and Dueloop makes no compliance claim. Check what applies to you. |
| Final CTA | Start with your next overdue invoice. · Create an account |

Metadata: title "Dueloop — polite invoice reminders that get you paid"; description = the sub-line; Open Graph image = still of beat 7 (§6.2.6) at 1200×630; canonical URL from Q23. The landing page may be indexed; every other public page stays `noindex` (unchanged).

### 4.10 Filtering pattern: filters apply automatically (v1.2)

> **v1.2.** In the first build, filters needed an extra click to apply (defect B4, §0.5). From now on, **no list has an "Apply" or "Search" button.** This pattern applies to every list with filters: S06 Invoices, S08 Customers, S10 Inbox, S11–S14 queues, and S20 Holidays if it has filters.

**Behaviour**

| Control | When it applies |
|---|---|
| Status tabs, Select filters, checkboxes, toggles | Immediately on change |
| Search box | 300 ms after the last keystroke; immediately on Enter; Escape clears it |
| Date preset (Any, Overdue, Due this week, Due this month) | Immediately |
| Custom date range | As soon as both dates are valid; an invalid range shows a field error and does not apply |
| Filter chip × | Removes that one filter immediately |
| "Clear filters" | Shown only when any filter is active; resets all immediately |

**Rules**

1. **The URL is the source of truth.** Filters live in search params (`?q=&status=&due=&from=&to=&page=`), so links can be shared and Back/Forward restore filters. Update them with `router.replace(url, { scroll: false })` from `next/navigation` (verified in the Next.js docs), so filter changes don't stack up history entries or jump the scroll position.
2. **Any filter change resets `page` to 1.**
3. **Keep the old results visible while new ones load.** Wrap the navigation in `useTransition`; while pending, show MI15's progress bar and set `aria-busy="true"` on the results region. Never flash a full skeleton for a filter change.
4. **Typing never lags.** The search box keeps local state and only the debounced value goes to the URL. When the URL changes from outside (Back/Forward), the box syncs back from it.
5. **Ignore stale results.** If results are fetched on the client, cancel the previous request with `AbortController`. If the page is a Server Component reading `searchParams`, `router.replace` already re-renders it.
6. **Validate params with Zod on the server** (domain first, §5.1). Bad or unknown values fall back to defaults and never crash the page:

```ts
// apps/web/src/domain/invoice-list-params.ts — illustrative; reuse InvoiceStatus from §5.2
export const InvoiceListParams = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  status: z.union([InvoiceStatus, z.literal("all")]).catch("all"),
  due: z.enum(["any", "overdue", "this_week", "this_month", "custom"]).catch("any"),
  from: IsoDate.optional().catch(undefined),
  to: IsoDate.optional().catch(undefined),
  page: z.coerce.number().int().min(1).catch(1),
});
export type InvoiceListParams = z.infer<typeof InvoiceListParams>;
```

7. **Filter on the server, using only what the existing list endpoint supports.** Never filter a paginated list in the browser: it gives wrong counts and missing rows. If a filter in this spec has no server support, leave it out and record that in `CONFLICTS.md` (Q27).
8. **Announce results**: a polite live region states the new count ("18 invoices"). Focus stays where it was.
9. **Active filters show as chips** under the filter bar, each with a × button labelled "Remove filter: Overdue". Motion: MI16.
10. **Mobile**: filters open in a bottom sheet and still apply on each change. The sheet's footer button reads "Show 18 invoices" and only closes the sheet.
11. **Select values**: never use an empty string as an option value (Radix Select rejects it). Use the sentinel `"all"`, as in the schema above.

**Pattern**

```tsx
// features/lists/useListFilters.ts — illustrative; VERIFY hooks against the installed Next.js
"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

export function useListFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function setFilter(key: string, value: string | undefined) {
    const next = new URLSearchParams(params.toString());
    if (!value || value === "all") next.delete(key); else next.set(key, value);
    if (key !== "page") next.delete("page");               // rule 2
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }
  return { params, setFilter, isPending };
}
```

Wrap any component that calls `useSearchParams()` in a `Suspense` boundary, as the Next.js docs require during prerendering.

**Acceptance (D25)**: on S06, with no clicks on any button:
- choosing "Overdue" updates the URL and the rows within 1 s;
- typing "north" fires at most one request per 300 ms burst and shows matching rows;
- Back restores the previous filters and results;
- the page does not scroll to the top;
- the live region announces the count.

The same test runs on every list in the first paragraph.

---

## 5. Domain model and forms

### 5.1 Principle

Model the domain first. **Zod schemas are the single source of truth; TypeScript types are derived from them** with `z.infer` / `z.input` / `z.output`. UI code never declares a parallel `interface` for a domain object.

**Where the schemas live**

1. If the core package already exports Zod schemas or enums (Phase 0, item 5), **import them**. The UI may only *compose* them (pick, extend, add UI-only fields such as `confirmPassword`).
2. If the core exports TypeScript types but not Zod, create `apps/web/src/domain/` with Zod schemas that mirror them, and add a **type-level equality test** so drift fails the build:

```ts
// apps/web/src/domain/__tests__/parity.test-d.ts  (Vitest type test — VERIFY expectTypeOf API in installed Vitest)
import { expectTypeOf, test } from "vitest";
import type { InvoiceStatus as CoreInvoiceStatus } from "@dueloop/core"; // real import path from Phase 0
import type { InvoiceStatus } from "../invoice";
test("status parity", () => { expectTypeOf<InvoiceStatus>().toEqualTypeOf<CoreInvoiceStatus>(); });
```

3. Request payloads already validated on the server keep their **existing** schema; a form's **output** type must equal that request type (add the same kind of type test per form). This is how §10's "no API contract change" is enforced.

**Zod version note (VERIFY):** use the Zod major already in the repo. Snippets below use APIs present in both Zod 3.23+ and Zod 4 (`z.object`, `z.string().trim().min()`, `.regex()`, `.refine()`, `.superRefine()`, `z.enum`, `z.NEVER`). Zod 4 prefers `{ error: "…" }` for custom messages; `{ message: "…" }` is shown here — use whichever the repo already uses.

### 5.2 Domain schemas (UI-facing)

```ts
// apps/web/src/domain/money.ts
import { z } from "zod";

export const CurrencyCode = z.string().regex(/^[A-Z]{3}$/, { message: "Use a 3-letter currency code, like USD." });
/** Integer amount in the currency's smallest unit. Never a float. Use bigint if the core does. */
export const MinorUnits = z.number().int().nonnegative();
export const Money = z.object({ amountMinor: MinorUnits, currency: CurrencyCode });
export type Money = z.infer<typeof Money>;

/** Fraction digits for display/parsing. Prefer the core's currency table if one exists. */
export function minorDigits(currency: string): number {
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

/** "12,400.50" → 1240050 using string arithmetic only (no floating point). Returns null if invalid. */
export function parseMajorToMinor(input: string, digits: number): number | null {
  const s = input.replace(/[\s,]/g, "");               // grouping separators: see §11 Q11 for locales
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const frac = m[2] ?? "";
  if (frac.length > digits) return null;
  const minor = BigInt(m[1]) * 10n ** BigInt(digits) + BigInt(frac.padEnd(digits, "0") || "0");
  return minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
}
```

```ts
// apps/web/src/domain/invoice.ts — enum values MUST come from the core if it exports them
export const InvoiceStatus = z.enum([
  "open", "overdue", "promised", "disputed", "escalated", "paid", "written_off", "cancelled",
]); // VERIFY exact string values against the database state machine
export type InvoiceStatus = z.infer<typeof InvoiceStatus>;

export const Channel = z.enum(["email", "whatsapp", "sms"]); // sms exists in schema but is not built
export const Role = z.enum(["owner", "accountant", "collector"]);
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Use a valid date." });
```

Other UI-facing domain objects to model the same way (fields taken only from existing API responses — Phase 0): `Invoice`, `Customer`, `ConsentRecord`, `Payment`, `Promise`, `Approval`, `Task` (+ `TaskType` enum), `Proof`, `UnknownSend`, `PolicyStep`, `Template`, `Holiday`, `Member`, `Integration` (status only — never secret values), `ApiKey` (prefix only), `ImportPreview`. Parse API responses with these schemas at the boundary (`Schema.parse` in the data-fetching function) so the UI fails loudly on drift in development.

### 5.3 Form inventory

Every form uses **React Hook Form + `zodResolver`** from `@hookform/resolvers/zod`. Submission goes to the **existing** endpoint or server action with the **existing** payload shape.

| ID | Form | Screen | Fields (UI) | Submits to |
|---|---|---|---|---|
| F01 | Sign in | S01 | email, password | Supabase Auth (existing) |
| F02 | Sign up | S02 | email, password, confirmPassword (UI-only) | Supabase Auth (existing) |
| F03 | Resend confirmation | S03 | — (button) | existing |
| F04 | Onboarding (per step) | S04 | businessName, country; timeZone, currency; (sender: link only) | existing onboarding endpoint |
| F05 | List filters (all lists) | S06, S08, S10–S14 | q, status, due, from, to, page | URL search params, applied automatically (§4.10); not an RHF form |
| F06 | Reject approval | S11 | reason (optional, ≤ 500) | existing |
| F07 | Record payment | S15 | amount, receivedOn, bankReference, note? | existing |
| F08 | Resolve task | S12 | resolution (enum from API), note? | existing |
| F09 | Proof decision | S13 | confirm → F07 fields; reject → reason | existing |
| F10 | Resolve unknown send | S14 | outcome (delivered / not_delivered), note | existing |
| F11 | Consent | S09 | channel, status (granted / withdrawn), source, note? | existing |
| F12 | Import: upload + mapping | S16 | file; mapping per required field | existing dry-run / commit |
| F13 | Settings · General | S17 | businessName, timeZone, quietHoursStart, quietHoursEnd, whatsappBudget, smsBudget | existing |
| F14a | Policy step | S18 | dayOffset, channel, templateId | existing (+ impact check) |
| F14b | Template | S19 | channel, name, subject (email), body | existing |
| F14c | Holiday | S20 | date, label? | existing |
| F15 | Invite member | S21 | email, role | existing |
| F16 | Integration secret | S22 | per integration (sender name/email, WhatsApp number id, Stripe key, Slack webhook URL) | existing (write-only) |
| F17 | Create API key | S23 | name | existing |
| F18 | Kill switch confirm | S24 | typedName (must equal business name) | existing |
| F19 | Promise a date | S25 | promisedOn | existing public POST |
| F20 | Upload proof | S25 | file, note? | existing public POST |
| F21 | Opt-out | S26 | — (button) | existing public POST |
| F22 | Cancel promise | S07 | reason? | existing |

The landing page (S32) has **no forms**: every call to action is a link. Do not add a newsletter or waitlist form (no backing endpoint).

Only build fields the backing endpoint accepts. If this table lists a field the endpoint does not accept, drop it and log in `CONFLICTS.md`.

### 5.4 Example: F07 Record payment (pattern for all forms)

```ts
// apps/web/src/forms/record-payment.schema.ts
import { z } from "zod";
import { IsoDate } from "@/domain/invoice";
import { minorDigits, parseMajorToMinor } from "@/domain/money";

export function recordPaymentSchema(ctx: { currency: string; today: string }) {
  const digits = minorDigits(ctx.currency);
  return z
    .object({
      amount: z.string().trim().min(1, { message: "Enter the amount you received." }),
      receivedOn: IsoDate.refine((d) => d <= ctx.today, { message: "The payment date can't be in the future." }),
      bankReference: z.string().trim()
        .min(1, { message: "Enter the bank reference so this payment can be traced." })
        .max(140, { message: "Keep the reference under 140 characters." }),
      note: z.string().trim().max(500, { message: "Keep the note under 500 characters." }).optional(),
    })
    .transform((v, c) => {
      const amountMinor = parseMajorToMinor(v.amount, digits);
      if (amountMinor === null || amountMinor === 0) {
        c.addIssue({ code: "custom", path: ["amount"],
          message: digits === 0 ? "Enter a whole amount, like 1200." : `Enter an amount like 1200.${"0".repeat(digits)}.` });
        return z.NEVER;
      }
      return { amountMinor, currency: ctx.currency, receivedOn: v.receivedOn, bankReference: v.bankReference, note: v.note };
    });
}
```

```tsx
// apps/web/src/forms/RecordPaymentForm.tsx (excerpt)
"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";

const schema = recordPaymentSchema({ currency, today });
const form = useForm<z.input<typeof schema>, any, z.output<typeof schema>>({
  resolver: zodResolver(schema),
  mode: "onTouched",          // first check on blur, then live while correcting
  reValidateMode: "onChange",
  defaultValues: { amount: "", receivedOn: today, bankReference: "", note: "" },
});
// onSubmit receives z.output (amountMinor: number). Map server failures with
// form.setError("root.serverError", { message }) or form.setError("<field>", { message }).
```

The three-generic `useForm<Input, Context, Output>` shape follows the `@hookform/resolvers` README (verified for v5.2.1). **VERIFY** against the installed version.

**Overpayment is not an error.** If `amountMinor > balanceMinor`, show an info note under the field: "{difference} more than the balance will be recorded as credit." (Partial payments and credit are supported by the ledger.)

### 5.5 Validation timing (all forms)

| Moment | Behaviour |
|---|---|
| Typing in an untouched field | No validation, no messages |
| Leaving a field (blur) | Validate that field (`mode: "onTouched"`) |
| Typing in a field that has an error | Re-validate on each change; the message disappears as soon as it is valid (M3) |
| Submit | Validate all; focus the first invalid field (RHF default `shouldFocusError`); show an error summary at the top of long forms (> 5 fields) listing links to each invalid field |
| Server rejects | Field-level errors go to their fields via `setError`; anything else goes to `root.serverError` in a form-level error banner |
| Cross-field rules (confirm password, quiet hours start ≠ end) | Checked on submit and on blur of the **second** field only |

### 5.6 Error message copy

Rules: say what to do, in plain words, no blame, no codes, no "invalid". Max one sentence.

| Rule | Copy |
|---|---|
| Required (generic) | "Enter {field label in lower case}." |
| Email format | "Enter an email address like name@example.com." |
| Password length (min from Supabase config — Q3) | "Use at least {n} characters." |
| Passwords differ | "The passwords don't match." |
| Wrong credentials (server) | "That email and password don't match. Try again or reset your password." |
| Amount format | "Enter an amount like 1200.00." (digits follow currency) |
| Amount zero | same as format |
| Date in future (payment) | "The payment date can't be in the future." |
| Promise date in past | "Choose a date after today." |
| Promise date too far (server limit) | "Choose a date on or before {date}." (limit comes from server; never hard-code) |
| Bank reference missing | "Enter the bank reference so this payment can be traced." |
| Too long | "Keep this under {n} characters." |
| Day offset | "Enter a whole number of days, from {min} to {max}." (range from API) |
| Duplicate policy step | "There's already a {channel} step on day {n}." |
| Banned phrase (server) | "This wording isn't allowed: "{phrase}". Try a gentler phrase." |
| File type | "Upload a {list of allowed types} file." |
| File size | "This file is larger than {limit}. Upload a smaller file." |
| CSV missing mapping | "Match a column to {field} before previewing." |
| Kill switch name mismatch | "Type {business name} exactly to confirm." |
| Slack webhook | "Paste the webhook URL from Slack. It starts with https://." |
| Network failure | "We couldn't save this. Check your connection and try again." |
| Permission (403) | "You don't have permission to do this. Ask an owner." |
| Conflict (409/stale) | "This changed while you were working. Reload to see the latest, then try again." |

### 5.7 Form states

| State | Visual | Behaviour |
|---|---|---|
| Idle | Default fields; primary button enabled | — |
| Dirty (settings forms) | Save bar appears (M4) | Leaving the page prompts "Discard unsaved changes?" |
| Submitting | Primary button shows spinner + "Saving…" label (width locked); fields `readOnly` (not disabled, so values stay readable and announced) | Double submit prevented |
| Success | Inline: toast "Payment recorded" (M7) + the affected element updates (M6); dialogs close; focus returns to the trigger | Settings: save bar shows "Saved" for 2 s then hides |
| Field error | Error border + message under field with icon; `aria-invalid="true"`, `aria-describedby` → message id | M2 |
| Form error | Banner at top of form (error style) with the message; focus moves to the banner | `role="alert"` |
| Disabled (role) | Not rendered as a form; values shown as text | — |

---

## 6. Motion specification

### 6.1 Libraries

- **CSS transitions** for hover, press, colour and focus (no JS).
- **Motion** (npm `motion`, import from `"motion/react"`) for enter/exit (`AnimatePresence`), layout animations (row removal) and coordinated sequences. Verified: `MotionConfig` and `useReducedMotion` are exported from `motion/react`, and `reducedMotion="user"` disables transform/layout animations while keeping opacity/colour. **VERIFY** React 19 support of the installed version. If the repo already uses another animation library, keep it and map these specs to it instead.
- **React Three Fiber + three** (plus a short list of `@react-three/drei` helpers) for the landing-page 3D experience (§6.2), loaded only on S32.
- **`tw-animate-css`** for the enter/exit animations of shadcn primitives (§6.5, §7.3).

Root setup:

```tsx
// apps/web/src/app/providers.tsx
"use client";
import { MotionConfig } from "motion/react";
export function Providers({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
```

### 6.2 The 3D experience — "The Loop Track" (landing page S32)

> **v1.2 rebuild.** The first build of the hero was reported as dull, laggy and "funky", with 3D icons that were not in shape (defect B1, §0.5). This section replaces the v1.1 ring concept completely. Rebuild the scene from this section; do not patch the old one.

This must be a **real, working, real-time 3D scene**: rendered live with WebGL, reacting to the pointer and to scroll. A video, GIF, Lottie file or pre-rendered loop does **not** meet this spec. The only exception is the static fallback in §6.2.3, which serves visitors who cannot or should not get motion.

#### 6.2.1 Concept

A glossy evergreen **track shaped like an infinity sign (∞)** floats in soft studio light. Ten invoice cards flow along it continuously. The left loop is "waiting to be paid": cards there are paper-white. The right loop has a lime **paid gate** (an arch). When a card passes through the gate, it flips over to show its evergreen "paid" face with a lime check that pops out in relief, and a small burst of lime particles goes off. Around the track, five proper 3D icons float gently: envelope, chat bubble, calendar, shield with a check, and a coin. Lime "flow" dots stream along the track to show direction.

The idea, without words: *invoices keep moving round the loop, and come out paid.* A card reaches the gate about **every 2 seconds**, so the hero always has something happening. That is the fix for "dull".

The scene has two acts in **one canvas**:

- **Act 1 · Hero (beat 0)**: the track flows. Cards flip at the gate, icons float, the camera breathes slowly, and everything reacts to the pointer. Hovering a card lifts it; dragging speeds the flow up.
- **Act 2 · Story (beats 1–7)**: as the visitor scrolls through "How it works", the flow slows to a stop and one card leaves the track to go through the seven product steps. At beat 7 it returns, a flip wave runs through every card, the gate flares, and the flow restarts.

#### 6.2.2 Library and architecture

- **`three` + `@react-three/fiber`**: React 19 → R3F 9; React 18 → R3F 8 (R3F docs: majors pair with React majors). For Next.js ≥ 13.1, add `transpilePackages: ['three']` (R3F docs).
- **`@react-three/drei` is now allowed (v1.2), from this list only**: `RoundedBox` (card bodies), `Float` (icon bobbing), `PerformanceMonitor` (adaptive resolution), and `Environment` + `Lightformer` (studio lighting built in code, **no HDR file and no network request**). **VERIFY** each against the installed drei docs. Never use drei `Environment` presets: they load files, which adds a third-party request and breaks the CSP posture (§10.1). If `Lightformer` cannot be confirmed for the installed version, use the plain-light setup in §6.2.4 instead.
- **No post-processing and no model files** (no `.glb`, no HDR). All geometry is procedural or extruded from the in-repo SVG icon set (§6.2.9).
- **One canvas, one WebGL context** for the whole page, inside the sticky stage (§4.9.2). Canvas props verified in the R3F docs: `frameloop` (`"always" | "demand" | "never"`), `dpr` (number or `[min, max]`), `gl`, `camera`, `fallback`, `eventSource`.
- **Everything is a pure function of `(progress, time)`.** Scroll position gives `progress ∈ [0, 1]`, and `beat = progress × 8` (0 = hero, 1–7 = steps). Ambient motion uses a scene clock that can be sped up (drag) or paused. One-shot moments inside story beats are driven by **local progress inside the beat**, so scrolling backwards plays them in reverse.
- **No React re-render per frame.** Follow all of §6.2.10.
- **The DOM carries the meaning.** The canvas is `aria-hidden="true"`. The step text is real HTML; the active step gets `aria-current="step"`; the story wrapper exposes `data-beat="0…7"` for tests.

```tsx
// features/landing/three/LoopStage.tsx — illustrative pattern; VERIFY APIs against installed versions
"use client";
import { Canvas } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";

export function LoopStage({ progressRef, tier, paused, visible }: StageProps) {
  const [dpr, setDpr] = useState(tier === 2 ? 1.25 : 1);   // React state changes only when PerformanceMonitor decides
  return (
    <Canvas
      aria-hidden="true"
      frameloop={!visible ? "never" : paused ? "demand" : "always"}
      dpr={dpr}
      gl={{ antialias: tier === 2, powerPreference: "high-performance", alpha: true }}
      camera={{ fov: 30, position: [0, 2.2, 10.5] }}
      fallback={<LoopStill beat={0} />}
    >
      <PerformanceMonitor
        onIncline={() => setDpr(tier === 2 ? 1.5 : 1.25)}
        onDecline={() => setDpr(1)}
        onFallback={() => demoteTier()}   // repeated flip-flopping → drop one tier (§6.2.3)
      />
      <LoopScene progressRef={progressRef} tier={tier} paused={paused} />
    </Canvas>
  );
}
```

`PerformanceMonitor` props `onIncline`, `onDecline` and `onFallback` (after `flipflops` changes) are verified in the drei docs, as is the usage pattern of driving `dpr` from them. When `frameloop` is `"demand"`, scroll changes must request a frame with R3F's `invalidate` (**VERIFY** the export or the `useThree` selector).

#### 6.2.3 Quality tiers and fallback

The tier is decided once at mount by `useGpuTier()` and can only go **down** at runtime.

| Tier | When | What renders |
|---|---|---|
| **2 · Full** | Viewport ≥ 1024 px, WebGL2 available, `navigator.hardwareConcurrency > 4` (and `deviceMemory > 4` where that non-standard API exists) | 10 cards; 60 flow dots; 5 floating icons; gate burst particles; `Environment` + `Lightformer` lighting; antialias; dpr 1–1.5 adaptive; hover, drag and pointer parallax |
| **1 · Lite** | WebGL2 available, but smaller viewport or weaker device | 7 cards; 30 flow dots; 3 icons (envelope, calendar, coin); 12-particle bursts; plain lights (no `Environment`); no antialias; dpr 1–1.25 adaptive; no hover or drag; story beats still play |
| **0 · Static** | `prefers-reduced-motion: reduce`, no WebGL2, `saveData`, the user switched animation off (remembered), or the watchdog dropped it | `LoopStill` images: one AVIF/WebP still per beat, cross-faded as `data-beat` changes (instant swap with reduced motion). **The story still works.** |

**Watchdog**: average FPS over a rolling 3 s window. Below 45 FPS (Tier 2) or 30 FPS (Tier 1) for 2 consecutive windows, or `PerformanceMonitor.onFallback`, drop one tier with a 220 ms cross-fade.

**Mount sequence**: the server renders the page with the beat-0 still in the stage, so the H1 is the LCP element and the stage has a fixed size (CLS 0). On the client, wait for `requestIdleCallback` (fallback: `setTimeout` 300 ms), then `import()` the scene chunk through `next/dynamic` with `ssr: false`. **Build all geometries and textures before the first visible frame** (inside the dynamic chunk, behind a `Suspense` boundary that keeps the still showing), so nothing pops in afterwards. Fade the canvas in over `duration-slow` once the first frame has rendered. Stop rendering (`frameloop="never"`) when the stage is off-screen (`IntersectionObserver`) or the tab is hidden (`visibilitychange`).

#### 6.2.4 Scene specification

**Common elements**

| Item | Value |
|---|---|
| Track | Closed `CatmullRomCurve3` through 128 samples of a lemniscate: `x = a·cos t / (1 + sin² t)`, `z = a·sin t·cos t / (1 + sin² t)`, `y = 0.22·sin 2t`, with `a = 3.0`. Rendered as `TubeGeometry` (tubularSegments 256, radius 0.055, radialSegments 12). Group tilt X −22°. |
| Cards | 10 (Tier 1: 7). Body: drei `RoundedBox` `args={[1.1, 1.44, 0.07]}`, `radius={0.07}`, `smoothness={4}`. Face: a plane 1.0 × 1.34, offset +0.037 on Z, with `polygonOffset` so it never flickers. |
| Card faces | Two `CanvasTexture`s drawn once at mount (512 × 672): **unpaid** = white face with stone `#C3C9C1` text bars and a short amount bar; **paid** = evergreen `#2D875B` face with `#ADDBC0` bars. One small `ShaderMaterial` mixes the two by a per-card `uPaid` uniform (0→1), so the flip costs no extra draw calls. No real text or numbers anywhere in 3D. |
| Card motion | Constant speed along the track: one lap = 20 s (two cards per lap reach the gate every 2 s). Each card's yaw = 70% toward the camera + 30% along the track tangent; bank ±8° on curves. Spacing is even and fixed: cards never overlap or collide. |
| Paid gate | At the right apex of the ∞ (`t = 0`). Half `TorusGeometry` arch (radius 0.85, tube 0.045) on two short posts; lime `#C8F169` with emissive 0.6. It **pulses** to emissive 1.6 and back over 300 ms each time a card passes. |
| Flip | As a card passes the gate: rotate 180° about its own Y axis over 600 ms (`ease-settle`); `uPaid` 0→1 at the half-way point; the extruded **check icon** pops out of the face (scale 0→1, 320 ms, `ease-settle`). Passing the **left** apex, the card quietly flips back to unpaid (a new invoice) with a 0.92→1 scale dip. |
| Burst | One `InstancedMesh` pool of 72 small icosahedrons (3 bursts × 24; Tier 1: 3 × 12). On each gate pass, 24 particles spray up and out, fall with gravity, shrink and fade over 700 ms. Positions are updated by writing instance matrices; no new objects. |
| Flow dots | One `InstancedMesh` of 60 small spheres (radius 0.022; Tier 1: 30), lime at 70% opacity, moving along the track at 1.6× card speed. |
| Floating icons | Five icons from the icon pipeline (§6.2.9): envelope (upper left), chat bubble (lower left), calendar (back, centre), shield-check (upper right), coin (lower right). Size 0.7–0.9 units, depth 0.18 with a soft bevel. Each sits in drei `Float` (`speed` 1.2–1.8, `rotationIntensity` 0.35, `floatIntensity` 0.5, `floatingRange` [−0.12, 0.12]); vary `speed` per icon so they never bob in sync. |
| Materials (max 4) | **Gloss green** (track, icons): `MeshPhysicalMaterial` `#1F6E48`, roughness 0.28, clearcoat 1, clearcoatRoughness 0.15. **Paper** (card bodies): `MeshPhysicalMaterial` `#FFFFFF`, roughness 0.5, clearcoat 0.3. **Lime glow** (gate, check, dots, particles): `MeshStandardMaterial` `#C8F169`, emissive `#C8F169` 0.6. **Face shader** (above). Icons may use lime glow for a detail part (the check on the shield, the calendar's check). |
| Lighting | Tier 2: `Environment` with `Lightformer`s, built in code: a large soft rectangle above-left (key), a long strip on the right (rim), and a dim ring behind (fill). **VERIFY** the API. Plus a `directionalLight` (intensity 1.0) from (3, 6, 5). Tier 1, or if `Lightformer` cannot be verified: `hemisphereLight` (sky `#EEF7F1`, ground `#0A2318`, 0.7) + `directionalLight` 1.1 from (3, 6, 5) + rim `directionalLight` 0.35 from (−4, 2, −3). |
| Tone mapping | Use Neutral tone mapping so brand colours render true (`gl.toneMapping = THREE.NeutralToneMapping`; **VERIFY** it exists in the installed three, otherwise keep R3F's default and check colours in the stills). Washed-out or shifted greens are a defect. |
| Shadows | No real-time shadow maps. A soft "blob" (one shared 256 px radial-gradient `CanvasTexture`) under each card and icon, scaled by its height above the track plane. |
| Background | Transparent canvas. CSS behind it: hero = radial gradient from `#164831` (centre) to `#0A2318` (edges); story = `--color-bg`. Cross-fade between them as beat 0 → 1. |
| Camera | fov 30; position (0, 2.2, 10.5) → look-at (0.4, 0, 0). Slow "breathing" dolly ±0.25 units on a 12 s sine. Pointer parallax: yaw ±5°, pitch ±3°, damped. |
| Composition | Desktop: the whole ∞ fits inside the stage with at least 8% margin. No object is clipped by the stage edge except the paper plane flying out in beat 4. Nothing ever overlaps the H1 (the canvas lives in its own column). |
| Colours | The scene files (`features/landing/three/*`) are the only place hex values may appear outside `tokens.css` (D12). Use only the values in this table. |

**Beat keyframes** (`beat = progress × 8`; each beat spans 1/8 of the story wrapper's scroll). The flow speed eases from 1 to 0 over the first half of beat 1 and back to 1 over the second half of beat 7.

| Beat | Step | Camera position → look-at | Story card | Track and other cards | Props and one-shots (scrubbed by local progress) |
|---|---|---|---|---|---|
| 0 | Hero | (0, 2.2, 10.5) → (0.4, 0, 0) | One of the flowing cards | Full flow; flips at the gate; bursts; icons float | Pointer parallax; hover lift; drag-to-speed (Tier 2) |
| 1 | Import | (−1.6, 1.4, 7.0) → (−1.2, 0.2, 0) | The card at the left apex rises off the track (0–60%) | Flow slows to a stop; track and other cards dim to 25% opacity | A thin `RoundedBox` "sheet" with a grid texture (a CSV) slides in under the card |
| 2 | Plan | (0, 1.8, 6.4) → (0, 0.2, 0) | Glides onto a short straight rail and stops at the first of 3 ticks | Dimmed | Rail = straight tube matching the track; the active tick lights lime |
| 3 | Approve | (0.8, 1.4, 5.8) → (0, 0.2, 0) | Gains a lime outline (a slightly larger rounded-rect line) | Dimmed | The **stamp** icon descends and presses the card (40–70%), then lifts; the **person** icon stands beside it |
| 4 | Send | (1.5, 1.6, 6.6) → (1.2, 0.5, 0) | Stays on the rail | Dimmed | The **clock** icon's hand (separate mesh) sweeps to the allowed hour (0–40%); then the **paper-plane** icon leaves the card along a `CatmullRomCurve3` arc, banking into the turn, and exits the frame (40–100%) |
| 5 | Respond | (0.5, 1.2, 6.0) → (0, 0.2, 0) | Face tints to promised `#BBD0F7` when the bubble docks | Dimmed | The **chat-bubble** icon, with the **calendar** icon embossed on it, flies back along the arc and docks beside the card |
| 6 | Confirm | (0, 1.3, 5.4) → (0, 0.2, 0) | Tint fades back to white | Dimmed | The **coin** icon (a lathe-shaped coin with a raised rim) drops onto the card (`ease-settle`); an extruded check sits on the coin's face |
| 7 | Close | (0, 2.2, 10.5) → (0.4, 0, 0) | Flips to paid (check pops), a thin receipt slab slides out, then the card rejoins its slot on the track | Opacity back to 100%; a flip wave runs through every card (60 ms stagger); the gate flares; one big burst; flow restarts | Payoff moment (M22) |

**Interactions (Tier 2, beat 0 only)**

- **Pointer parallax**: camera yaw ±5°, pitch ±3°, damped (~150 ms settle).
- **Hover a card**: it lifts 0.18 units, turns to face the camera, and its blob shadow softens. Raycast only against card bodies (not particles or dots). Cursor `grab` over the stage.
- **Hover an icon**: it spins once around Y (600 ms, `ease-settle`) and its lime detail brightens. Cooldown 1.5 s per icon.
- **Drag**: horizontal drag changes the flow speed (up to 4×, or reversed down to −1×) with inertia; after release the speed decays back to 1× over 1.5 s. Cursor `grabbing` while dragging. Touch: disabled, so page scrolling is never captured.
- **Pause control** (DOM `<button aria-pressed>` in the stage corner, all tiers ≥ 1): freezes the scene clock (`frameloop` → `"demand"`). Scroll-driven beats still update on demand. The choice is stored in `localStorage` (`dl-3d=off`, wrapped in try/catch); when it is set, the next visit starts at Tier 0.

#### 6.2.5 Performance budget

| Budget | Limit |
|---|---|
| Lazy 3D chunk (three + R3F + drei imports + scene code) | Target ≤ 280 KB gzip; hard cap 340 KB. Report the measured size in `3D-QA.md`. |
| Routes that load it | **Only S32.** 0 KB of three/R3F/drei on every other route (D8). |
| Draw calls | ≤ 70 (cards ≤ 20, dots 1, particles 1, icons ≤ 12, track and gate ≤ 4, blobs ≤ 16) |
| Triangles | ≤ 150 000 |
| Textures | 2 card-face textures (512 × 672), 1 sheet grid (256 × 256), 1 blob (256 × 256), plus the environment map generated in code |
| Frame time | ≤ 8 ms CPU (main thread) and ≤ 10 ms GPU at Tier 2 on a laptop with integrated graphics; ≤ 12 ms total at Tier 1 on a mid-range phone |
| Frame rate | Average ≥ 55 FPS at Tier 2 on that laptop; ≥ 45 FPS at Tier 1 on that phone; 0 dropped-frame bursts > 100 ms while scrolling |
| Long tasks while scrolling S32 | 0 over 50 ms (Chrome Performance panel) |
| LCP / CLS | H1 is the LCP element; 0 CLS from the stage |
| Off-screen / hidden tab | 0 frames rendered |

#### 6.2.6 Stills (fallback, Sign in, Open Graph)

A dev-only route `/dev/loop?beat=N&still=1` renders the scene frozen at the middle of beat `N` (`0…7`) with the scene clock fixed at a moment when a card is mid-flip in the gate (beat 0). `scripts/render-loop-stills.ts` (Playwright) screenshots the stage for each beat at 1200×1200 and 600×600 and writes `public/landing/loop-beat-{0..7}.{avif,webp}`. These files are used:

- as the Tier 0 story (all beats);
- as the server-rendered placeholder before the canvas mounts (beat 0);
- on Sign in and Sign up as a static image (beat 0, no WebGL there);
- as the Open Graph image (beat 7, cropped to 1200×630).

Alt text: `""` (decorative); the step text carries the meaning. Re-run the script whenever the scene changes.

#### 6.2.7 Proof that it works

Checks D15–D18, D23 and D24 (§1.2) automate this. For CI WebGL, launch Chromium with a software GL backend (for example `--use-angle=swiftshader`; **VERIFY** the current flag). Software rendering is slow, so CI checks **correctness** (renders, shapes, beats, draw calls), never FPS.

Manual sign-off before the 3D phase is done:

1. Desktop Chrome and Firefox (latest) on a laptop with integrated graphics: Tier 2, FPS target in §6.2.5 met (read from the dev overlay below), all eight beats correct in both scroll directions, no flicker, no popping-in.
2. Safari (latest macOS, if available): renders; any issue logged in `CONFLICTS.md`.
3. A mid-range Android phone (if available): Tier 1, FPS target met, no jank while scrolling.
4. Pause works and is remembered; reduced motion gives Tier 0 with the full story in stills.
5. Art-direction rubric (§6.2.11) passes.

**Dev overlay**: `?debug=3d` (development builds only) shows FPS, frame time, `gl.info.render.calls`, triangles, current tier and dpr. It also exposes the same numbers on `window.__dlLoopStats` for the D24 test.

`docs/redesign/3D-QA.md` records results: device, browser, tier, average FPS, draw calls, triangles, chunk size, and screenshots of beat 0 (three moments), beat 3 and beat 7.

#### 6.2.8 Sign in / Sign up

There is no WebGL on S01 or S02. The hero column shows the beat-0 still (`next/image`, `priority`) with the tagline. This keeps sign-in fast and shares the landing page's look.

#### 6.2.9 Icon pipeline (fixes "icons not in shape")

Malformed 3D icons almost always come from extruding **stroke** icons (outline icon sets draw with lines, and lines have no area to extrude), from SVG holes with the wrong winding, or from the SVG Y axis pointing down. So:

1. **Author the 3D icons as filled shapes.** Create `features/landing/three/icons/*.svg`: one file per icon (envelope, chat-bubble, calendar, shield-check, coin-check, stamp, person, clock-face, clock-hand, paper-plane, check). Each is drawn on a 24 × 24 grid with **closed, filled paths only**: no `stroke`, no `<line>`, no `<circle>` without a path equivalent, no transforms. Holes (the envelope flap gap, the bubble's inner dots) are separate subpaths wound opposite to the outer contour. **Do not** feed outline/stroke icon sets (such as the UI icon set) into the extruder.
2. **Parse once, at module load**, with `SVGLoader` (`import { SVGLoader } from 'three/addons/loaders/SVGLoader.js'`, verified in the three.js docs) using its synchronous `parse(text)` on the imported SVG string.
3. **Shapes**: three's docs mark `SVGLoader.createShapes(path)` as deprecated since r185; the logic moved to `ShapePath.toShapes()`. Use whichever the installed version supports (**VERIFY**), consistently for all icons.
4. **Extrude**: `new ExtrudeGeometry(shapes, { depth: 0.18 * 24, bevelEnabled: true, bevelThickness: 0.035 * 24, bevelSize: 0.025 * 24, bevelSegments: 3, curveSegments: 16 })` in SVG units, then scale to the target size (÷ 24 × size).
5. **Orient**: call `geometry.center()`, then flip the SVG's downward Y axis with **object** scale `scale.y = -1` on the mesh (the renderer corrects face winding for mirrored objects). **VERIFY** visually that no faces vanish. If they do, flip the shape points before extruding instead, and never fall back to `side: DoubleSide` on solid icons.
6. **Merge and cache**: merge each icon's sub-geometries into one (`mergeGeometries` from three's `BufferGeometryUtils`; **VERIFY** the name and path) and keep it in a module-level cache. Dispose on unmount.
7. **Prove the silhouettes** (D23): `/dev/loop?icon=<name>` renders one icon face-on with an orthographic camera, flat white unlit material on black. A Playwright test compares that mask with the source SVG rasterised at the same size. The overlap (intersection-over-union) must be ≥ 0.92 for every icon.

#### 6.2.10 Performance rules (fixes "laggy")

The first build was reported as laggy. Before rebuilding, profile it once (Chrome Performance panel, 10 s of scrolling S32) and note the top causes in `3D-QA.md`. Then follow every rule:

1. **No React state updates per frame or per scroll event.** Scroll progress, pointer position and the scene clock live in refs. React state may change only when the tier, dpr or pause state changes.
2. **No allocation in `useFrame`.** Preallocate every `Vector3`, `Quaternion`, `Color` and `Matrix4` at module or component scope and reuse them.
3. **Create geometries, materials and textures once** (module scope or `useMemo` with stable deps); share them; dispose on unmount.
4. **Instance repeated things** (flow dots, particles). Update instance matrices in place and set `instanceMatrix.needsUpdate` once per frame.
5. **No real-time shadows, no post-processing, no transmission or refraction materials**, no `Text`/font rendering in 3D.
6. **Adaptive resolution** with `PerformanceMonitor` (§6.2.2); dpr never above 1.5.
7. **Passive scroll and pointer listeners** that only write to refs; read layout (`getBoundingClientRect`) at most once per animation frame.
8. **Stable stage size**: use `svh` units for the sticky stage height so mobile browser bars do not resize the canvas mid-scroll.
9. **Pause when invisible** (§6.2.3 mount sequence).
10. **Damp everything** (`x += (target − x) × (1 − Math.exp(−delta × k))`) so motion is smooth regardless of frame rate. No `setInterval`-driven animation.
11. **Warm up before showing**: compile shaders during the still phase (R3F/three `gl.compile(scene, camera)`, **VERIFY**) so the first visible frames don't stutter.

#### 6.2.11 Art-direction rubric (fixes "dull" and "funky")

The scene should read as a **premium product render**: soft studio light, glossy clearcoat green, paper-white cards, one lime accent that glows. Every screenshot in `3D-QA.md` must pass all of these:

| # | Check |
|---|---|
| R1 | Only the 4 materials and the colours in §6.2.4. No rainbow, neon, gradients on objects, or random colours. |
| R2 | Every icon is instantly recognisable and passes D23; bevels look the same on every icon. |
| R3 | Cards never overlap, intersect the track, or flicker (no z-fighting). |
| R4 | No aliasing shimmer on card edges at Tier 2. |
| R5 | Something visibly happens at least every 2 s in the hero (a flip at the gate). |
| R6 | Motion is smooth: no jitter, no sudden jumps, no object faster than about 1.5 units/s except the one-shots. |
| R7 | Lighting is consistent: key light from upper left, blob shadows under everything, greens not washed out. |
| R8 | Composition: whole ∞ visible with margin; nothing clipped except the planned plane exit; the H1 never overlapped. |
| R9 | It matches the PDF preview page "The new hero: the Loop Track" in layout and mood. |

### 6.3 Motion table

| # | Trigger | What moves | Duration | Easing | Purpose | Reduced-motion fallback |
|---|---|---|---|---|---|---|
| M1 | Button pressed | Button scales to 0.98; background to `*-active` | `instant` 80 ms | `ease-standard` | Confirms the press registered | Colour change only |
| M2 | Field error appears | Message fades in and moves 4 px down → 0; border colour to error | `fast` 140 ms | `ease-enter` | Draws the eye to the field that needs work, without alarm | Fade only |
| M3 | Field becomes valid after an error | Error message fades out; small check icon fades in at the field end for 1.2 s | `fast` 140 ms | `ease-exit` / `ease-enter` | Rewards the correction; confirms it is fixed | Instant swap |
| M4 | Settings form becomes dirty / clean | Save bar slides up 16 px + fades in; reverse on clean | `base` 220 ms (exit 160 ms) | `ease-enter` / `ease-exit` | Signals unsaved changes exist | Fade only |
| M5 | Approval/task/proof/unknown send resolved | Row height and opacity collapse to 0; next row slides up (layout); nav count badge number cross-fades and the badge scales 1 → 1.12 → 1 | `base` 220 ms; badge `slow` 320 ms | `ease-exit`; badge `ease-settle` | Shows the item left the queue and the queue shrank | Row removed instantly; badge number changes; toast still shown |
| M6 | Payment recorded and invoice becomes Paid | Status chip cross-fades Overdue → Paid; check icon stroke draws 0 → 100% | `slow` 320 ms | `ease-standard` | The single most important outcome gets a visible moment | Instant swap; toast |
| M7 | Toast shown / dismissed | Enters from bottom-right (bottom-centre on mobile) 12 px + fade; exits fade | enter `base`, exit 160 ms | `ease-enter` / `ease-exit` | Confirms an action that changed data elsewhere | Fade only |
| M8 | Dialog / sheet open, close | Dialog: scale 0.98 → 1 + fade; backdrop fade. Sheet: slide from edge | `slow` 320 ms (close 220 ms) | `ease-enter` / `ease-exit` | Shows the layer sits above the page and where it came from | Fade only |
| M9 | Route change (staff app) | New page content fades in, 4 px rise (via `template.tsx`; enter only) | `base` 220 ms | `ease-enter` | Marks that the page changed without a jarring cut | None (instant) |
| M10 | Wizard step change (S04, S16) | Step panel slides 24 px in the direction of travel + fade; stepper dot fills lime | `slower` 480 ms | `ease-enter` | Communicates forward/back progress | Fade only |
| M11 | Overview first load | KPI tiles then attention rows fade in with 40 ms stagger (max 6 items) | total ≤ `slower` 480 ms | `ease-enter` | Guides the eye: totals first, then what needs action | No stagger; render at once |
| M12 | Copy button clicked | Copy icon cross-fades to check for 1.5 s; tooltip "Copied" | `fast` 140 ms | `ease-standard` | Confirms clipboard success | Instant swap |
| M13 | Data loading | Skeleton blocks pulse opacity 1 → 0.6 → 1 | 1200 ms loop | `ease-standard` | Shows that content is coming and its shape | Static skeleton |
| M14 | Landing stage ready (Tier 1–2) | Canvas fades in over the beat-0 still; cards flow along the ∞ track (one lap 20 s) and flip at the gate | fade `slow`; flow continuous | `ease-standard` / linear flow | Brand moment; shows the product idea live | Tier 0 still; canvas never mounts |
| M15 | Pointer moves over the hero stage (Tier 2, beat 0) | Ring tilt eases toward the pointer ±4° | damped, ~120 ms settle | exponential damping | The hero responds to the visitor | Disabled |
| M16 | Tablet rail expand / collapse | Rail width 72 → 264 px (overlay) | `base` 220 ms | `ease-standard` | Keeps spatial link between icon and label | Instant |
| M17 | Older timeline events loaded (S07) | New events fade in below with 4 px rise (scroll reveal via IntersectionObserver "Load older") | `base` 220 ms | `ease-enter` | Orients the user to where new history appeared | Instant |
| M18 | Hover on rows, cards, nav items | Background colour change | `fast` 140 ms | `ease-standard` | Shows what is interactive | Same (colour is allowed) |
| M19 | Hover a card or icon (Tier 2, beat 0) | Card lifts 0.18 units and faces the camera; an icon spins once and its lime detail brightens | damped ~150 ms; icon spin 600 ms | damping / `ease-settle` | Tactile; shows the scene is real and alive | None |
| M20 | Drag on the hero stage (Tier 2, pointer only) | Flow speed follows the drag (−1× to 4×) with inertia, then decays to 1× | decay 1.5 s | exponential decay | Play; invites exploring | Disabled |
| M21 | Scroll through How it works | Camera + story card move through beats 1–7 (§6.2.4); one-shots scrubbed by local progress, reversible | scroll-scrubbed; damped ~120 ms | per-keyframe damping | Shows each step while its text is read; keeps words and picture in sync | Tier 0: beat stills cross-fade `fast` on `data-beat` change (instant swap with reduced motion) |
| M22 | Beat 7 reached | Flip wave through every card (60 ms stagger); checks pop; the gate flares; one big burst; flow restarts | `duration-scene` 900 ms | `ease-settle` (checks) | Payoff: the loop closes | Beat-7 still |
| M27 | A card passes the paid gate (beat 0, continuous) | Card flips 180°, face turns paid, check pops out, gate pulses, 24-particle burst | flip 600 ms; burst 700 ms | `ease-settle` | Shows "comes back paid" every 2 s; keeps the hero alive | Beat-0 still shows a card mid-flip |
| M23 | Landing section enters viewport | Heading + body fade in, 12 px rise; cards stagger 60 ms (max 4) | `base` 220 ms | `ease-enter` | Guides reading order on a long page | Content visible immediately |
| M24 | Header scrolls past the hero | Header background transparent → surface; border + `elev-1` appear; text inverse → default | `base` 220 ms | `ease-standard` | Keeps the nav readable over light sections | Instant swap |
| M25 | Pause / Play pressed | Ambient motion stops or resumes; icon and label swap | `instant` 80 ms | `ease-standard` | WCAG 2.2.2 control; the choice is remembered | Control shows "Animation off" (Tier 0) |
| M26 | FAQ item opened | Answer fades in; height follows native `<details>` | `base` 220 ms | `ease-enter` | Shows where the answer appeared | Instant |

Rules: no animation on money values changing (they update instantly); no looping animation in the staff app except loading indicators (M13, MI15, MI26); scroll-linked motion exists **only** on the landing page (M21, M23, M24, ML5). The full list of required micro-interactions is §6.5.

### 6.4 Reduced motion implementation

- CSS: every transition uses tokens; the `prefers-reduced-motion: reduce` block overrides transform/layout durations to `1ms`.
- JS: `<MotionConfig reducedMotion="user">` at the root; components that need a different path (M5 badge, M6 stroke) read `useReducedMotion()`.
- 3D: reduced motion forces Tier 0 (§6.2.3); the canvas is never created and the story plays as stills.
- Test: D4.

### 6.5 Micro-interaction catalogue (v1.2)

> **v1.2.** The first build shipped almost no micro-interactions and very little motion in the app (defect B2, §0.5). Every row below is **required**. Each implementing element carries `data-motion="<ID>"` so the D20 test can find it.

**How to build them**

- **CSS** (hover, press, focus, colour): transitions using the motion tokens (§3.7). Put shared utilities in `styles/motion.css` (for example `.mi-press`, `.mi-lift`, `.mi-underline`).
- **shadcn / primitive enter-exit** (Select, Dropdown, Popover, Tooltip, Dialog, Sheet): `tw-animate-css` classes bound to the component's open/closed state (`data-[state=open]:animate-in`, `fade-in-0`, `zoom-in-95` and so on). `tw-animate-css` is the Tailwind v4 replacement for `tailwindcss-animate` (verified on npm). Map durations to our tokens.
- **Motion** (`motion/react`): layout animations (sliding indicators via `layoutId`), list enter/exit (`AnimatePresence`), staggered reveals. Shared variants live in `lib/motion/presets.ts` (`fadeUp`, `scaleIn`, `listItem`, `stagger(ms)`), so every screen moves the same way.
- **Reduced motion**: as §6.4. Each row's fallback column says what remains.
- **Performance**: animate only `transform`, `opacity`, colours and `box-shadow`. Never animate `width`, `height`, `top` or `left` except through Motion `layout`. No animation may block input.

**App (staff screens)**

| ID | Trigger | What moves | Duration | Easing | Purpose | Reduced motion |
|---|---|---|---|---|---|---|
| MI1 | Button hover / press (all variants) | Hover: background one step stronger + `elev-1` (primary only). Press: scale 0.98 | 140 / 80 ms | standard | Feels clickable; confirms the press | Colour only |
| MI2 | Button loading | Label cross-fades to spinner + "Saving…", width locked | 140 ms | standard | Shows work is happening | Instant swap |
| MI3 | Icon button hover | Circular background scales 0.8→1 and fades in | 140 ms | enter | Shows the hit area | Fade only |
| MI4 | Text link hover | Underline grows from the left (`scaleX` 0→1) | 140 ms | standard | Marks links without clutter | Underline appears |
| MI5 | Input focus | Border to primary; focus ring fades in; label turns primary | 140 ms | standard | Shows where typing goes | Colour only |
| MI6 | Input error / valid | M2 and M3 (message slides in; check fades in on fix) | 140 ms | enter / exit | Points at the field; rewards the fix | Fade only |
| MI7 | Search input has text | Clear (×) button fades and scales in | 140 ms | enter | Quick reset | Instant |
| MI8 | Select open / close | Content fades + zooms from 95% and slides 4 px from the trigger side; chevron rotates 180° | 140 ms open, 100 ms close | enter / exit | Shows where the list came from | Fade only |
| MI9 | Select item highlight / select | Highlight background follows the pointer or keyboard; the selected check pops (scale 0.6→1) | 80 / 220 ms | standard / settle | Shows the current option and confirms the choice | Instant |
| MI10 | Checkbox | Check path draws in (`stroke-dashoffset`) | 140 ms | standard | Confirms the toggle | Instant |
| MI11 | Switch | Thumb slides; track colour changes | 220 ms | settle | Physical on/off feel | Colour only |
| MI12 | Tabs (incl. status tabs on lists) | Active underline glides to the new tab (Motion `layoutId`) | 220 ms | standard | Shows what changed | Instant move |
| MI13 | Sidebar navigation | Active pill glides between items (`layoutId`); hover background fades | 260 / 140 ms | standard | Orientation across pages | Instant move |
| MI14 | Count badge changes | M5 bump; the digit rolls (old slides up and out, new slides in) | 320 ms | settle | Draws the eye to a changed count | Number changes instantly |
| MI15 | Filter applied (§4.10) | Thin progress bar at the top of the list while loading; on new results, rows fade + rise 4 px with 20 ms stagger (max 10 rows) | bar indeterminate; rows 220 ms | enter | Shows the filter worked without a full reload | Rows appear instantly; bar static |
| MI16 | Filter chip added / removed | Chip scales 0.9→1 and fades in; removal reverses; neighbours reflow (`layout`) | 220 ms | enter / exit | Shows active filters and what was removed | Instant |
| MI17 | Table row hover | Row background fades to `surface-sunken`; "Open ›" affordance fades in | 140 ms | standard | Shows the row is clickable | Colour only |
| MI18 | Interactive card hover | Lift `translateY(-2px)` + `elev-1` + border `border-strong` | 220 ms | standard | Clickable surfaces feel tactile | Border only |
| MI19 | Overview first load | M11 stagger; balance-by-status bars grow from 0 width (via `scaleX`, origin left) once per page load | 480 ms | enter | Guides the eye; makes data feel live | Static |
| MI20 | Page change | M9 (content fades in, rises 4 px) | 220 ms | enter | Marks navigation | None |
| MI21 | Dialog / sheet | M8 | 320 / 220 ms | enter / exit | Layering | Fade only |
| MI22 | Dropdown menu / popover | Fade + zoom from 95% from the trigger side | 140 / 100 ms | enter / exit | Origin of the menu | Fade only |
| MI23 | Tooltip | Fade + 2 px slide, after a 300 ms hover delay (instant on keyboard focus) | 140 ms | enter | Labels icon buttons | Fade only |
| MI24 | Toast | M7 plus a thin timer bar that shrinks over the auto-dismiss time | 220 ms; bar 5 s linear | enter | Confirms an action; shows time left | Static bar |
| MI25 | Copy button | M12 | 140 ms | standard | Confirms the copy | Instant |
| MI26 | Skeleton loading | Soft shimmer sweep across the block | 1 200 ms loop | linear | Shows that content is coming | Static block |
| MI27 | Queue item resolved | M5 (row collapses; next row slides up; badge bumps) | 220 ms | exit | Shows the queue shrank | Instant removal + toast |
| MI28 | Payment recorded | M6 (chip cross-fades to Paid; check stroke draws) | 320 ms | standard | The key outcome gets a moment | Instant + toast |
| MI29 | Save bar | M4 | 220 ms | enter / exit | Unsaved changes | Fade only |
| MI30 | Theme toggle | The selected segment's pill glides (`layoutId`); sun/moon icon rotates 90° and cross-fades | 220 ms | standard | Confirms the theme choice | Instant |
| MI31 | Stepper (onboarding, import) | Progress line fills to the next dot; the dot fills lime with a 1→1.15→1 pulse | 480 ms | enter / settle | Shows progress | Instant |
| MI32 | Empty state appears | Icon and title fade + rise 8 px | 320 ms | enter | Softens "nothing here" | Instant |
| MI33 | Pagination | Table body cross-fades between pages | 140 ms | standard | Shows the page changed | Instant |
| MI34 | Accordion / collapsible | Height animates (Motion `layout` or the primitive's CSS variable); chevron rotates | 220 ms | standard | Shows where content opened | Instant |

**Landing page**

| ID | Trigger | What moves | Duration | Easing | Purpose | Reduced motion |
|---|---|---|---|---|---|---|
| ML1 | Header link hover | Underline grows from the left | 140 ms | standard | Navigation affordance | Underline appears |
| ML2 | Primary CTA hover / press | Background brightens; a trailing arrow slides 4 px right; press scale 0.97 | 140 / 80 ms | standard | Invites the click | Colour only |
| ML3 | Section enters the viewport | M23 | 220 ms | enter | Reading order | Visible immediately |
| ML4 | Promise / safety card hover | Lift 4 px; icon tilts 6° (CSS 3D `rotateX/Y` toward the pointer, max 6°); border tint | 220 ms | standard | Tactile cards | Border only |
| ML5 | Scrolling the story | A vertical progress rail beside the steps fills in step with `data-beat`; the active step's number fills lime | follows scroll | — | Shows where you are in the seven steps | Rail jumps per step |
| ML6 | Header passes the hero | M24 (plus backdrop blur 8 px when over content) | 220 ms | standard | Readable nav | Instant |
| ML7 | FAQ open | M26 + chevron rotates 90° | 220 ms | enter | Shows the answer | Instant |
| ML8 | Trust line on load | Its check icon stroke draws in once | 480 ms | standard | Draws attention to the safety promise | Static |
| ML9 | Pause toggle | M25; icon morphs pause ↔ play | 140 ms | standard | Clear state change | Instant |

**Rules**: no shake on errors; no confetti; no count-up animation on money; no looping animation in the staff app except MI26 (skeleton) and MI15's progress bar; every row must also work by keyboard where the trigger is interactive (focus counts as hover for MI3, MI4, MI17, MI18, ML1, ML2).

**Proof** (D20): a dev-only `/dev/motion` gallery shows every MI and ML row with its trigger. A Playwright test iterates over every `data-motion` ID, fires the trigger, and asserts that motion happened: either `element.getAnimations().length > 0` during the transition (CSS transitions and Web Animations), or a computed-style change between 40 ms and the end duration (Motion's JS-driven values). With reduced motion, the same test asserts the fallback column.

---

## 7. Components

Prefer the component library the repo already uses (Phase 0). If none: native elements first (`<button>`, `<a>`, `<select>`, `<input type="date">`, `<dialog>` with `showModal()` for Dialog/Sheet), and a headless accessible library for Combobox, Menu, Tabs, Tooltip — candidates **React Aria Components** or **Radix UI primitives**; **VERIFY** current versions and React 19 support before choosing, and record the choice in `INVENTORY.md`.

Icons: one outline icon set at 1.75 px stroke, 16/20/24 px. If the repo has one, keep it; otherwise **VERIFY** and use `lucide-react`. Decorative icons `aria-hidden="true"`.

Every component in §7.2 also carries its micro-interactions from §6.5; a component without them is not done (D20).

### 7.1 State model (applies to every interactive component)

| State | Rule |
|---|---|
| default | Tokens as listed per component |
| hover | Background or border one step stronger; `duration-fast`; pointer devices only (`@media (hover: hover)`) |
| focus-visible | `outline: 2px solid var(--color-focus-ring); outline-offset: 2px;` (on the inverse sidebar and in dark mode the ring is lime). Never removed; never only a colour change |
| active | `*-active` colour + M1 |
| disabled | Use sparingly — prefer hiding role-blocked actions. Opacity 1 with `--color-surface-sunken` background, `--color-text-muted` text, `cursor: not-allowed`, `aria-disabled="true"` when it must stay focusable to show a tooltip explaining why |
| loading | Spinner (16 px) + verb label ("Saving…"), width locked, `aria-busy="true"` on the region |
| empty | `EmptyState` (§4.8) |
| error | Error border + message (fields) or error Banner (regions) |

### 7.2 Inventory

| Component | Variants / notes | default | hover | focus-visible | active | disabled | loading | empty | error |
|---|---|---|---|---|---|---|---|---|---|
| **Button** | primary, secondary, ghost, destructive, link; sizes sm 36 px (desktop dense only, hit area extended to 44 px), md 44, lg 52 | primary: `primary` bg, `on-primary` text, `radius-md` | `primary-hover` | ring | `primary-active` + M1 | see 7.1 | spinner + "Saving…" | — | — |
| **IconButton** | ghost, secondary; always `aria-label` | 44×44, icon `text-muted` | bg `surface-sunken` | ring | M1 | 7.1 | spinner replaces icon | — | — |
| **TextField** | **shadcn `Input`** (§7.3): text, email, password (show/hide), search (clear ×, MI7) | 44 px, `border-strong`, `radius-sm`, label above | border `text` | ring + border primary (MI5) | — | read-only text instead | trailing spinner (async check only) | placeholder never replaces label | error border + message (MI6) |
| **Textarea** | auto-grow to 10 lines, char counter when max set | as TextField | as TextField | ring | — | as above | — | — | as TextField |
| **MoneyField** | currency code as non-editable suffix; `inputMode="decimal"`; right-aligned tabular | as TextField | — | ring | — | — | — | — | format errors (§5.6) |
| **DateField** | native `type="date"` styled; min/max from rules | as TextField | — | ring | — | — | — | — | as TextField |
| **Select** | **shadcn `Select`** for every select (§7.3); no native `<select>` | as TextField + chevron | border `text` | ring; open → MI8 | item highlight + check pop (MI9) | items not rendered if not permitted | — | "No options" | `aria-invalid` on trigger; as TextField |
| **Combobox** | searchable (time zones, currencies, templates); shadcn's Combobox recipe (§7.3) | as TextField | — | ring; active option `primary-soft` | — | — | "Searching…" row | "No matches for '{q}'" | as TextField |
| **Checkbox / Radio** | 20 px box, label clickable, group in `fieldset` + `legend` | `border-strong` | border `text` | ring around box | — | 7.1 | — | — | group message under legend |
| **Switch** | for on/off settings that apply on save | track stone-300, thumb white | — | ring | thumb slides `fast` | 7.1 | — | — | — |
| **FileDrop** | drop zone + "Choose file" button | dashed `border-strong`, `radius-xl` | border primary, bg `primary-soft` | ring on button | — | — | progress bar + filename | — | type/size errors |
| **FormField** | wrapper: label, help, message, required marker "(required)" in text | — | — | — | — | — | — | — | owns `aria-describedby` |
| **StatusChip** | 8 statuses (§3.1.5); sm/md | icon + label, `radius-full` | none (not interactive) | — | — | — | — | — | — |
| **CountBadge** | lime + ink; dot variant on rail | `radius-full`, tabular | — | — | — | — | — | hidden at 0 | — |
| **TypeChip** | task/attention types | status-colour pairs | — | — | — | — | — | — | — |
| **DataTable** | sortable headers (`aria-sort`), sticky header (`elev-1` on scroll), selectable rows only if bulk actions exist | rows 52/40 px, hairline dividers | row bg `surface-sunken` | ring on the row link | — | — | 5 skeleton rows | EmptyState | Banner in table body + Retry |
| **Pagination** | prev/next + "1–25 of 46" | ghost buttons | as Button | ring | M1 | at ends | — | hidden if one page | — |
| **Tabs** | underline style; counts in tabs | text-muted | text | ring | indicator primary 2 px | — | — | — | — |
| **FilterBar** | search + shadcn selects + chips + "Clear filters" (shown only when filtered); **auto-applies** (§4.10); no Apply button | — | — | — | — | — | MI15 progress bar; `aria-busy` | — | Banner + Retry |
| **FilterChip** | one per active filter; × removes it | `primary-soft` bg, `primary-soft-text` | bg one step stronger | ring on × | MI16 | — | — | — | — |
| **Card** | flat (border), interactive (link) | surface, border, `radius-xl` | border `border-strong` + `elev-1` | ring | — | — | skeleton | EmptyState inside | Banner inside |
| **KpiTile** | label, figure (display-md), sub-line, link | Card | Card hover | ring | — | — | skeleton figure | "—" with sub-line "No data yet" | "Couldn't load" + retry link |
| **Banner** | info, warning, error, success, paused (inverse) | status pair, icon, optional action | — | ring on action | — | — | — | — | — |
| **Toast** | success, info, error; auto-dismiss 5 s (errors persist until closed); pause on hover/focus | surface, `elev-3` | — | ring on close | — | — | — | — | error variant |
| **Dialog** | sm 420 / md 520 / lg 720; mobile full-screen sheet | `elev-4`, `radius-xl` | — | first field or title focused on open; focus trapped; Esc closes; focus returns to trigger | — | — | footer button loading | — | form error banner |
| **Sheet** | left (mobile nav), right (filters on mobile), bottom (mobile dialogs) | as Dialog | — | as Dialog | — | — | — | — | — |
| **DropdownMenu** | actions ("⋯ More") | `elev-2`, `radius-lg` | item bg `surface-sunken` | item ring / active-descendant | — | items not rendered if not permitted | — | — | — |
| **Tooltip** | label for icon-only controls; shows on hover and focus; never holds essential info | inverse surface, inverse text, `radius-sm` | — | shows | — | — | — | — | — |
| **Timeline** | event rows with icon, time, actor, plain-text body | — | — | links ring | — | — | skeleton | "No events yet" | Banner |
| **MessageBubble** | sent (right, `primary-soft`), received (left, `surface-sunken`); plain text `pre-wrap` | — | — | — | — | — | — | — | failed send: warning outline + "Result unknown" |
| **EmptyState** | §4.8 | — | — | ring on action | — | — | — | — | — |
| **Skeleton** | text line, block, row | `surface-sunken` | — | — | — | — | M13 | — | — |
| **Stepper** | horizontal (desktop), text + progress bar (mobile) | done = primary, current = lime ring, todo = stone | — | — | — | — | — | — | step with error shows error icon |
| **SaveBar** | sticky bottom, `elev-3` | appears when dirty (M4) | — | ring | — | Save disabled while invalid? **No** — Save enabled; submit shows errors | "Saving…" | — | "Couldn't save" + retry |
| **SidebarNav / Rail** | inverse surface; groups; counts | text `inverse-muted` | bg `surface-inverse-raised` | lime ring | — | — | — | — | — |
| **TopBar** | mobile 56 px; desktop header 64 px | — | — | — | — | — | — | — | — |
| **UserMenu / ThemeToggle** | ThemeToggle = 3-option segmented radio group System/Light/Dark on next-themes (§3.1.4) | placeholder of same size until mounted | segment bg fades | ring on segment | pill glides (MI30) | — | — | — | — |
| **CopyButton** | icon + tooltip | IconButton | — | ring | M12 | — | — | — | "Couldn't copy" tooltip |
| **CodeValue** | IDs, keys, references; tabular, `surface-sunken`, copy | — | — | — | — | — | — | — | — |
| **ProgressBar** | determinate (upload, import) | track stone-200, fill primary | — | — | — | — | — | — | fill error |
| **SearchCommand** | ⌘K / Ctrl K dialog; results grouped Invoices / Customers | Dialog | option bg `primary-soft` | active-descendant | — | — | "Searching…" | "No results for '{q}'" | Banner |
| **BackLink** | "‹ Invoices" | link | underline | ring | — | — | — | — | — |
| **LandingHeader** | transparent over hero → surface (M24); menu sheet on tablet/mobile | inverse text on hero | link underline | ring (lime on hero) | — | — | — | — | — |
| **StoryWrapper** | two columns (text + sticky stage); exposes `data-beat` | — | — | — | — | — | — | — | — |
| **LoopStage** | canvas container; fixed size; `data-tier`, `data-3d-state` (`running`/`paused`/`static`) | beat-0 still, then canvas | — | — | — | — | still visible until first frame | — | WebGL context lost → Tier 0 stills |
| **PauseToggle** | `<button aria-pressed>` with icon + visible label "Pause animation" / "Play animation" | inverse-raised bg | lighter bg | lime ring | M1 | — | — | — | — |
| **StoryStep** | numbered step block, `min-height: 80vh` (70vh tablet) | text-muted when inactive | — | — | `aria-current="step"`, full text colour | — | — | — | — |
| **FeatureCard** | promise / safety cards | Card | — | — | — | — | — | — | — |
| **FaqItem** | native `<details>/<summary>` | chevron right | bg `surface-sunken` | ring on summary | chevron down (M26) | — | — | — | — |
| **CtaBand** | inverse surface; one headline + one button | — | — | — | — | — | — | — | — |
| **PricingCard** | built, **not rendered** until Q18 | Card | — | — | — | — | — | — | — |
| **SiteFooter** | wordmark + links that exist | — | underline | ring | — | — | — | — | — |

### 7.3 Form fields with shadcn/ui, styled to Dueloop (v1.2)

> **v1.2.** All text inputs and selects use **shadcn/ui** components, restyled with Dueloop's tokens (defect B3, §0.5). This replaces v1.1's rule of using native `<select>` for short lists.

**Setup**

1. shadcn needs Tailwind CSS. If the repo has no Tailwind, install Tailwind v4 by its official Next.js guide first (allowed by §10.2). Then run `pnpm dlx shadcn@latest init` (**VERIFY** the prompts). If a `components.json` already exists, keep its settings.
2. **One primitive library.** shadcn's current Select docs default to **Base UI**, and a **Radix UI** version is offered as an alternative. If the repo already has shadcn components, use the primitive they use. Otherwise use the CLI's default. Never mix the two. Record the choice in `INVENTORY.md`. The props for value changes differ between them, so **VERIFY** against the generated file.
3. Add the components: `pnpm dlx shadcn@latest add input select label textarea` (verified install command pattern from the shadcn Select docs). For searchable lists (time zone, currency, template), use shadcn's current Combobox recipe (**VERIFY**). Optional, when replacing those primitives: `checkbox switch radio-group dropdown-menu popover tooltip dialog sheet tabs`.
4. The generated files under `components/ui/` are **our code**: edit their class names as below. Do not wrap them in a second layer of components.

**Token bridge.** Point shadcn's CSS variables at our semantic tokens in `globals.css`, once for light and once inside `.dark`, so every shadcn component inherits the palette. **VERIFY** the exact variable names in the generated `globals.css` and map every one of them:

| shadcn variable | Dueloop token |
|---|---|
| `--background` / `--foreground` | `--color-bg` / `--color-text` |
| `--card`, `--popover` / their `-foreground` | `--color-surface` / `--color-text` |
| `--primary` / `--primary-foreground` | `--color-primary` / `--color-on-primary` |
| `--secondary`, `--muted` / their `-foreground` | `--color-surface-sunken` / `--color-text` and `--color-text-muted` |
| `--accent` / `--accent-foreground` (shadcn uses these for hover and highlight backgrounds, **not** the brand accent) | `--color-primary-soft` / `--color-primary-soft-text` |
| `--destructive` | `--color-error-text` |
| `--border` | `--color-border` |
| `--input` | `--color-border-strong` (input edges need 3:1) |
| `--ring` | `--color-focus-ring` |
| `--radius` | `10px` (our `radius-md`) |

Our lime accent is never mapped to shadcn's `--accent`.

**Our styling (edit the generated components to match)**

| Part | Spec |
|---|---|
| **Input** | Height 44 px (36 px "sm" for dense desktop filter bars, with the hit area extended to 44 px). `radius-sm` (8 px). 1 px `--input` border. `--color-surface` background. `body-md` text; placeholder `--color-text-muted`. Hover: border `--color-text`. Focus-visible: border primary + 2 px ring `--ring`, offset 2 px (MI5). `aria-invalid="true"`: 2 px error border, and the ring turns error on focus. Read-only: `--color-surface-sunken` background, no border change on hover. Optional leading icon (search) and trailing slot (currency code, clear ×, show-password toggle) inside the field. |
| **Select trigger** | Same shell as Input (height, radius, border, focus, invalid). Value in `--color-text`; placeholder `--color-text-muted`; chevron icon `--color-text-muted`, rotates 180° when open (MI8). Full width in forms; content width in filter bars. |
| **Select content** | `--color-surface`, 1 px `--color-border`, `radius-lg` (12 px), `elev-2`, padding 4 px, max height 320 px with scroll, at least the trigger's width. Enter/exit motion: MI8 with `tw-animate-css`, mapped to `duration-fast`. |
| **Select item** | Height 40 px, `radius-sm`, `body-sm`, horizontal padding 12 px. Highlighted (pointer or keyboard): `--color-primary-soft` background, `--color-primary-soft-text` text. Selected: check icon in `--color-primary` on the right, popping in (MI9). Disabled: `--color-text-muted`, no highlight. Group labels use the `label` type token. |
| **Label** | `body-sm`, weight 600, 6 px above the field. Required fields show the text "(required)" in `--color-text-muted`, never only an asterisk. |
| **Help and error text** | Help: `caption`, `--color-text-muted`. Error: `caption`, `--color-error-text`, with an alert icon, linked by `aria-describedby` (as §5.7). |
| **Textarea** | Same as Input; auto-grows to 10 lines; character counter when a max is set. |
| **Date** | Keep a native `type="date"` input, styled with the Input classes. A shadcn date picker is not required. |

**React Hook Form wiring**

- `Input` and `Textarea`: `register("field")`. **VERIFY** that the generated component forwards `ref` (React 19 passes `ref` as a prop).
- `Select`: use RHF's `Controller` (it is not a native input). Map `field.value` and `field.onChange` to the primitive's value props (Radix: `value` / `onValueChange`; Base UI: **VERIFY**). Pass `aria-invalid` to the trigger, as the shadcn docs show.
- Filters (§4.10) use the same components, but are not RHF forms: they call `setFilter` directly.

**Acceptance (D22)**:
- `grep` finds no native `<select>` element in app code, and every text input imports `@/components/ui/input`;
- axe passes on every form;
- with the keyboard, a Select opens with Enter, Space or ArrowDown, supports typeahead, closes with Escape, and returns focus to the trigger;
- every state in the table above is visible in `/dev/components`, in light and dark.

---

## 8. Accessibility and performance

### 8.1 Accessibility (WCAG 2.2 AA)

**Keyboard**
- First Tab on every page focuses a **"Skip to content"** link (`z-skip-link`).
- Order: skip link → header (business, search, theme, user) → sidebar → main. Page actions come right after the page title in DOM order.
- Menus, tabs, listboxes, comboboxes: arrow keys move, Home/End jump, Enter/Space activate, Esc closes and returns focus.
- Dialogs: focus moves in on open, is trapped, Esc closes, focus returns to the trigger.
- Queues (S11–S14): after a decision, focus moves to the next item's heading in the detail pane; if none, to the EmptyState title.
- ⌘K / Ctrl K opens search. **No single-character shortcuts** (WCAG 2.1.4).

**Focus rings**: as §7.1; contrast ≥ 3:1 against both adjacent colours (verified in §3.1.3). Focus is never hidden under sticky headers (`scroll-margin-top` = header height + 8 px).

**Semantic HTML**
- Landmarks: `header`, `nav[aria-label="Main"]`, `main#content`, `footer` where present. One `h1` per page = page title; headings never skip levels.
- Tables: `<table>`, `<caption>` (visually hidden when the page title already says it), `<th scope="col">`, `aria-sort` on sortable headers. Mobile card lists are `<ul>` with each card an `<li>` containing a heading link.
- Forms: `<label for>`, `fieldset`/`legend` for groups, `aria-invalid`, `aria-describedby` → help + error ids, `autocomplete` attributes (`email`, `current-password`, `new-password`, `organization`).
- Status: chip text is real text; count badges have an accessible name ("Approvals, 3 waiting").
- Live regions: one polite region for toasts and save status; form error banners `role="alert"`.
- Customer/AI text: plain text only (security rule) with `white-space: pre-wrap`.

**ARIA only where needed**: `aria-label` on icon-only controls; `aria-current="page"` on the active nav link; `aria-expanded` on disclosure buttons; `aria-busy` on loading regions. No `role="button"` on non-buttons.

**Also**: `lang` set on `<html>`; text resizes to 200% without loss; reflows at 320 px width; targets ≥ 44×44 px (sm buttons extend hit area); no information by colour alone; respects `prefers-reduced-motion` and `prefers-color-scheme`; `forced-colors: active` keeps outlines and chip borders visible (add `border: 1px solid transparent` to chips so Windows High Contrast draws them).

**Landing page (S32)**
- WCAG 2.2.2 (Pause, Stop, Hide): ambient 3D motion runs longer than 5 s, so the Pause control is required, visible and keyboard-reachable. It comes in the tab order right after the hero CTAs.
- Canvas `aria-hidden="true"`; it never takes focus and never traps scroll (no wheel or touch capture; drag is pointer-mouse only).
- Every step's meaning is in the HTML text; nothing is conveyed only by the 3D.
- Headings: one `h1` (hero); each section has an `h2`; steps are an ordered list (`<ol>`) of `h3` + paragraph.
- Anchor links move focus to the target section heading (`tabindex="-1"` on headings) and respect `scroll-margin-top`.
- The beat-0 still and stage keep text contrast rules: no text is placed on top of the canvas.

### 8.2 Performance

| Target | Value |
|---|---|
| Lighthouse (mobile preset, production build) | Performance ≥ 90 · Accessibility 100 · Best Practices ≥ 95 (S01, S05, S06, S25) |
| LCP / CLS / TBT (lab) | ≤ 2.5 s / ≤ 0.05 / ≤ 200 ms |
| First-load JS per staff route | No route grows by more than 15% over the Phase 0 baseline (fonts excluded) |
| Pay page (S25) first-load JS | ≤ Phase 0 baseline; no Motion, no three, no icons beyond the few used (tree-shaken) |
| 3D chunk | Target ≤ 250 KB gzip (cap 300), lazy, only on S32 (D8); scene budget in §6.2.5 |
| Landing page (S32) | Statically rendered; Lighthouse per D19; H1 is LCP; stills ≤ 120 KB each (AVIF) |
| Fonts | 2 variable files (Inter, Bricolage Grotesque), latin subset, self-hosted by `next/font`, `display: swap` |
| Images | `next/image`, AVIF/WebP, explicit width/height (no CLS) |
| Server | The demo VM has 1 GB RAM: no new server-side work per request; the landing page is static; 3D is client-only (`ssr: false`) |

Measure with `@next/bundle-analyzer` (**VERIFY** setup for the installed Next.js) and Lighthouse CI or the Lighthouse CLI against `next start`.

---

## 9. Implementation plan

Rules for every phase: work on a branch `redesign/<phase>`; commit at the end of each phase; **do not push or open a PR unless the user asks**; run the full existing test suite at the end of each phase (D9 must stay green); record deviations in `docs/redesign/CONFLICTS.md`.

**If phases 0–7 were already built from v1.1**, run only Phase 8 (a → e), in that order, stopping after each sub-phase for the user's review.

**Before Phase 0**: run `git status`. The overview says the live build was not committed. If the working tree has uncommitted changes, **stop and ask the user to commit them first**, so the redesign diff stays separate.

| Phase | Goal | Files to create / change (proposed paths) | Dependencies | Verify it is done |
|---|---|---|---|---|
| **0 · Discovery** | Know the real app | `docs/redesign/INVENTORY.md`, `docs/redesign/CONFLICTS.md` | none | §0.4 items 1–7 complete; baseline recorded |
| **1 · Tokens** | Foundations everyone uses | `styles/tokens.css` (all of §3), global CSS import, `app/fonts.ts`, root `layout.tsx` (font variables, `suppressHydrationWarning`, next-themes provider per §3.1.4, skip link), `scripts/check-contrast.ts` (port of the pair list in §3.1.3, including forbidden pairs), Tailwind `@theme`/config mapping **only if Tailwind exists**, dev-only `/dev/tokens` page (404 in production) | none new (`tsx` as dev dep only if not present) | D1 passes; `/dev/tokens` shows every token in light and dark; no visual regressions besides colours/fonts |
| **2 · Components** | Primitives with all states | `components/ui/*` per §7, `components/ui/StatusChip.tsx` (§3.1.5), dev-only `/dev/components` gallery showing every state | headless library and icon set **only if** none exist (VERIFY versions) | D13; axe on the gallery = 0 serious/critical; keyboard pass over the gallery |
| **3 · Layout & screens** | Every screen in §4, including S32 without 3D | App shell (`app/(app)/layout.tsx`), each screen's page components; public pages restyled in place; landing: `app/(marketing)/page.tsx` (route per A6), `app/(marketing)/layout.tsx`, `features/landing/*` sections with the §4.9.4 copy, stage showing a placeholder still until Phase 6, metadata (VERIFY the Next.js metadata API for the installed version), signed-in redirect | none | D5 screenshots for every route incl. S32; D2; role-gated items not rendered for collector (test with each role); every §4.9.4 string present verbatim |
| **4 · Domain & forms** | Schemas + RHF everywhere | `domain/*.ts` (§5.2), `forms/*.schema.ts`, `forms/*Form.tsx` for F01–F22, schema unit tests, type-parity tests | `react-hook-form`, `@hookform/resolvers` (≥ 5 if Zod 4), `zod` — **only if missing**; match existing majors | D11; D10 (payloads unchanged — compare request bodies in integration tests before/after); D3 |
| **5 · Motion** | M1–M13, M16–M18, M23–M26 | `app/providers.tsx` (MotionConfig), `app/(app)/template.tsx` (M9), motion utilities in `components/motion/*` | `motion` | D4; manual review: every row of §6.3 observed once with and once without reduced motion |
| **6 · 3D** | The Loop, working end to end (§6.2; M14, M15, M19–M22) | `features/landing/three/` — `LoopStage.tsx`, `LoopScene.tsx`, `Ring.tsx` (instanced cards), `StoryCard.tsx`, `props/{CsvSheet,Rail,Stamp,Clock,PaperPlane,SpeechBubble,Seal,Receipt}.tsx`, `keyframes.ts` (§6.2.4 table as data), `useScrollProgress.ts`, `useGpuTier.ts`, `useFpsWatchdog.ts`, `LoopStill.tsx`; `features/landing/PauseToggle.tsx`; dev-only `app/dev/loop/page.tsx`; `scripts/render-loop-stills.ts`; `public/landing/loop-beat-{0..7}.{avif,webp}`; S01/S02 switch to the beat-0 still; `next.config` (`transpilePackages: ['three']`, analyzer); `docs/redesign/3D-QA.md` | `three`, `@react-three/fiber` (9 for React 19, 8 for React 18); dev: `@types/three`, `@next/bundle-analyzer` | D8, D15–D19; manual QA in §6.2.7 recorded in `3D-QA.md`; unit tests for `keyframes.ts` (pure functions: beat → camera/card values) and `useGpuTier` decisions |
| **7 · Polish** | Ship quality | Copy pass (§5.6, §4.8, §4.9.4), dark-mode QA, empty/error states, `forced-colors` check, Open Graph image check, docs: `docs/redesign/CHANGELOG.md` | none | All of D1–D25; `CONFLICTS.md` has no open items or each is listed for the user |
| **8a · Theme fix (B5)** | Theme buttons work | Root cause in `CONFLICTS.md`; `components/theme-provider.tsx`; root layout; `tokens.css` dark block → `.dark`; `ThemeToggle.tsx`; remove the cookie code | `next-themes` (only if missing) | D21; D1 still passes in both themes |
| **8b · shadcn fields (B3)** | One input/select system | Tailwind v4 if missing; `components.json`; `components/ui/{input,select,label,textarea}.tsx` restyled (§7.3); token bridge in `globals.css`; replace every native `<select>` and ad-hoc input; RHF `Controller` for Selects | `tailwindcss` v4 + `@tailwindcss/postcss` (if missing; **VERIFY** per Tailwind's Next.js guide), shadcn CLI, the primitive library it installs, `tw-animate-css` | D22; D11 still passes; payloads unchanged (D10) |
| **8c · Auto filters (B4)** | Filters apply on change | `domain/*-list-params.ts` schemas; `features/lists/useListFilters.ts`; FilterBar, FilterChip; every list page reads parsed params | none | D25; D9 still green |
| **8d · Micro-interactions (B2)** | The app and site feel alive | `styles/motion.css`; `lib/motion/presets.ts`; every component per §6.5; `data-motion` IDs; dev-only `/dev/motion` | `motion` (already from Phase 5), `tw-animate-css` | D20; D4 still passes |
| **8e · 3D rebuild (B1)** | Premium, smooth hero | Profile the old scene first (§6.2.10). Rebuild `features/landing/three/*` per §6.2: `Track.tsx`, `FlowCards.tsx`, `CardFaceMaterial.ts`, `Gate.tsx`, `Burst.tsx`, `FlowDots.tsx`, `FloatingIcons.tsx`, `icons/*.svg` + `iconGeometry.ts`, `Lighting.tsx`, `keyframes.ts`, `DebugOverlay.tsx`; regenerate stills | `@react-three/drei` (whitelist in §6.2.2) | D8, D15–D18, D23, D24; rubric §6.2.11; `3D-QA.md` with FPS and screenshots |

---

## 10. Out of scope

### 10.1 Do not change

- Business logic in the core package, the state machine, the ledger, policies' evaluation, sending pipeline, idempotency, kill-switch semantics.
- API routes, REST contracts, server actions' input/output schemas, webhook handlers, the `worker`, `processor` and `webhooks` programs.
- Database schema, migrations, RLS policies, pgTAP tests, pg_cron jobs, queues.
- Authentication flows and rules (Supabase Auth configuration, password rules, rate limits).
- Data flow: what is fetched, from where, and when (beyond adding response parsing in development as described in §5.2, which must not change runtime behaviour in production builds if parsing would throw — log instead).
- Security headers' strictness, CSP nonce handling, the plain-text rendering rule for untrusted text, token handling on public pages, `noindex`/no-cache headers.
- Email and WhatsApp message templates' content and the banned-phrase list (the Templates **editor UI** is in scope; default template wording is not).
- Docker images, Compose files, Caddy config, deployment.
- Adding features: SMS, email-reply reading, re-subscribe screen, translations/RTL, white-labelling, billing, analytics or tracking scripts, newsletter/waitlist forms.

### 10.2 Allowed exceptions (only these)

1. ~~Reading/writing the `dl-theme` cookie~~ (v1.2: removed). The theme preference lives in `localStorage` under `dl-theme`, through next-themes (§3.1.4).
2. Dev-only routes `/dev/tokens`, `/dev/components`, `/dev/loop` and `/dev/motion` (must return 404 in production builds).
3. Static assets under `public/landing/` (beat stills, Open Graph image).
4. `next.config` additions: `transpilePackages: ['three']`, bundle analyzer behind an env flag.
5. New client dependencies listed in §9 (and only if missing).
6. Development-only response parsing with the domain schemas.
7. The landing route (S32) and a redirect from `/` to Overview for signed-in users, using the **existing** session check (no auth changes). If `/` is currently the dashboard, ask first (A6).
8. Page metadata, Open Graph tags and allowing indexing **for S32 only**.
9. A dev-only script `scripts/render-loop-stills.ts`.
10. Installing Tailwind CSS v4, the shadcn CLI output (`components.json`, `components/ui/*`), its primitive library and `tw-animate-css` (§7.3).
11. `next-themes` and the root-layout changes it needs (§3.1.4).
12. `@react-three/drei`, importing only the helpers listed in §6.2.2.
13. Dev-only routes `/dev/motion` and the `?debug=3d` overlay (both absent from production builds).

Anything else that seems necessary: stop, add to `CONFLICTS.md`, and ask the user.

---

## 11. Open questions

The implementing session must not guess these. Where a default is given, it applies until the user answers; log the default used.

| # | Question | Default until answered |
|---|---|---|
| Q1 | Is there a "forgot password" / reset route? | Hide the "Forgot?" link |
| Q2 | Are there terms/privacy pages to link on Sign up? | No legal line |
| Q3 | Supabase Auth password minimum length and resend-confirmation cooldown? | Read from Supabase config in Phase 0; if unreadable, no client-side length rule (server errors shown) and a 60 s cooldown display |
| Q4 | Can one user belong to several businesses? | Business switcher hidden unless the API returns > 1 business |
| Q5 | Is there a search endpoint for ⌘K? | If not, ⌘K searches only invoice numbers on the current list page; log it |
| Q6 | Can one business have invoices in several currencies? How should Overview totals work then? | Show totals per currency with a currency selector; never sum across currencies |
| Q7 | Does the API expose a "next step" per invoice (next reminder date/channel)? | Remove the "Next step" column |
| Q8 | Can collectors see the Approvals queue read-only, or not at all? | Not at all (matrix gives them no approve permission) |
| Q9 | Who can manage API keys? (The matrix does not say.) | Owner only |
| Q10 | ~~Is there a landing page?~~ **Answered:** add one (S32) for small businesses signing up to hosted Dueloop. | — |
| Q11 | Number/date formatting locale per business? | Use the business's time zone for dates and the browser locale for formatting; amount **input** accepts `.` as decimal separator only |
| Q12 | Is there a logo, or should the wordmark be typographic? Note the overview says the name "Dueloop" is not trademark-checked. | Typographic wordmark in one `Wordmark` component so the name can be swapped in one place |
| Q13 | Is the monthly WhatsApp/SMS budget an amount of money or a message count? | Show the unit the API returns; if unknown, label "Monthly budget" with help text "0 blocks sending on this channel" |
| Q14 | Should WhatsApp-related UI be hidden when the channel is switched off (as in the current deployment)? | Show WhatsApp as "Off" in Integrations; hide WhatsApp filters elsewhere |
| Q15 | Does an approval become revocable after approving? | Copy states that approving sends at the next allowed time |
| Q16 | Should the Pay page show the business's own branding (logo/colour)? | No (white-labelling is out of scope); business name as text only |
| Q17 | Default theme for new users? | System |
| Q18 | Pricing: plans, prices, currency, free trial? | Pricing section not rendered; no price mentioned anywhere |
| Q19 | Do privacy-policy, terms and contact/support pages exist? | Footer shows only links that exist; nothing is invented |
| Q20 | Legal entity name for the © line? | "© {year} Dueloop" and a note in `CONFLICTS.md` (the name is not trademark-checked, Q12) |
| Q21 | Any analytics on the landing page? | None (adding tracking is out of scope) |
| Q22 | May real product screenshots appear on the landing page? | No; only the 3D scene and the illustrative ledger card, never real customer data |
| Q23 | Production domain for canonical and Open Graph URLs? | Read from an env var (e.g. `NEXT_PUBLIC_SITE_URL`); if unset, omit canonical and absolute OG URLs |
| Q24 | Should signed-up visitors land on Onboarding (S04) directly after sign-up? | Keep the existing post-sign-up flow unchanged |
| Q25 | Should the theme choice follow the user across devices? | No: per browser (localStorage). A per-account setting would need a schema change (out of scope) |
| Q26 | If shadcn is not in the repo yet: Base UI or Radix primitives? | The shadcn CLI default at install time; record it in `INVENTORY.md` |
| Q27 | Which filters does each list endpoint support server-side? | Expose only supported filters; list missing ones in `CONFLICTS.md` |

---

## Appendix A — Verified references

Checked by the spec author on 2 November 2026; v1.2 rows checked on 3 November 2026. Re-check against installed versions (§0.4).

| Claim used in this spec | Source |
|---|---|
| `zodResolver` imported from `@hookform/resolvers/zod`; latest listed version 5.2.1; `useForm<z.input<…>, any, z.output<…>>` pattern; README shows `zod` or `zod/v4` import | [npm: @hookform/resolvers](https://npmjs.com/@hookform/resolvers) |
| R3F 9.x pairs with React 19, 8.x with React 18; `pnpm add three @react-three/fiber`; Next.js ≥ 13.1 uses `transpilePackages: ['three']` | [R3F installation](https://r3f.docs.pmnd.rs/getting-started/installation), [R3F v9 migration guide](https://r3f.docs.pmnd.rs/tutorials/v9-migration-guide) |
| `import { motion, MotionConfig } from "motion/react"`; `reducedMotion` values `"user"`, `"always"`, `"never"`; `useReducedMotion()` returns a boolean | [Motion: MotionConfig](https://motion.dev/docs/react-motion-config), [Motion: accessibility](https://motion.dev/docs/react-accessibility) |
| R3F `Canvas` props `frameloop` (`always`/`demand`/`never`), `dpr` (number or `[min, max]`), `gl`, `camera`, `fallback` (DOM shown when GL is unsupported), `eventSource` | [R3F Canvas API](https://r3f.docs.pmnd.rs/api/canvas) |
| shadcn Select: `pnpm dlx shadcn@latest add select`; import from `@/components/ui/select`; parts `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectGroup`, `SelectItem`, `SelectLabel`, `SelectSeparator`; docs default to Base UI with a Radix version available; invalid state via `aria-invalid` on the trigger | [shadcn/ui Select](https://ui.shadcn.com/docs/components/select) |
| shadcn dark mode for Next.js: `next-themes`, `ThemeProvider` with `attribute="class"`, `defaultTheme="system"`, `enableSystem`, `disableTransitionOnChange`; `suppressHydrationWarning` on `<html>` | [shadcn/ui dark mode (Next.js)](https://ui.shadcn.com/docs/dark-mode/next) |
| next-themes 0.4.6 props incl. `storageKey`, `attribute` (`class` or `data-*`), `nonce` (CSP), `disableTransitionOnChange`; theme UI must wait for mount to avoid hydration mismatch | [next-themes on Socket (README)](https://socket.dev/npm/package/next-themes) |
| `tw-animate-css` replaces `tailwindcss-animate`; `@import "tw-animate-css";`; `animate-in`, `fade-in`, `zoom-in-*`, `slide-in-from-*` patterns | [npm: tw-animate-css](https://npmjs.com/package/tw-animate-css) |
| `router.replace(href, { scroll })` from `next/navigation`; `scroll: false` disables scroll-to-top; `useSearchParams` needs a Suspense boundary during prerendering | [Next.js useRouter](https://nextjs.org/docs/app/api-reference/functions/use-router) |
| drei `PerformanceMonitor` (`onIncline`, `onDecline`, `onChange`, `onFallback`, `flipflops`, `bounds`) driving `dpr`; `AdaptiveDpr`; `Float` (`speed`, `rotationIntensity`, `floatIntensity`, `floatingRange`); `RoundedBox` (`args`, `radius`, `smoothness`, `bevelSegments`, `creaseAngle`); `ContactShadows` `frames={1}` for static scenes | [drei PerformanceMonitor](https://drei.docs.pmnd.rs/performances/performance-monitor), [AdaptiveDpr](https://drei.docs.pmnd.rs/performances/adaptive-dpr), [Float](https://drei.docs.pmnd.rs/staging/float), [RoundedBox](https://drei.docs.pmnd.rs/shapes/rounded-box), [ContactShadows](https://drei.docs.pmnd.rs/staging/contact-shadows) |
| `import { SVGLoader } from 'three/addons/loaders/SVGLoader.js'`; `SVGLoader.createShapes` deprecated since r185 (logic moved to `ShapePath.toShapes()`) | [three.js SVGLoader](https://threejs.org/docs/pages/SVGLoader.html), [three.js PR #33503](https://github.com/mrdoob/three.js/pull/33503) |
| Bricolage Grotesque is variable and licensed SIL OFL 1.1 | [Fontsource: Bricolage Grotesque](https://fontsource.org/fonts/bricolage-grotesque/install) |
| Bricolage Grotesque and Inter are Google Fonts families | Google Fonts family list (checked by name) |

**Not verified by the author — the implementing session must VERIFY before use:** `next/font/google` export name `Bricolage_Grotesque` and `weight: "variable"`; Bricolage Grotesque's non-weight axes; `@axe-core/playwright` API; `@next/bundle-analyzer` setup for the installed Next.js; Vitest `expectTypeOf` type-test setup; Zod 4 error-parameter naming; React Aria Components / Radix / lucide-react versions and React 19 support; R3F automatic disposal behaviour; R3F `invalidate` export and `instanceId` on pointer events; `three` geometry class names; the Chromium flag for software WebGL in CI; the Next.js metadata API and static-rendering configuration for the installed version (route segment config differs between Next.js majors); drei `Environment` + `Lightformer` API (the docs page could not be fetched); `THREE.NeutralToneMapping`; `gl.compile`; `mergeGeometries` path; the shadcn `globals.css` variable names and Tailwind v4 `@custom-variant dark` line; shadcn Input `ref` forwarding; Base UI Select value props; shadcn Combobox recipe; how the app exposes its CSP nonce.
