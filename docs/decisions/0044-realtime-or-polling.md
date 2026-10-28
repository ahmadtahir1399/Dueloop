# 0044: Nav counters by polling, not Realtime (prompt 6 step 7)

**Context.** The nav shows counts of pending approvals, open tasks, pending proofs and unknown sends. Supabase
Realtime "Postgres Changes" applies RLS to authenticated subscribers, but it is a separate service with its own
plan limits, and it is disabled in this project's `supabase/config.toml` (`[realtime] enabled = false`).

**Decision.** Counters come from one security-invoker RPC (`nav_counters`, migration 0017, partial indexes). The
layout renders them on every navigation; a client component polls `GET /counters` every 30 s
(`COUNTER_POLL_MS`) while the tab is visible. Nothing depends on the badge: every list reads the database.

**Consequences.** A new task can take up to 30 s to show in the badge (a delay, never a wrong state). No extra
service to run or secure, no cross-tenant channel to get wrong: the RLS test for `nav_counters` (outsider sees
zero) is the only isolation surface. Revisit if a tenant asks for instant updates.
