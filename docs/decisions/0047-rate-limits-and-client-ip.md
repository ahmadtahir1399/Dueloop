# 0047: Rate limits in Postgres; client IP; CSP exceptions (prompt 6, issue P)

**Context.** In-memory limiters do not work across instances. Public pages, uploads, the API and sign-in need limits.

**Decision.**
- Store: `private.rate_limits` (unexposed schema) and `private.rate_limit_hit(bucket, window, limit, now)`: one atomic
  upsert per hit, fixed windows. Justification: the database is already shared by every instance and is the
  system of record; no new service (Redis) to run or secure for this volume. Old windows are purged by
  `private.purge_rate_limits` (retention job).
- POSTs and API calls are FAIL-CLOSED: if the store cannot be reached the action is refused (503 / "try later").
- GETs must write nothing (rule 35), so they cannot use the DB counter: an in-memory per-instance throttle applies
  to GETs only (reads; a multi-instance deployment should also rate-limit at its proxy).
- Buckets: per token + per IP for actions (`LIMITS.actionPerToken` 20/h, `actionPerIp` 60/h), proof uploads 5/day
  per token (plus prompt 5's per-customer daily cap), API 60/min per key and 120/min per IP.
- Client IP: `X-Forwarded-For` is trusted only when `TRUST_PROXY_HOPS` is set; the address is taken that many hops
  from the right (written by the deployment's own proxies). Default 0 = no IP buckets (token and key limits still
  apply). The deployment MUST set this to match its proxy chain (prompt 7 handoff).
- Sign-in attempts go to Supabase Auth directly from the login action; its own rate limits apply (supabase/config.toml
  `[auth.rate_limit]`). NOT implemented: a separate per-IP sign-in counter of ours (listed in limitations).
- CSP exceptions (documented): `style-src-attr 'unsafe-inline'` on staff pages (Radix/shadcn position elements with
  style attributes; attributes cannot run script). Development adds `'unsafe-eval'` (Next.js docs); production does not.

**Consequences.** Tests: pgTAP (third hit refused), API 429, public-page limits. Store outage: `hit()` returns
`unavailable` and every write endpoint refuses.
