# 0048: REST API (POST /v1/invoices) and API keys (prompt 6, issue O)

**Decision.**
- Keys: `dl_<8 lowercase alnum prefix>_<43 char base64url secret>`, created by `create_api_key` (owner only, at most
  10 active per tenant); only `sha256(secret)` is stored; the full key is shown once. Lookup by prefix, timing-safe
  comparison (`sameDigest`), a hash comparison even when the prefix is unknown. Scope `invoices:write` only (a CHECK
  constraint). Revocable; `last_used_at` recorded. The hash column is not selectable by any signed-in user.
- One route, Node runtime, inside the web app (one deployable; the route shares nothing with sessions). Order: body
  cap (1 MiB) before parsing -> key (one 401 for every failure) -> scope -> per-key limit (fail closed) -> JSON schema
  (zod, strict) -> Idempotency-Key -> ingest.
- Parity with the CSV import BY CONSTRUCTION: the JSON batch becomes the CSV a client would upload (amounts as
  integer minor units shown as major text by core `digitsToMajorString`, ISO dates with dateFormat `YMD`, explicit
  `default_country`), validated by ingest `validateFile`, staged by `stageImport` and committed by
  `commit_import_batch` (service role, which that RPC accepts). All-or-nothing unless `options.skip_invalid`.
  Tested by importing the same data through the API and the CLI and comparing rows.
- Idempotency: `api_idempotency (tenant, key)` stores the request hash and response for 24 h. Same key + same body
  replays the stored answer (`Idempotent-Replayed: true`); a different body is 422; concurrent identical calls: one
  runs, the others get 409 until it finishes.
- Next.js body limits: the proxy buffers up to `experimental.proxyClientMaxBodySize` and TRUNCATES above it (Next
  docs); it is set to 11 MB and every route enforces its own smaller cap first.
- Errors: `{"error": {"code", "message", "details?"}}`, never a stack trace. Docs: docs/api.md.
