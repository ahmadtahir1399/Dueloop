# 0032: Role matrix additions for payments (prompt 5)

**Context.** Phase 5 adds the money-in ledger (receipts, applied payment slices, credits), payment
accounts with Vault-held secrets, payment requests, raw payment events, proofs in private storage, and
KPI views. ADRs 0008, 0012 and 0022 cover the earlier tables. This table was written before the policies;
migration 0012 implements exactly this.

**Decision.** R = read, W = insert + update, - = nothing. Rows are for the user's own tenant.

| Table / action | owner | accountant | collector | non-member / anon | worker (trusted connection) |
|---|---|---|---|---|---|
| receipts (money in) | R | R | R | - | insert only (via `apply_payment`) |
| payments (applied slices) | R | R | R | - | insert only (via `apply_payment`); append-only for everyone |
| credits | R | R | R | - | insert only; append-only |
| payment_accounts (no secrets) | R | R | - | - | R |
| payment account secrets (Vault) | - | - | - | - | read via `private.payment_secret()` |
| payment_requests | R | R | R | - | all |
| payment_events (raw provider payloads, PII) | - | - | - | - | all |
| payment_proofs (metadata + untrusted hints) | R | R | R | - | all |
| proof files (storage bucket `payment-proofs`) | R (own tenant folder) | R | R | - | upload (trusted) |
| confirm / record a payment (`private.apply_payment`, sources manual/proof) | yes | yes | **no** | no | yes |
| KPI views | R | R | R | - | R |

- Nobody writes ledger rows directly. `private.apply_payment` is the single path. It checks, inside the
  invoice row lock, that the plan is exactly what the numbers allow. A human source (`manual`, `proof`)
  requires `confirmed_by` to be an owner or accountant of the tenant.
- No client role can upload, change or delete proof files. The proof inbox stores them through the trusted
  connection. Reads are tenant-folder scoped: `<tenant id>/<proof id>`.
- Payment accounts (connect, rotate, disable) are managed only by trusted server code in this phase. The
  dashboard (prompt 6) adds an owner-only RPC.
