# Redesign changelog

Built 2–3 November 2026 from REDESIGN.md v1.1 (see [CONFLICTS.md](CONFLICTS.md) C-29: the committed file is v1.0).

## Routes

- `/` is the new public landing page (S32) with the real-time 3D story; signed-in visitors are redirected to `/overview`.
- Overview moved from `/` to `/overview`.
- Sign in is `/sign-in`, sign up is `/sign-up`; `/login` redirects to `/sign-in`.
- Dev-only `/dev/loop`, `/dev/tokens`, `/dev/components` (404 in production builds).

## Foundations

- `apps/web/styles/tokens.css`: every token from §3 (colour, type, spacing, radius, elevation, z-index, motion), light
  and dark (one `.dark` block since v1.2). shadcn variables map onto the tokens.
- Fonts: Inter and Bricolage Grotesque through `next/font/google` (self-hosted at build time).
- Theme control (System / Light / Dark): v1.2 (Phase 8a) rebuilt it on next-themes with the CSP nonce, in a ◐ header
  popover, the account menu and the landing header; the choice is kept in `localStorage` (`dl-theme`). See C-36.
- `node apps/web/scripts/check-contrast.ts` (also `pnpm contrast:check`): every §3.1.3 pair, matching the spec's
  numbers to two decimals; forbidden pairs asserted to fail.

## Components

StatusChip (icon + word for all 8 statuses), Chip, CountBadge, Banner, PageHeader, KpiTile, EmptyState, Field,
MoneyInput, Checkbox, Stepper, CopyButton, CodeValue, BackLink, Wordmark, custom ChoiceSelect and DatePicker
(user request), restyled shadcn Button/Input/Card/Table/Alert/Badge/Skeleton/Toaster.

## Screens

New app shell (inverse sidebar, tablet rail, mobile sheet, header with search, theme and account), and every staff
screen restyled: Overview, Invoices, Invoice detail, Customers, Customer detail, Inbox, Approvals, Tasks, Proofs,
Unknown sends, Record payment, Import (with stepper), Settings (sub-nav, save bar, danger zone), Onboarding (two
steps), Sign in / Sign up (beat-0 still), 404 / error / loading. Customer pay and opt-out pages restyled through
`public/pp.css` (still no React, no web fonts).

## Forms

React Hook Form + Zod (`forms/schemas.ts`, `lib/use-action-form.ts`) on the existing server actions, with the same
FormData field names (request bodies unchanged). See C-34 for the forms that were not moved.

## Fields (Phase 8b, spec v1.2 §7.3)

- One field system on shadcn/ui (Radix): `Input` (with leading icon and trailing slot, `SearchInput` with clear ×),
  `Textarea` (auto-grow, counter), `Select`, `Label`, all on one shared shell (`components/ui/field-shell.ts`).
- shadcn variables bridged to the tokens exactly as §7.3's table (locked by `test/shadcn-bridge.test.ts`).
- `ChoiceSelect` rebuilt on the Select parts (same hidden-input posting); searchable `Combobox` for time zones and
  currencies (C-40, C-41). Raw checkboxes and textareas in app code replaced; `NativeSelect` removed.
- D22: `test/fields.test.ts` (static scan, C-43) and `e2e/staff/fields.spec.ts` (keyboard + axe).

## Auto-applied filters (Phase 8c, spec v1.2 §4.10)

- Invoices, customers, tasks, proofs and the overview period apply filters on change; search after 300 ms (Enter at
  once, Escape clears). No Apply, Filter or Show buttons. The URL is the source of truth (`domain/list-params.ts`).
- `features/lists/`: `ListScope` (router.replace with scroll:false in a transition, optimistic control values),
  `ListResults` (old rows stay, dimmed, MI15 bar, aria-busy), `FilterSearch`, `FilterSelect`, `FilterCheckbox`,
  `FilterTabs`, `FilterChips` (MI16) and a polite count announcement.
- D25: `e2e/staff/lists.spec.ts`. Decisions and unsupported filters: CONFLICTS C-50 to C-57.

## The Loop (3D)

three 0.187 + @react-three/fiber 9.8.2, procedural geometry only, one canvas: hero ring of 12 instanced cards
(hover lift, drag to spin, pointer parallax) and the scroll-driven story through beats 1–7. Everything is a pure
function of (beat, time) in `features/landing/three/keyframes.ts`. Tiers 2/1/0, FPS watchdog, Pause (remembered),
WebGL-context-loss fallback, pre-rendered stills. QA in [3D-QA.md](3D-QA.md).

## Tests

Unit: 830 passed, 1 skipped (788 before; new: tokens/contrast, forms, StatusChip, keyframes/tiers, landing copy).
Landing e2e (D15–D18): 7 passed against the dev server.
