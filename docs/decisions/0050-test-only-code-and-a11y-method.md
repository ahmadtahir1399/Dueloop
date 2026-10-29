# 0050: Test-only code policy; a11y and low-bandwidth method (prompt 6, issues S, step 14)

**Test-only code.**
- No test hook exists in the web app. Everything a test needs lives under `apps/web/e2e` or in demo scripts
  (`packages/worker/scripts`), outside every production entry point.
- Time: the e2e demo drives the worker through the EXISTING `--now` mechanism (`clockFrom`), only with a future
  instant inside the tenant's send window (`demoClock`), exactly as `pnpm demo:send` does. No production clock
  override was added. Tests do not depend on the time of day.
- The FakeGateway is prompt 5 code gated by `PAYMENTS_ALLOW_FAKE=true` AND a test-mode account; the e2e server sets
  the flag, production must not. Its "checkout page" is a Playwright route standing in for `pay.fake.test`; the
  signed delivery comes from a demo script. Nothing of this is in the web build.
- Proof: `e2e/security/security.spec.ts` scans the production build output for test markers (`local-e2e-only`,
  `__pwned`, `e2e-claim`, `e2e-demo-steps`, `KeywordBaselineClassifier`, `fixtures.ts`) and the client bundle for
  the service-role key, the DB URL and secret-looking strings.
- No fixed sleeps: waits are on URLs, DOM state, `expect.poll` over database or Mailpit state, with timeouts.
- Slack: the adapter accepts only `https://hooks.slack.com/` URLs (prompt 3 SSRF guard). A local fake Slack receiver
  would need a test-only bypass, so the demo asserts the owner alert through the existing email route (no Slack
  configured => alerts email the owners, into Mailpit). Slack delivery: NOT VERIFIED locally.

**Accessibility.** `@axe-core/playwright` with WCAG 2.0/2.1 A and AA rule tags on key staff and public pages; a test
fails on serious or critical findings. Scripted keyboard-only runs: approvals (skip link, reach Approve, visible
focus), import wizard (file control reachable), pay page (focus order, labels). This is automated checking only; it
is not a conformance claim. Not checked: screen readers, contrast in every theme, zoom/reflow at 400 %, cognitive
load, real users.

**Low bandwidth.** Chromium with the Pixel 7 descriptor and CDP network emulation (400 ms RTT, 50 KB/s down,
20 KB/s up; `Network.emulateNetworkConditions`, deprecated in the protocol but supported), JavaScript disabled.
Bytes are summed from the responses actually transferred; budgets are constants (`BUDGET` in the spec). Public pages
are plain HTML + one small stylesheet + an optional 1 KB script, so no framework JavaScript loads there.
