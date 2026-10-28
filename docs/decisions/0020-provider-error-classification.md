# 0020: Provider error classification

A send counts as "not sent" only with proof. Anything else is ambiguous (rule 17).

**SMTP (nodemailer 10.2.1)**
- A 4xx/5xx server reply → not sent. It is permanent when nodemailer sets `permanent` (5xx except 503),
  otherwise retryable.
- `EENVELOPE`, `EMESSAGE`, `EMAXRECIPIENTS` (local validation) → permanent.
- Not sent, retryable:
  - an `originalCode` that proves no connection was made (ECONNREFUSED, ENOTFOUND, EAI_AGAIN,
    EHOSTUNREACH, ENETUNREACH, EADDRNOTAVAIL);
  - EDNS, EAUTH, ENOAUTH, EOAUTH2 or ECONFIG;
  - `command: 'API'`.
- Everything else → ambiguous.

Verified in nodemailer's source: every socket error, close and timeout is tagged `command: 'CONN'`
whatever phase the session is in, so `'CONN'` alone does not prove the message was not sent. Contract
tests drive a scripted SMTP server through every phase.

**WhatsApp Cloud API**
- 2xx with `messages[0].id` → sent (the wamid is stored as the provider id). 2xx without an id → ambiguous.
- Codes 4, 80007, 130429, 131056, 2, 131016 (throttling or temporarily unavailable) → retryable.
- Codes 1 and 131000 (generic errors) → **ambiguous**. Meta's guide says they may be retried, but with no
  idempotency key a retry can double-send.
- The documented permanent codes (190, 368, 131026, the 1320xx family, …) → permanent.
- An unrecognised 4xx → permanent; an unrecognised 5xx → ambiguous; HTTP 429 → retryable.
- A DNS failure or refused connection → retryable; a timeout or connection reset → ambiguous.
- The Graph API version has no default: `WHATSAPP_GRAPH_VERSION` must be set, otherwise WhatsApp is not
  wired at all.

**Slack incoming webhooks**: best effort. Errors are reported as `slack_<status>_<code>` without the URL,
and only `https://hooks.slack.com/` URLs are called.

Reason strings are codes only, never server text, because server text can echo addresses (rule 20).
