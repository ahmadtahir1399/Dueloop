# Dueloop — Redesign Specification

Source of truth for the UI redesign · Version 1.0 · 2 November 2026

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
| A6 | There is **no** marketing landing page; the first public screen is Sign in. | If one exists, move the 3D moment (§6.2) to its hero and keep Sign in static-light. |
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

---

## 1. Definition of done

Everything else in this document works backwards from this section.

### 1.1 What the finished app looks and feels like

- Opening the app feels like entering a **calm, well-kept ledger room**: a deep evergreen sidebar, paper-white working space, generous margins, and numbers aligned like a bank statement.
- Every screen answers **"what needs me now?"** within one glance: the page title says what it is, the primary action is the only filled green button, and counts of waiting work are visible in the navigation.
- Status is always readable **without colour**: every status chip has an icon and a word.
- The product **moves only to explain**: an approved reminder leaves the queue, a recorded payment turns an invoice to Paid, a step in a wizard slides in the direction of progress. Nothing loops in the staff app; the single ambient animation is the 3D loop on the Sign in / Sign up hero.
- Customers on the Pay page see a quiet, trustworthy page that works on a cheap phone on a slow connection, with no 3D, no web fonts blocking text, and no tracking.
- Light and dark mode are both first-class.

### 1.2 Acceptance checks (all must pass)

| # | Check | How to verify | Target |
|---|---|---|---|
| D1 | Token contrast | `node apps/web/scripts/check-contrast.ts` (Phase 1) computes every pair in §3.1.3 | 0 failures; text ≥ 4.5:1, large text/UI edges ≥ 3:1 |
| D2 | Automated accessibility | `@axe-core/playwright` scan on every route in §4.0, light and dark (**VERIFY** package API) | 0 violations at `serious` or `critical` |
| D3 | Keyboard | Playwright script completes: sign in → approve a send → record a payment → sign out, **no mouse** | Passes; focus always visible |
| D4 | Reduced motion | Same E2E with `page.emulateMedia({ reducedMotion: 'reduce' })` | No transform animations run; 3D canvas never mounts; all flows still complete |
| D5 | Responsive | Playwright screenshots of every route at 390×844, 834×1194, 1440×900, light + dark | No horizontal page scroll; no clipped text; tables scroll inside their own box |
| D6 | Lighthouse (production build, mobile preset) | Sign in, Overview, Invoices, Pay page | Performance ≥ 90, Accessibility = 100, Best Practices ≥ 95 |
| D7 | Core Web Vitals (lab) | Same pages | LCP ≤ 2.5 s, CLS ≤ 0.05, TBT ≤ 200 ms |
| D8 | 3D budget | `@next/bundle-analyzer` (**VERIFY**) | 3D chunk is lazy, **≤ 250 KB gzip**, absent from every route except Sign in / Sign up; 0 KB on Pay page |
| D9 | No behaviour change | Existing Vitest, integration, pgTAP and adversarial suites | Same pass counts as Phase 0 baseline (819 / 160 / all) |
| D10 | No contract change | `git diff` on API route handlers, server actions' input schemas, DB migrations | No changes except those listed in §10.2 |
| D11 | Forms | Every form uses React Hook Form + Zod resolver; Vitest tests per schema (valid, each invalid case, copy matches §5.4) | 100% of forms in §5.3 |
| D12 | Visual consistency | `grep` for raw hex colours / px font sizes in components | 0 occurrences outside `tokens.css` and the 3D scene file |
| D13 | Status without colour | Unit test renders each `StatusChip` and asserts icon + text present | All 8 statuses |
| D14 | Security posture kept | CSP header unchanged in strictness; no `dangerouslySetInnerHTML` added; no new third-party origins except the font host if not self-hosted | Passes review |

---

## 2. Vibe and direction

**Green-led, premium, calm but alive.**

### 2.1 Mood

Dueloop's job is to be polite on someone else's behalf, and to be trusted with money records. The interface should therefore feel:

- **Calm** — low visual noise, one accent at a time, no red walls even when much is overdue. Overdue is a fact, not an alarm.
- **Premium** — careful typography, tabular numerals, precise alignment, restrained shadows, real whitespace. Quality is shown through restraint and finish, not decoration.
- **Alive** — small, honest motion that confirms what just happened; a single ambient 3D moment at the front door; a lime accent that appears only where something is "live" (focus, counters of waiting work, the active progress step).

### 2.2 References (described, not named)

1. **A private-bank statement printed on heavy paper**: deep green header band, off-white body, every figure in a tabular column, small caps labels. → Our ledger tables and KPI tiles.
2. **A botanical glasshouse at dusk**: dark green frames, soft light, living things growing slowly. → The dark sidebar and the inverse "status" panel; the slow 3D loop.
3. **A well-designed train timetable**: dense but legible, status shown by symbol + word, nothing decorative. → Status chips, timelines, the Approvals queue.
4. **A quality notebook app's settings pages**: plain forms with generous labels, help text under fields, save bars that appear only when something changed. → Settings.

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
  color-scheme: light dark;
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

/* Dark: follows the OS unless the user picked a theme (data-theme on <html>). */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { /* same token names, dark values from §3.1.1 */ }
}
:root[data-theme="dark"] { /* identical dark values — keep both blocks in sync via a build-time test */ }
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

#### 3.1.4 Theme switching

- Default: follow `prefers-color-scheme`.
- Override: a three-way control (System / Light / Dark) in the user menu, persisted in a cookie `dl-theme` so the server can render `data-theme` on `<html>` and avoid a flash. Do **not** store in a database (out of scope, §10).
- The Pay page and Opt-out page follow the OS only (no control; customers have no account).

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

Route paths are **proposals**; map them to real routes in Phase 0.

| ID | Screen | Proposed route | Roles | Group |
|---|---|---|---|---|
| S01 | Sign in | `/sign-in` | public | Auth |
| S02 | Sign up | `/sign-up` | public | Auth |
| S03 | Confirm email | `/confirm-email` | public | Auth |
| S04 | Onboarding | `/onboarding` | new owner | Auth |
| S05 | Overview | `/` or `/overview` | all | Daily work |
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
│                                      │       [ 3D LOOP: ring of invoice cards ]  │
│  Welcome back                        │        slow rotation, cards turn green    │
│  (display-xl)                        │        as they pass the "paid" point      │
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
| 3D hero | Brand moment; communicates "loop of invoices getting paid" |
| Tagline | States the three product promises in plain words |

Tablet: hero becomes a 240 px tall band above the form. Mobile: hero replaced by the static fallback image at 160 px tall (no WebGL on mobile — §6.2).

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
| Status/Due filters + status tabs | Tabs for the common cuts, dropdown for the rest; filters are reflected in the URL |
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
| F05 | Invoice filters | S06 | q, status, due | URL search params (no request body) |
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
- **React Three Fiber** for the one 3D moment (§6.2).

Root setup:

```tsx
// apps/web/src/app/providers.tsx
"use client";
import { MotionConfig } from "motion/react";
export function Providers({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
```

### 6.2 The 3D moment — "The Loop" (Sign in / Sign up hero)

**Concept.** Twelve thin, rounded invoice cards stand on a slowly turning ring, tilted 18° toward the viewer. As each card passes the front ("the paid point") its face eases from stone to evergreen and a small lime check appears; as it continues round the back it resets. One revolution per minute. It says, without words: *invoices go round, and come back paid.*

**Library: React Three Fiber (`@react-three/fiber`) + `three`.**
- Declarative scene inside React; the canvas mounts/unmounts with the component, so lifecycle and cleanup follow React.
- Major versions pair with React: R3F **9 ↔ React 19**, R3F 8 ↔ React 18 (verified in R3F installation docs). Choose by Phase 0's React version.
- Next.js: add `transpilePackages: ['three']` to `next.config` (R3F docs, Next.js ≥ 13.1).
- **No `@react-three/drei`**: everything needed (rounded card shape via `THREE.Shape` + `ShapeGeometry`, standard materials, one directional + ambient light) is in `three` core. Keeps the chunk small.
- Rejected: vanilla three (more imperative lifecycle code in a React app), hosted 3D runtimes (extra third-party origin breaks the CSP posture), CSS 3D (no lighting, poor depth sorting with 12 cards — but used as nothing; the static image is the fallback).

**Scene specification**

| Item | Value |
|---|---|
| Cards | 12 × `ShapeGeometry` rounded rect 1.0 × 1.32 units, corner radius 0.08, slight thickness via two planes (front/back) |
| Ring | radius 3.2, group tilt X = −18°, rotation Y = 2π per `duration-ambient` (60 s), `ease-linear` |
| Card face colour | lerp `#EEF0EC` → `#4DA477` as angle-to-camera goes from 60° to 0°; back to stone after 60° on the other side |
| Check mark | small lime `#C8F169` plane with a check shape, scale 0 → 1 with `ease-settle` over 320 ms when the card crosses 0° |
| Lines on cards | 3 thin bars (stone-300) suggesting text; no real text, no numbers |
| Background | transparent canvas over `--color-surface-inverse` |
| Lights | ambient 0.6; directional 0.9 from (3, 5, 4) |
| Camera | perspective, fov 35, position (0, 1.2, 9) |
| Pointer | parallax ±4° on the ring tilt, eased 10% per frame toward target; disabled on touch |
| Canvas | `dpr={[1, 1.75]}`, `gl={{ antialias: true, powerPreference: "low-power" }}`, `frameloop` = `"always"` while visible, `"never"` when off-screen or tab hidden |

**Performance budget**

| Budget | Limit |
|---|---|
| Lazy JS chunk (three + R3F + scene) | **≤ 250 KB gzip** (measure; if over, check tree-shaking of `three` imports) |
| Draw calls | ≤ 30 |
| Frame time | ≤ 6 ms main thread on a mid-range laptop (Chrome performance panel) |
| FPS watchdog | If the average FPS over 3 s is < 40, stop rotating and cross-fade (220 ms) to the static image |
| LCP | The static image is the LCP element; 3D must never delay it |
| Memory | Dispose geometries/materials on unmount (verify R3F auto-disposal in docs; add explicit dispose for manually created `Shape` geometries) |

**Loading and gating**

```tsx
// apps/web/src/features/auth/LoopHeroGate.tsx (pattern)
"use client";
import dynamic from "next/dynamic";
const LoopHero = dynamic(() => import("./LoopHero"), { ssr: false, loading: () => null });

// Render <LoopHeroStatic/> always (next/image, priority). Mount <LoopHero/> on top ONLY when all hold:
// 1. matchMedia("(min-width: 768px)") matches
// 2. matchMedia("(prefers-reduced-motion: no-preference)") matches
// 3. document.createElement("canvas").getContext("webgl2") is not null
// 4. (navigator as any).connection?.saveData !== true      // non-standard; absent = allowed
// 5. after requestIdleCallback (fallback: setTimeout 300 ms), so LCP is the static image
// Fade the canvas in over duration-slow once the first frame renders.
```

**Static fallback**: `public/hero/loop-static.avif` (+ `.webp`) — a still render of the same scene at the "card crossing the paid point" moment, captured once from the dev build (Playwright screenshot of the canvas) at 1200×1200 and 600×600. Used on mobile, with reduced motion, without WebGL, on save-data, and while the 3D loads. Alt text: `""` (decorative); the tagline carries the meaning.

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
| M14 | Sign in / Sign up mounted | The Loop rotates (§6.2) | `ambient` 60 s/rev | `ease-linear` | Brand moment; explains the product metaphor | Static image; canvas never mounts |
| M15 | Pointer moves over hero | Ring tilt eases toward pointer ±4° | per-frame lerp | — | Makes the hero feel responsive | Disabled |
| M16 | Tablet rail expand / collapse | Rail width 72 → 264 px (overlay) | `base` 220 ms | `ease-standard` | Keeps spatial link between icon and label | Instant |
| M17 | Older timeline events loaded (S07) | New events fade in below with 4 px rise (scroll reveal via IntersectionObserver "Load older") | `base` 220 ms | `ease-enter` | Orients the user to where new history appeared | Instant |
| M18 | Hover on rows, cards, nav items | Background colour change | `fast` 140 ms | `ease-standard` | Shows what is interactive | Same (colour is allowed) |

Rules: no animation on money values changing (they update instantly); no looping animation in the staff app except M13; no scroll-linked effects on the Pay page.

### 6.4 Reduced motion implementation

- CSS: every transition uses tokens; the `prefers-reduced-motion: reduce` block overrides transform/layout durations to `1ms`.
- JS: `<MotionConfig reducedMotion="user">` at the root; components that need a different path (M5 badge, M6 stroke) read `useReducedMotion()`.
- 3D: gate condition 2 in §6.2 — the canvas is never created.
- Test: D4.

---

## 7. Components

Prefer the component library the repo already uses (Phase 0). If none: native elements first (`<button>`, `<a>`, `<select>`, `<input type="date">`, `<dialog>` with `showModal()` for Dialog/Sheet), and a headless accessible library for Combobox, Menu, Tabs, Tooltip — candidates **React Aria Components** or **Radix UI primitives**; **VERIFY** current versions and React 19 support before choosing, and record the choice in `INVENTORY.md`.

Icons: one outline icon set at 1.75 px stroke, 16/20/24 px. If the repo has one, keep it; otherwise **VERIFY** and use `lucide-react`. Decorative icons `aria-hidden="true"`.

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
| **TextField** | text, email, password (show/hide), search | 44 px, `border-strong`, `radius-sm`, label above | border `text` | ring + border primary | — | read-only text instead | trailing spinner (async check only) | placeholder never replaces label | error border + message (M2) |
| **Textarea** | auto-grow to 10 lines, char counter when max set | as TextField | as TextField | ring | — | as above | — | — | as TextField |
| **MoneyField** | currency code as non-editable suffix; `inputMode="decimal"`; right-aligned tabular | as TextField | — | ring | — | — | — | — | format errors (§5.6) |
| **DateField** | native `type="date"` styled; min/max from rules | as TextField | — | ring | — | — | — | — | as TextField |
| **Select** | native `<select>` for ≤ 15 options | as TextField + chevron | border `text` | ring | — | — | — | "No options" | as TextField |
| **Combobox** | searchable (time zones, currencies, templates) | as TextField | — | ring; active option `primary-soft` | — | — | "Searching…" row | "No matches for '{q}'" | as TextField |
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
| **FilterBar** | search + selects + "Clear filters" (shown only when filtered) | — | — | — | — | — | — | — | — |
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
| **UserMenu / ThemeToggle** | menu items; theme radio group | — | as Menu | as Menu | — | — | — | — | — |
| **CopyButton** | icon + tooltip | IconButton | — | ring | M12 | — | — | — | "Couldn't copy" tooltip |
| **CodeValue** | IDs, keys, references; tabular, `surface-sunken`, copy | — | — | — | — | — | — | — | — |
| **ProgressBar** | determinate (upload, import) | track stone-200, fill primary | — | — | — | — | — | — | fill error |
| **SearchCommand** | ⌘K / Ctrl K dialog; results grouped Invoices / Customers | Dialog | option bg `primary-soft` | active-descendant | — | — | "Searching…" | "No results for '{q}'" | Banner |
| **BackLink** | "‹ Invoices" | link | underline | ring | — | — | — | — | — |

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

### 8.2 Performance

| Target | Value |
|---|---|
| Lighthouse (mobile preset, production build) | Performance ≥ 90 · Accessibility 100 · Best Practices ≥ 95 (S01, S05, S06, S25) |
| LCP / CLS / TBT (lab) | ≤ 2.5 s / ≤ 0.05 / ≤ 200 ms |
| First-load JS per staff route | No route grows by more than 15% over the Phase 0 baseline (fonts excluded) |
| Pay page (S25) first-load JS | ≤ Phase 0 baseline; no Motion, no three, no icons beyond the few used (tree-shaken) |
| 3D chunk | ≤ 250 KB gzip, lazy, only on S01/S02 (D8) |
| Fonts | 2 variable files (Inter, Bricolage Grotesque), latin subset, self-hosted by `next/font`, `display: swap` |
| Images | `next/image`, AVIF/WebP, explicit width/height (no CLS) |
| Server | The demo VM has 1 GB RAM: no new server-side work per request; 3D is client-only (`ssr: false`) |

Measure with `@next/bundle-analyzer` (**VERIFY** setup for the installed Next.js) and Lighthouse CI or the Lighthouse CLI against `next start`.

---

## 9. Implementation plan

Rules for every phase: work on a branch `redesign/<phase>`; commit at the end of each phase; **do not push or open a PR unless the user asks**; run the full existing test suite at the end of each phase (D9 must stay green); record deviations in `docs/redesign/CONFLICTS.md`.

**Before Phase 0**: run `git status`. The overview says the live build was not committed. If the working tree has uncommitted changes, **stop and ask the user to commit them first**, so the redesign diff stays separate.

| Phase | Goal | Files to create / change (proposed paths) | Dependencies | Verify it is done |
|---|---|---|---|---|
| **0 · Discovery** | Know the real app | `docs/redesign/INVENTORY.md`, `docs/redesign/CONFLICTS.md` | none | §0.4 items 1–7 complete; baseline recorded |
| **1 · Tokens** | Foundations everyone uses | `styles/tokens.css` (all of §3), global CSS import, `app/fonts.ts`, root `layout.tsx` (font variables, `data-theme` from cookie, skip link), theme-cookie read/write helper, `scripts/check-contrast.ts` (port of the pair list in §3.1.3, including forbidden pairs), Tailwind `@theme`/config mapping **only if Tailwind exists**, dev-only `/dev/tokens` page (404 in production) | none new (`tsx` as dev dep only if not present) | D1 passes; `/dev/tokens` shows every token in light and dark; no visual regressions besides colours/fonts |
| **2 · Components** | Primitives with all states | `components/ui/*` per §7, `components/ui/StatusChip.tsx` (§3.1.5), dev-only `/dev/components` gallery showing every state | headless library and icon set **only if** none exist (VERIFY versions) | D13; axe on the gallery = 0 serious/critical; keyboard pass over the gallery |
| **3 · Layout & screens** | Every screen in §4 | App shell (`app/(app)/layout.tsx`), each screen's page components; public pages restyled in place | none | D5 screenshots for every route; D2; role-gated items not rendered for collector (test with each role) |
| **4 · Domain & forms** | Schemas + RHF everywhere | `domain/*.ts` (§5.2), `forms/*.schema.ts`, `forms/*Form.tsx` for F01–F22, schema unit tests, type-parity tests | `react-hook-form`, `@hookform/resolvers` (≥ 5 if Zod 4), `zod` — **only if missing**; match existing majors | D11; D10 (payloads unchanged — compare request bodies in integration tests before/after); D3 |
| **5 · Motion** | M1–M13, M16–M18 | `app/providers.tsx` (MotionConfig), `app/(app)/template.tsx` (M9), motion utilities in `components/motion/*` | `motion` | D4; manual review: every row of §6.3 observed once with and once without reduced motion |
| **6 · 3D** | The Loop (M14, M15) | `features/auth/LoopHero.tsx`, `LoopHeroGate.tsx`, `LoopHeroStatic.tsx`, `public/hero/loop-static.{avif,webp}`, `next.config` (`transpilePackages: ['three']`, analyzer) | `three`, `@react-three/fiber` (9 for React 19, 8 for React 18), dev: `@types/three`, `@next/bundle-analyzer` | D8; Lighthouse on S01 ≥ 90; gate conditions tested with emulation (reduced motion, 390 px, WebGL off via `--disable-webgl` launch arg) |
| **7 · Polish** | Ship quality | Copy pass (§5.6, §4.8), dark-mode QA, empty/error states, `forced-colors` check, docs: `docs/redesign/CHANGELOG.md` | none | All of D1–D14; `CONFLICTS.md` has no open items or each is listed for the user |

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
- Adding features: SMS, email-reply reading, re-subscribe screen, translations/RTL, white-labelling, billing.

### 10.2 Allowed exceptions (only these)

1. Reading/writing the `dl-theme` cookie in the root layout (UI preference only).
2. Dev-only routes `/dev/tokens` and `/dev/components` (must return 404 in production builds).
3. Static assets under `public/hero/`.
4. `next.config` additions: `transpilePackages: ['three']`, bundle analyzer behind an env flag.
5. New client dependencies listed in §9 (and only if missing).
6. Development-only response parsing with the domain schemas.

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
| Q10 | Is there a marketing/landing page? (A6) | No; 3D stays on Sign in / Sign up |
| Q11 | Number/date formatting locale per business? | Use the business's time zone for dates and the browser locale for formatting; amount **input** accepts `.` as decimal separator only |
| Q12 | Is there a logo, or should the wordmark be typographic? Note the overview says the name "Dueloop" is not trademark-checked. | Typographic wordmark in one `Wordmark` component so the name can be swapped in one place |
| Q13 | Is the monthly WhatsApp/SMS budget an amount of money or a message count? | Show the unit the API returns; if unknown, label "Monthly budget" with help text "0 blocks sending on this channel" |
| Q14 | Should WhatsApp-related UI be hidden when the channel is switched off (as in the current deployment)? | Show WhatsApp as "Off" in Integrations; hide WhatsApp filters elsewhere |
| Q15 | Does an approval become revocable after approving? | Copy states that approving sends at the next allowed time |
| Q16 | Should the Pay page show the business's own branding (logo/colour)? | No (white-labelling is out of scope); business name as text only |
| Q17 | Default theme for new users? | System |

---

## Appendix A — Verified references

Checked by the spec author on 2 November 2026. Re-check against installed versions (§0.4).

| Claim used in this spec | Source |
|---|---|
| `zodResolver` imported from `@hookform/resolvers/zod`; latest listed version 5.2.1; `useForm<z.input<…>, any, z.output<…>>` pattern; README shows `zod` or `zod/v4` import | [npm: @hookform/resolvers](https://npmjs.com/@hookform/resolvers) |
| R3F 9.x pairs with React 19, 8.x with React 18; `pnpm add three @react-three/fiber`; Next.js ≥ 13.1 uses `transpilePackages: ['three']` | [R3F installation](https://r3f.docs.pmnd.rs/getting-started/installation), [R3F v9 migration guide](https://r3f.docs.pmnd.rs/tutorials/v9-migration-guide) |
| `import { motion, MotionConfig } from "motion/react"`; `reducedMotion` values `"user"`, `"always"`, `"never"`; `useReducedMotion()` returns a boolean | [Motion: MotionConfig](https://motion.dev/docs/react-motion-config), [Motion: accessibility](https://motion.dev/docs/react-accessibility) |
| Bricolage Grotesque is variable and licensed SIL OFL 1.1 | [Fontsource: Bricolage Grotesque](https://fontsource.org/fonts/bricolage-grotesque/install) |
| Bricolage Grotesque and Inter are Google Fonts families | Google Fonts family list (checked by name) |

**Not verified by the author — the implementing session must VERIFY before use:** `next/font/google` export name `Bricolage_Grotesque` and `weight: "variable"`; Bricolage Grotesque's non-weight axes; `@axe-core/playwright` API; `@next/bundle-analyzer` setup for the installed Next.js; Vitest `expectTypeOf` type-test setup; Zod 4 error-parameter naming; React Aria Components / Radix / lucide-react versions and React 19 support; R3F automatic disposal behaviour.
