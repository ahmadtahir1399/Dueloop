# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Nothing has been released: no version is tagged and
nothing is published (docs/release.md).

## [Unreleased]

### Added

- OpenAI as a second, optional model provider: `CLASSIFIER=openai` and `PROOF_EXTRACTION=openai` with
  `OPENAI_API_KEY` (ADR 0053). Anthropic stays supported; with neither set, every reply still goes to a human.
- Settings > Integrations: "Email sender" and "WhatsApp number" forms; Stripe can be connected first and its
  webhook signing secret added afterwards ("Webhook signing secret"); the account stays off until then.
- Settings > Templates: the standard email templates (also added at onboarding) and "New WhatsApp template"
  (starts pending; an owner marks it approved).
- Invoice page: "Resume reminders" for a parked invoice (owner/accountant; never for unknown-state messages).
- Customer page: record and withdraw consent (owner/accountant).
- `SMTP_PASSWORD` (operator SMTP login, never sent to a tenant-chosen host); the ops watchdog logs in with it.
- `CLASSIFIER_REASONING_EFFORT`, `PROOF_EXTRACTION_REASONING_EFFORT`.
- `docs/guides/getting-your-keys.html` and `pnpm guide:pdf`: an easy-English guide to getting each environment key
  from a hosted service (free plans where one exists), rendered to a git-ignored PDF.

### Fixed

- A new business could not send anything without database access: no screen for the sender address, the WhatsApp
  phone number id, templates or consent, and a parked invoice could only be resumed from the CLI.
- Migration 0024: a WhatsApp template inserted by a member always starts "pending" (only an owner approves it).
- The budget label said "0 = unlimited"; 0 blocks WhatsApp and SMS.
- A wrong Slack URL or a Stripe key of the other mode was accepted and failed silently later.
- "Rotate the webhook URL" failed with more than one payment account.
- AI SDK logging is forced off (`OPENAI_LOG` / `ANTHROPIC_LOG` at debug would log customer text).

## [0.7.0] - 2026-10-29

Not tagged or published; this is the state of the default branch at the end of build phase 7.

### Added

- Operations: schema-version guard in every service, `/health` and `/ready`, heartbeats, `pnpm ops:status`,
  `pnpm ops:watchdog`, `pnpm doctor`, an error-reporter interface with a scrubber.
- Data lifecycle: `pnpm retention:run`, `pnpm customer export|erase`, a salted per-tenant suppression list.
- `pnpm backup:drill`, `packages/ops/sql/post-restore.sql` and the runbook's backup, restore and upgrade procedures.
- Container images (`Dockerfile`, `compose.selfhost.yml`), `pnpm images:build`, `pnpm images:smoke`.
- The one-command demo: `pnpm demo`, `demo:control`, `demo:selftest`, `demo:stop`, `demo:reset`, `demo:logs`,
  `demo:record`; the clean-clone CI workflow.
- Checks: `pnpm verify:all`, `pnpm repo:audit`, `pnpm docs:check`, `pnpm egress:check`, `pnpm db:catalog-audit`,
  `pnpm licences:report`, `pnpm env:check`.
- Pilot tooling: KPI snapshots (migration 0023), `pnpm pilot:snapshot`, `pnpm pilot:report`.
- Documentation: architecture, self-hosting, environment reference, runbook, data handling, security review, threat
  model, limitations, demo script, pilot playbook, client onboarding, release process; SECURITY.md, CONTRIBUTING.md.

### Fixed

- A queue job redelivered after a crash could send the next reminder step at once, or send while the invoice was
  parked for a human (ADR 0052).
- `@dueloop/db` did not declare its dependency on `@dueloop/core`; a production install failed to start.
- The e2e demo depended on the time of day (tenant time zone versus the injected clock).
- Committed fixtures used registrable domains and a non-fictional phone number.

### Security

- Security review and threat model (docs/security-review.md, docs/threat-model.md); open findings are listed in
  docs/limitations.md.

## [0.6.0] - 2026-10-28

Build phase 6 (not tagged): staff dashboard, public pay and opt-out pages, REST API, editors, and their security,
accessibility, low-bandwidth, demo and performance suites. Earlier phases are described in docs/reports.
