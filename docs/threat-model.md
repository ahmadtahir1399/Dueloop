# Threat model

Per component: what is worth protecting, how an attacker gets in, what stops them (with the test or rule), and what
is left. Written from the code and ADRs on 2026-10-29; production behaviour is NOT VERIFIED (docs/limitations.md).

## Staff web app (dashboard)

- **Assets:** every tenant's invoices, customers, messages, payments; the ability to send and to confirm money.
- **Entry points:** sign-in (Supabase Auth), server actions, route handlers, the CSV upload, exports.
- **Abuse and controls:** reading another tenant (IDOR) -> RLS on every table plus tenant re-checks in every RPC
  (e2e `idor`, `bypass`; pgTAP `role_matrix`); a collector doing an owner's job -> role matrix as data, enforced in
  the database (rule 33); a hostile CSV (formula injection, huge or mis-encoded file) -> size and encoding checks,
  formula neutralisation on export (rule 14); stored XSS through customer text -> text-only rendering, lint bans on
  HTML sinks, CSP with nonces (rule 34); CSRF on server actions -> Next.js origin checks plus same-origin cookies.
- **Residual risk:** a stolen staff session acts as that member until it expires; there is no second factor and no
  separate sign-in rate limit beyond Supabase Auth's own (limitations.md). An owner can export everything their tenant
  holds (by design, and logged).

## Public pay and opt-out pages

- **Assets:** one invoice's amount and status, the customer's opt-out state.
- **Entry points:** `/p/<token>`, `/o/<token>` and their POST actions.
- **Abuse and controls:** guessing links -> 32 random bytes, stored hashed (rule 36); scanners triggering actions ->
  GET never changes state, actions are POSTs (rule 35); probing which links exist -> invalid, expired and revoked
  links answer identically, rate limits per IP and token (rule 39; timing measured by the security suite); token
  leaks through Referer -> `no-referrer`, no third-party resources; claims of payment -> only a verified provider
  signal confirms money; "already paid" and uploaded proofs create tasks (rules 6, 27, 31).
- **Residual risk:** whoever holds a pay link (a forwarded email) sees that invoice's amount and can promise a date
  or upload a proof for a human to review. Links expire (ADR 0036) but are not bound to a person.

## REST API (`/v1/invoices`)

- **Assets:** a tenant's invoices (create, read).
- **Abuse and controls:** stolen keys -> keys stored hashed, shown once, revocable, never logged (ADR 0048);
  replays -> idempotency keys; oversized or malformed bodies -> size cap and schema validation.
- **Residual risk:** an API key is a bearer credential with the tenant-wide scope it was given; there is no IP
  allow-list.

## Webhooks service

- **Assets:** the ability to record replies and confirm payments.
- **Abuse and controls:** forged deliveries -> signature verified over the raw body with that account's secret before
  anything is parsed or stored (rule 23); cross-tenant injection -> the account comes from the opaque URL token, the
  tenant and invoice from our rows (rule 30); replays -> provider event ids are idempotent (rule 29).
- **Residual risk:** a leaked signing secret lets an attacker mark that tenant's invoices paid. Rotation is in
  Settings > Integrations; detection relies on `pnpm payments reconcile` against the provider (read-only).

## Worker (reminders, payments processing, receipts)

- **Assets:** the right to send to customers; money application.
- **Abuse and controls:** duplicate sends -> one idempotency key per action, at most one adapter call per key, unknown
  outcomes parked for a human (rules 7, 17; chaos tests); stale jobs after a crash -> dropped before decide()
  (ADR 0052); runaway sending -> kill switch checked before every send, budgets and quiet hours (rule 18).
- **Residual risk:** it holds the database password and provider credentials in memory; anyone with the host has
  them. It exits on a lost database connection and needs a supervisor (F9).

## Inbound processor and classifier

- **Assets:** invoice state changes caused by replies.
- **Abuse and controls:** prompt injection in a reply -> customer text is data; the model can only return a
  schema-validated proposal; only planReplyOutcome and the state machine change state; nothing from a reply can send
  (rules 21, 22; adversarial suite); spoofed senders -> ambiguous matching becomes a human task (rule 24); dates from
  the model -> validated against the reference time (rule 26).
- **Residual risk:** a convincing spoofed email from a customer's real address can still create a promise (which
  only pauses reminders) or a dispute task. Reply text goes to the model provider when a model is configured
  (docs/data-handling.md).

## Payments and proofs

- **Assets:** the ledger (receipts, applied payments, credits), proof images.
- **Abuse and controls:** inventing money -> only verified provider events or an authorised human confirm; every
  receipt balances (rule 28; `pnpm payments:integrity`); a fake proof screenshot -> extracted text is a hint, never an
  amount; a human types amount, date and reference (rule 31); malicious files -> magic-byte checks, size limits,
  private bucket, a sandboxed file route.
- **Residual risk:** a human can be fooled by a convincing fake proof; the system only makes sure a human decided.

## Storage and the database

- **Assets:** everything above.
- **Abuse and controls:** API access without RLS -> none exists (`db:catalog-audit`); a public bucket -> none; the
  service-role key -> server env only, never in a bundle, log or image (rules 12, 37; scans).
- **Residual risk:** the service-role key and the database password bypass RLS by design, and Supabase notes that
  revoking privileges on Vault, pg_cron and extension objects from `service_role` has no effect: a leaked service key
  exposes every tenant and every stored credential. Backups contain customer data and are only as protected as the
  place they are stored; they do not contain Vault secrets (docs/runbook.md).

## CI and the repository

- **Assets:** the code, the release process, any credentials in CI.
- **Abuse and controls:** secrets committed -> repo:audit scans tree and full history and is proven to fire (rule 46);
  dependency attacks -> frozen lockfile, no dependency build scripts unless allowed, `pnpm audit` reviewed;
  workflow permissions are `contents: read`.
- **Residual risk:** pattern-based secret scanning misses secrets with no known shape; third-party GitHub Actions run
  with the workflow's permissions (pinned by major version, not by commit SHA).

## Demo

- **Assets:** the developer's machine; any real credentials in their shell.
- **Abuse and controls:** the demo reaching a real database or provider -> it refuses non-local URLs and live-looking
  keys and unsets nothing silently (it stops instead); demo logins leaking into production -> passwords are random per
  run and never stored, demo code is excluded from images and the production build (scanned, rule 41).
- **Residual risk:** the demo prints its logins to the terminal (by design, once); anyone who can read that terminal
  can sign in to the local demo.
