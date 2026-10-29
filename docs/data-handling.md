# Data handling

Every place the running system sends data, taken from the code (2026-10-29). `pnpm egress:check` compares the list
at the end of this page with the destinations it can find in runtime code and fails on any difference. It is static
and best-effort: it cannot see URLs built at runtime (for example the media URL the WhatsApp Graph API returns),
hosts configured through env or tenant settings (listed below as `config:*`), destinations inside third-party SDKs
beyond their documented defaults, or redirects.

This page describes the software. Whether a deployment is lawful (consent, contracts with processors, retention,
transfers) is for the operator and their advisers; this project makes no compliance claim. <!-- claims-ok: disclaimer -->

| Destination | When | Data sent | Retention on our side | Who can read it here |
|---|---|---|---|---|
| Supabase (Postgres, Auth, Storage), `config:SUPABASE` | always | everything the product stores: tenants, members, customers (name, email, phone), invoices, messages, payments, proof files | until erased or purged (ADR 0051; runbook "Data lifecycle") | members of the tenant through RLS by role; the service-role key and DB password see all |
| SMTP server, `config:SMTP` | reminder, receipt, owner alert, ops alert emails | recipient address, subject, body (invoice number, amount, due date, pay and opt-out links), Message-ID, List-Unsubscribe | the outbox keeps the message row; bodies are redacted on erasure | owners/accountants through the dashboard |
| IMAP server, `config:IMAP` | the inbound poller, when an email channel has IMAP configured | credentials for login; reads replies (no data is uploaded) | raw inbound payloads until `purge_after` | owners/accountants (tasks, inbox) |
| WhatsApp Cloud API, `graph.facebook.com` | WhatsApp reminders (approved templates only); fetching media a customer sent; the web server checking a phone number id with the business's own token when an owner saves it | recipient phone number, template name and its parameters (invoice number, amount, link where the template has one); media ids | as SMTP | as SMTP |
| Anthropic API, `api.anthropic.com` | only when a model is configured: reply classification (`CLASSIFIER=anthropic`), proof hints (`PROOF_EXTRACTION`, off by default per tenant) | classification: the customer's reply text, redacted (no names, emails, phone numbers or invoice numbers), truncated, with the reference date, time zone, currency and locale; proof hints: the proof image | the model output is stored as an untrusted proposal or hint | members who can see the reply or proof |
| OpenAI API, `api.openai.com` | instead of Anthropic, when `CLASSIFIER=openai` or `PROOF_EXTRACTION=openai` (ADR 0053) | the same as the Anthropic row; requests set `store: false` so OpenAI does not keep the response as a stored object (OpenAI's own retention terms still apply; NOT VERIFIED here) | as the Anthropic row | as the Anthropic row |
| Stripe API, `api.stripe.com` | creating or deactivating a payment link (tenant's own Stripe account) | amount, currency, a product name "Invoice payment <reference>", `metadata[dueloop_reference]` | payment requests and receipts (ledger kept on erasure) | owners/accountants |
| Stripe Checkout and Payment Links, `checkout.stripe.com`, `buy.stripe.com` | the customer's browser, after "Pay now" (a redirect, not a server call) | whatever the customer enters on Stripe's page | not stored by us | - |
| Slack, `hooks.slack.com` | owner alerts, when a tenant configured a Slack webhook | alert title and lines (counts, invoice numbers, reasons; no message bodies or contact details) | not stored by us | - |
| Error reporter | never: the `ErrorReporter` interface is a no-op; no vendor SDK is wired (`SENTRY_DSN` is reserved and unused) | - | - | - |

Inbound data (replies, webhooks, proofs) is PII and is purged on schedule (`pnpm retention:run`); see ADR 0030 and
ADR 0051. Logs never contain message bodies, contact details, tokens or secrets (rules 20, 25, 36; the security suite
scans the server log).

Not runtime (never in an image): the demo's preflight checks `public.ecr.aws` reachability on a first run, and the
demo's fake payment provider uses the unroutable `pay.fake.test`.

<!-- egress: config:SUPABASE config:SMTP config:IMAP graph.facebook.com api.anthropic.com api.openai.com api.stripe.com checkout.stripe.com buy.stripe.com hooks.slack.com -->
