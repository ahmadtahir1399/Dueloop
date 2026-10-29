# Limitations

What is not built, not verified, or waiting for a decision (2026-10-29). Nothing here is hidden elsewhere; the
security findings that are still open are repeated from docs/security-review.md.

## Not verified

- Real-host deployment (a server, a TLS proxy, real DNS); hosted Supabase behaviour (extensions, Vault, Auth settings,
  platform backups); any platform other than the one Windows 10 machine this was built on (macOS, Linux desktop,
  WSL2); a second machine running the clean-clone job (the workflow exists and has not run).
- Live providers: SMTP to real inboxes, WhatsApp Cloud API, Stripe live and test accounts, Anthropic and OpenAI models, Slack.
  Each has a contract test with recorded or fake responses and an env-gated smoke command; none ran with credentials.
- Accessibility beyond automated axe checks and scripted keyboard runs (no screen-reader or user testing).
- Performance beyond one machine and one synthetic 50,000-invoice tenant (docs/measurements/perf-pages.txt).
- The demo's cold start from a clean clone (image downloads): measured only by the clean-clone job, which has not run.

## Known gaps

- **Backups:** a logical backup does not contain Vault secrets (provider credentials) or Storage files (proofs);
  restoring them is manual (docs/runbook.md). Platform backups NOT VERIFIED.
- **Process supervision:** worker, processor and webhooks exit when the database connection drops and need a
  supervisor to restart (compose does; a bare `node` run does not).
- **Sign-in:** no second factor; no rate limit of our own on sign-in beyond Supabase Auth's.
- **Email replies are not read in production.** The IMAP poller (`pollMailbox`, ADR 0031) is built and tested against
  a local server, but no production command runs it and there is no screen for mailbox settings. Customer email
  replies (promises, disputes, "already paid") go only to the business's own inbox, where a person must act on
  them. Email opt-out works through the footer link and the one-click unsubscribe header; the email footer no longer
  says "reply STOP". WhatsApp replies are processed.
- **Onboarding:** creating a business adds the standard English email templates (Settings > Templates can add back
  any that are missing) but no sending account; an owner sets the SMTP password and sender address in Settings >
  Integrations before anything can be sent. There are no default WhatsApp templates (they need Meta approval).
- **WhatsApp reminders carry no pay link:** approved templates have no link variable yet (options in ADR 0046).
- **Public links are not reused:** each reminder issues fresh pay and opt-out links (ADR 0046 explains why).
- **Policy step labels** are not supported in the editor (steps have ids and channels only).
- **SMS** is not built (the channel exists in the schema; there is no adapter).
- **Suppression list:** re-subscribing a customer who opted out or was erased needs an operator to remove the
  suppression row on the trusted connection; there is no UI or CLI for it (ADR 0051).
- **Erasure** is refused while the customer has open invoices (DECISION below).
- **Secret scanning** is pattern-based; secrets with no known shape are not found. No container vulnerability scanner
  ran.
- **Licences:** the web image contains LGPL-3.0-or-later libvips binaries (via sharp); review before distributing
  images.
- **Demo:** replies are classified by a keyword script, payments use a fake provider with no checkout page, and there
  is no local Slack stand-in (docs/demo-script.md).
- **Build guide:** `docs/build-guide.md` is not in this repository; the README's feature table therefore comes from
  what was built, not from the guide's catalogue.

## Open decisions

Raised in earlier reports and not yet answered. Each runs today with the default described.

From prompt 3 (sending): whether "one reminder per invoice per local day" is per invoice (implemented); budget 0
meaning "blocks paid channels" (implemented, and the Settings page now says so) or "unlimited"; approval expiry of 7 days; the kill-switch read point
(just before the outbox claim); an in-process rate limiter (a shared one is needed before running several workers);
WhatsApp generic errors 1 / 131000 treated as ambiguous (parked, not retried); no automatic channel fallback; alert
routing (Slack if configured, else email to owners only).

From prompt 4 (replies): `promise_acceptance` default `auto`; `low_confidence` approval meaning (only while a
`human_review` task is open); opt-out revokes all channels; promises on `open` invoices go to a human; `disputed`
exits only to paid; no fallback channel on a bounce; promises with a different amount go to a human; renewal while
promised goes to a human (cap 2); 3-day blocks for "already paid" and information requests; classifier cap 500 per
tenant per day.

From prompt 5 (payments): refunds and chargebacks as urgent tasks (no automatic reopening); receipts skipped for
opted-out customers; payment while disputed marks paid and alerts; a partial payment leaves an active promise for
the next evaluation; the KPI definitions in ADR 0041; credits recorded but never applied or refunded; payment link
lifetime; Stripe as the first gateway on the client's own account; a proof blocks reminders for 3 days; receipts
outside the weekly reminder cap; ISK, UGX and three-decimal currencies get bank-transfer text only.

From prompt 6 (dashboard): the WhatsApp link options in ADR 0046; whether public links should be reused; step labels;
whether onboarding should create default templates (decided after prompt 7: it adds the English email ones).

From prompt 7 (this release): the licence (none chosen; no rights granted); the contribution policy; the project
name; the security contact; support terms; the repository URL; the fate of the build guide (publish, sanitise or keep
private); erasure while invoices are open; the retention periods in ADR 0051 (engineering defaults, not legal
advice); proof-file retention (400 days after close); whether the demo should include the CSV wizard step (today
`pnpm e2e:demo` covers it); whether to distribute container images given the LGPL component.
