# 0045: Opaque public-link tokens and the public page security model (prompt 6, issues A, B, C, E, F)

**Context.** Reminders link customers to a pay page and an opt-out page. The guide suggested HMAC/JWT tokens
(self-contained: invoice id, expiry, purpose). Those cannot be revoked, and they leak through URLs, logs, browser
history and Referer headers. Email scanners and chat previews fetch every link.

**Decision.**
- Tokens are 32 random bytes, base64url (`packages/links`). Only `sha256(token)` is stored, in `public_links`
  (tenant, purpose `pay|opt_out`, invoice for pay, customer, expiry, revocation, use counters). A token says nothing.
- `private.resolve_public_link` (security definer, not executable by anon/authenticated/service_role; the web server
  calls it on its trusted connection) returns a row only for a matching hash, purpose, no revocation and no expiry.
  Unknown, malformed, expired, revoked and wrong-purpose tokens get the SAME 404 page (malformed tokens still run a
  dummy lookup, so they take similar time).
- GET pages are route handlers that render plain escaped HTML (no React runtime, no client JS needed; the copy
  button is an optional nonce'd script). GET writes nothing: no counters, no session, no provider call (tested by a
  snapshot of every table before and after scanner-style GETs). Every action is a POST.
- POSTs are CSRF-checked with Fetch Metadata (`Sec-Fetch-Site: same-origin`) or an exact `Origin`. Our pages send
  `Referrer-Policy: no-referrer`, and for such pages browsers send `Origin: null` on form POSTs (Fetch spec,
  "serializing a request origin"), so Origin alone would refuse our own forms. Bodies are capped before parsing.
- Pay: the provider checkout is created on POST through prompt 5 `createRequestFor` (one active request per
  invoice + provider), then a 303 to the provider. The redirect carries no token and no Referer.
- Promise, copy request and opt-out are structured Proposals planned by core `planReplyOutcome` with the same rules
  the inbound processor uses (tenant promise_acceptance, renewal cap, horizon, `validatePromiseDate`) and applied
  by `InboundDb.applyPlan`, recorded as an inbound message on the `web` channel. A valid token counts like a thread
  match (it proves possession of our message). **A forwarded link carries the same power**; staff can revoke links.
- Opt-out: RFC 8058 one-click POST (`List-Unsubscribe=One-Click`, no cookies, no Origin) is accepted at
  `/o/<token>/unsubscribe` with a 200 and no redirect; the email adapter adds `List-Unsubscribe` and
  `List-Unsubscribe-Post` only when the URL is https (RFC 8058 requires one HTTPS URI and DKIM over both headers).

**Consequences.** Tests: `packages/links/test`, `supabase/tests/web/public_surface.test.sql`,
`apps/web/e2e/staff/public-pages.spec.ts`. Deviation from the guide on purpose (opaque tokens, not JWT).
