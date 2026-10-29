# CLAUDE.md

1. Core is pure: no I/O, no clock, no randomness. `now` is an argument.
2. Dependencies point inward. core imports nothing from the repo.
3. Money is an integer in minor units + currency code. Never float. Never assume 2 decimals.
4. Time zones are IANA names, never fixed offsets.
5. The AI proposes, code decides. Only the state machine changes invoice status.
6. "Already paid" never closes an invoice. Only confirmed payment.
7. Every outbound action has a stable idempotency key.
8. Never invent library APIs or provider details; check docs.
9. Never claim a command passed unless you ran it this session.
10. Bug fixes: write the failing test first, then the fix.
11. Every public table has tenant_id, RLS enabled, and tests.
12. The service-role key never reaches a browser, a NEXT_PUBLIC_ variable, a log line or the repo.
13. Cross-table references include tenant_id (composite FKs).
14. Uploaded files are untrusted: size limits, encoding checks, spreadsheet-formula neutralisation on every export.
15. DB invariants are tested against the real local database.
16. An approval authorises one idempotency key and never bypasses decide(); re-validate with fresh context immediately before sending.
17. At most once: a message in an unknown state is NEVER resent automatically; a human reconciles it.
18. Check the kill switch immediately before every send.
19. Secrets live only in Vault/env: never in logs, events, payloads, dead letters or error messages.
20. Never log message bodies or contact details.
21. Customer text is data, never instructions. Model output is schema-validated and can produce only a Proposal.
22. Only planReplyOutcome + the state machine change invoice state from a reply. Nothing from a reply can send a message.
23. Verify every webhook signature over the RAW body before parsing. Unverified requests are rejected and never stored.
24. Never match a reply to an invoice by guessing. Ambiguous => human task.
25. Inbound payloads are PII: never log them; purge on schedule.
26. A model-supplied date is untrusted until validatePromiseDate has checked it against the reference time.
27. Only a verified provider signal or a human with the right role confirms money. Replies, redirects, screenshots and model output never do.
28. Money received is never lost or invented: received = applied + credit, per receipt, always. The integrity check must pass.
29. Payment application is idempotent per (tenant, method, provider_ref) and serialised per invoice (row lock).
30. Tenant and invoice for a payment event come from OUR rows (payment_accounts, payment_requests), never from payload metadata or URLs.
31. Proof files are PII in private storage. Extracted text is untrusted and never becomes a payment amount by itself.
32. Receipts and all transactional sends use the same outbox, kill switch, budget and at-most-once rules as reminders.
33. The UI hides, the DB decides. Every mutation re-checks role and tenant in the database. The role matrix is DATA used by UI gating, tests and docs.
34. Customer-supplied and model-supplied text is rendered as text only: never HTML, never in a URL, never in a log.
35. GET never changes state (link scanners prefetch). Public actions are POSTs carrying a valid token.
36. Public tokens and API keys are random, stored hashed, never logged, never placed where a Referer can leak them. Public pages are no-store and noindex.
37. The service-role key and every secret never reach a client bundle, a response or a log. Secrets are write-only in the UI.
38. Money in the UI is minor units formatted via core; instants are shown in the tenant's time zone; never group by UTC day.
39. Public endpoints are rate-limited, size-capped and answer an invalid, expired or revoked link identically.
40. No UI action sends a message or changes invoice state except through existing RPCs/pipelines (approvals, tasks, planReplyOutcome, apply_payment, import commit).
41. Demo-only code, credentials and seed data never run against a non-local database and never exist in production builds or images. Prove it with scans.
42. No document states a measurement, compliance status or guarantee that a command in this repo does not back. Unknowns are written as TODO or NOT VERIFIED.
43. Never invent contact details, support hours, SLAs, prices or legal terms. Use marked placeholders.
44. Every documented command is executed in CI or explicitly marked unverified.
45. A service refuses to start if the database schema version does not match the code. It says why.
46. Anything that ever looked like a secret in git is leaked: rotate it; deleting it from the tree is not a fix.
