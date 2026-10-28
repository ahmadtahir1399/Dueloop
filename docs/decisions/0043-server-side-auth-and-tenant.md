# 0043: Server-side authentication and tenant derivation (prompt 6, issue H)

**Context.** The dashboard runs on Next.js 16 (App Router) with `@supabase/ssr` 0.12. A cookie value alone proves
nothing: it can be forged or replayed after sign-out. Users can belong to several tenants.

**Decision.**
- Every request is authenticated on the server with `supabase.auth.getClaims()`, which verifies the JWT's
  signature and expiry (Supabase SSR docs, "Creating a Supabase client for SSR" / "Protecting pages"; `getSession()`
  is not used because it trusts the cookie). The proxy (`apps/web/proxy.ts`, Next 16's name for middleware,
  `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`) refreshes the session for staff
  routes only; public link pages and `/v1` never read or set the session cookie.
- The tenant comes from the user's memberships, read under RLS. The `dl_tenant` cookie is a hint that selects one
  of them; an unknown or malformed value falls back to the first membership. No membership: `/onboarding`.
- Every server action calls `requireTenant()` again (actions are public POST endpoints), and RPCs run with the
  USER's client, so RLS and the in-function role checks apply. Screens a role may not use answer 404.
- Staff actions that run existing trusted pipelines (payments, proofs, unknown-message reconciliation) first read
  the target row under RLS with the user's client (tenant check), then ask the database
  (`private.member_has_role`) about the verified user id, then call the same function the CLI calls with that id
  as the actor. `apply_payment` re-checks the role inside its own transaction.
- Server Actions' CSRF check compares `Origin` with the host and lets requests WITHOUT `Origin` through with a
  warning (`.../05-config/01-next-config-js/serverActions.md`). Public link actions therefore use route
  handlers with their own Origin check (ADR 0045).

**Consequences.** Tests: `e2e/staff/foundation.spec.ts` (forged auth cookie, tampered tenant cookie, multi-tenant
switching, no tenant), `idor.spec.ts` (forged ids in every action), `bypass.spec.ts` (direct RPCs per role).
