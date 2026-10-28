# 0023: The webhook runtime

**Decision.** `packages/webhooks` is one small `node:http` service (`pnpm webhooks`):
- **No framework.** Raw-body access is mandatory, and `node:http` gives the bytes before anything parses
  them. There are four routes: `GET /healthz`, plus `GET` and `POST` on `/webhooks/whatsapp`.
- **WhatsApp Cloud API**, per Meta's docs (webhooks/create-webhook-endpoint and
  webhooks/reference/messages/{text,status}, read 2026-10-28):
  - **Handshake**: `GET ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…` returns 200 with the
    challenge only if the token matches (timing-safe); anything else is 403.
  - **Signature**: `X-Hub-Signature-256: sha256=<hex HMAC-SHA256(raw body, app secret)>`, verified
    timing-safe over the raw bytes before parsing (rule 23). The header format is checked strictly first
    (issue A: `Buffer.from(hex)` never throws, so the guide's try/catch could not reject malformed hex).
  - **Limits**: body ≤ 256 KB (413), JSON content type only (415), and a per-address token bucket (429).
    Unsigned or invalid requests get 401 and nothing is stored. Responses are fixed short strings, never
    stack traces.
- **Tenant**: `metadata.phone_number_id` → `channel_accounts.external_account_id`, which is globally unique
  per channel. URLs never carry tenant ids, and the payload's own claims are never trusted.
- **Update (prompt 5, ADR 0037).** Payment providers sign with a secret that belongs to each tenant's account,
  so the route must know which account a delivery is for before it can verify it. It does this with
  `/webhooks/payments/<opaque token>`: a random 256-bit value per payment account, with only its sha256 stored.
  The token is still not a tenant id. It reveals nothing, it authorises nothing (the provider signature over
  the raw body does), and an unknown token gets the same 404 as any other path.
- **Storing**: each message or status item is its own `inbound_events` row, deduped on the wamid (messages)
  or wamid:status (statuses). The service returns 200 fast, including for duplicates and unknown accounts,
  because Meta retries non-2xx and a retry cannot help.
- `hmac` lives here, not in core (issue A): core stays luxon-only.

**Not verified.** Live delivery from Meta needs a public HTTPS URL in front of this service (a tunnel or a
reverse proxy) and the app configured in the Meta dashboard. That is manual; `pnpm smoke:whatsapp-webhook`
checks a deployed URL and is gated. All tests use signed fixtures built from the documented shapes.
