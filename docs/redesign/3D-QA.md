# The Loop: 3D QA record (redesign §6.2.7)

Recorded 3 November 2026 on the local dev server (`next dev`, Next 16.4.3) on Windows 10. Every result below
comes from a command run in this session. Items not run are marked **NOT RUN**.

## Automated (Playwright, Chromium 1.64 with software WebGL: `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`)

Spec: [apps/web/e2e/landing/landing.spec.ts](../../apps/web/e2e/landing/landing.spec.ts), run with
`E2E_LANDING_BASE_URL` against the dev server (the repo's `playwright.config.ts` project `landing` runs the same spec
against a production build, but that build could not be produced on this machine; see CONFLICTS C-06).

| Check | Result |
|---|---|
| D15 the stage renders at beats 0, 3, 7 (pixel std dev > 8) and the three differ | pass |
| D16 `data-beat` 0→7 scrolling down, 7→0 up; matching step has `aria-current="step"` | pass |
| D17 Pause: two stage screenshots 1 s apart identical; `data-3d-state="paused"`; after reload `static` (remembered) | pass |
| D18 reduced motion → Tier 0, no canvas, 8 story blocks | pass |
| D18 390 px → Tier ≤ 1, no horizontal scroll | pass |
| D18 no WebGL → Tier 0 stills | pass |
| One h1 (the copy deck H1), CTAs are links, no forms | pass |
| Unit: keyframes (§6.2.4 table), scroll→beat mapping, reverse play, tiers, watchdog (`test/landing-keyframes.test.ts`) | pass |

Result line from the last run: `7 passed`.

## Screenshots

Screenshots of beats 0, 3 and 7 (desktop 1440×900, Tier 2), mobile 390×844 and Sign in were taken from the live
page during the build and reviewed in the session. They are not committed (the repo audit allows no binary files
except the runtime stills). To reproduce: run the dev server and the landing spec above, or open `/` and scroll.

## Stills (§6.2.6)

`node scripts/render-loop-stills.ts http://localhost:3000` (run from `apps/web`) renders `/dev/loop` per beat and
writes `public/landing/loop-beat-{0..7}.webp` (1200), `loop-beat-{0..7}-600.webp` and `og-beat-7.png`
(1200×630). Transparent background. Largest still: 20 KB (budget 120 KB).

## Manual QA (§6.2.7)

| Item | Status |
|---|---|
| Desktop Chrome and Firefox, Tier 2 at 60 FPS, all beats both directions | **NOT RUN** on real GPUs: only headless Chromium with software WebGL |
| Safari (macOS) | **NOT RUN** (no Mac available) |
| Mid-range Android, Tier 1, no jank | **NOT RUN** (no device available) |
| Pause remembered; reduced motion gives Tier 0 with the full story | pass (automated, above) |
| Main-thread time per frame, draw calls, triangles (§6.2.5) | **NOT MEASURED** |
| Lazy 3D chunk size (D8) | **NOT MEASURED**: needs a production build (C-06) |
