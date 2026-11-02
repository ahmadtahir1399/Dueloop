# 0054: Resend as an optional email sender over HTTPS

**Context.** The owner wants to host the app and already has Resend set up. Resend also offers SMTP, which needed no
code, but some hosts block mail ports. The owner asked for a code change instead.

**Decision.** Add `createResendChannel` (`packages/adapters-email/src/resend.ts`), which calls
`POST https://api.resend.com/emails`. `emailChannelFromEnv` picks it when `RESEND_API_KEY` is set and SMTP otherwise,
so nothing changes for existing setups. It is the operator's one key for every tenant:
- `SMTP_FROM_DOMAINS` still limits the sender domains, in the adapter and in Settings.
- `SMTP_ALLOW_TENANT_HOST=true` together with `RESEND_API_KEY` fails validation, because the Integrations page would
  offer a mail server the worker never uses.
- The ops watchdog sends through the same adapter, and `doctor` checks that `api.resend.com:443` accepts a connection.
- The demo refuses to run with the key set (rule 41), and `demo:send`, `demo:replies` and `demo:payments` delete it.

**How it was written.** From Resend's send-email and errors pages (read 2026-11-01):
- 400 and 422 are permanent. 401, 403, 404, 405 and 429 are refusals, so the message may be retried once the cause is
  fixed. 5xx is ambiguous because the request may have been half-processed.
- 409 is ambiguous: it means this idempotency key is still in flight, or was already used with a different body.
- A 2xx without an id, a timeout or a connection lost after the request left are ambiguous (rule 17). Only errno codes
  that prove no connection was made are retryable.
- `Idempotency-Key` carries our key (rule 7). Resend keeps keys for 24 hours, so it is a second defence and does not
  change rule 17: an ambiguous message is never resent automatically.
- Reasons are status codes, never Resend's text, which can echo addresses (rule 20).
- `Message-ID` is not sent. Resend documents custom headers but not this one, so our own Message-ID is lost on this
  path. Nothing reads it in production today because email replies are not read.
- The recipient's name is not sent, because the docs describe `to` as an address only.

**Consequences.** Email sends work on hosts that block mail ports. NOT VERIFIED against a real Resend account: the
tests use a scripted `fetch`. The quoted `from` name in particular is standard RFC 5322 but the docs show only an
unquoted example.
