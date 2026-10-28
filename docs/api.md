# REST API

One endpoint: `POST /v1/invoices`. It imports invoices exactly like the CSV import (same validation, same commit).
There are no other routes or methods under `/v1`.

## Authentication

Create a key as an owner (Settings, API keys). It is shown once and looks like `dl_ab12cd34_<secret>`.

```
Authorization: Bearer dl_ab12cd34_<secret>
```

Missing, malformed, unknown and revoked keys all get the same `401`.

## Request

```http
POST /v1/invoices
Content-Type: application/json
Idempotency-Key: erp-batch-2026-10-28-001

{
  "options": { "default_country": "GB", "skip_invalid": false },
  "invoices": [
    {
      "number": "INV-1001",
      "customer": { "name": "Acme Ltd", "email": "accounts@acme.example", "phone": "+44 20 7946 0958", "external_id": "C-001" },
      "amount_minor": "125050",
      "currency": "GBP",
      "issued_on": "2026-09-01",
      "due_on": "2026-10-01"
    }
  ]
}
```

- `amount_minor`: integer minor units (string or integer), e.g. `125050` = 1,250.50 GBP; `999` JPY = ¥999.
- Dates: `YYYY-MM-DD`, calendar dates, never guessed.
- `default_country`: ISO 3166-1 alpha-2, used to read national phone numbers.
- At most 500 invoices and 1 MiB per request. Unknown fields are refused.
- `skip_invalid: false` (default): if any invoice is invalid, nothing is imported. `true`: valid ones are imported and
  the invalid ones are listed in `skipped_invalid`.

## Responses

`201 Created`

```json
{ "batch_id": "…", "counts": { "invoices": { "created": 1, "updated": 0, "unchanged": 0, "skipped": 0, "errored": 0 }, "customers": { … } }, "skipped_invalid": [] }
```

Errors always have one shape and never contain stack traces:

```json
{ "error": { "code": "invalid_invoices", "message": "…", "details": [ { "index": 1, "errors": [ { "code": "invalid_date", "message": "…" } ] } ] } }
```

| Status | `code` | When |
|---|---|---|
| 400 | `invalid_json`, `invalid_idempotency_key` | body is not UTF-8 JSON; bad key header |
| 401 | `unauthorized` | any key problem |
| 403 | `forbidden` | the key lacks `invoices:write` |
| 409 | `in_progress`, `commit_refused` | the same Idempotency-Key is still running; the batch could not be committed |
| 413 | `payload_too_large` | body over 1 MiB (checked before parsing) |
| 415 | `unsupported_media_type` | not `application/json` |
| 422 | `invalid_request`, `invalid_invoice`, `invalid_invoices`, `invalid_batch`, `idempotency_key_reused` | schema, value or row errors; reused key with a different body |
| 429 | `rate_limited` | 60 requests a minute per key (and 120 per IP when the deployment sets `TRUST_PROXY_HOPS`) |
| 503 | `unavailable` | the rate-limit store is unreachable (fail closed) |

## Idempotency

Send `Idempotency-Key` (1-200 printable ASCII characters) to make retries safe. For 24 hours the same key with the
same body returns the stored response with `Idempotent-Replayed: true`; with a different body it is refused (422).
Concurrent requests with the same key: one runs, the others get 409 until it finishes.

Tests: `apps/web/e2e/staff/api.spec.ts` (valid, mixed with and without skip_invalid, duplicates, bad currency and
amount, oversize, revoked key, replay with same and different body, concurrent calls, rate limit, CSV parity).
