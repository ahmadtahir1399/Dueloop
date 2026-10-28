# 0036: Payment link lifetime (prompt 5, issue F)

**Context.** Reminders can be read days after they are sent. A Stripe Checkout Session expires after 30
minutes to 24 hours (docs.stripe.com/api/checkout/sessions/create, `expires_at`), so a link in an email
would often be dead. A signed pay page of our own is prompt 6.

**Decision.**
- Stripe Payment Links (docs.stripe.com/api/payment-link) are durable until deactivated. Each link has one
  fixed `price_data` amount equal to the current balance, `restrictions.completed_sessions.limit = 1`, and
  no customer data. The reference code is the only label.
- One active request per (invoice, provider). It is reused while its amount equals the balance and it stays
  valid for at least 24 hours; otherwise it is replaced. The idempotency key is
  `payreq:<invoice>:<provider>:<balance><currency>:g<generation>`, stable across a crash and a retry.
- Any change to our rows (paid, partial payment, closed invoice) retires the request inside the ledger
  transaction. The provider object is switched off right after commit (`active=false`). A sweep retries
  until `provider_deactivated_at` is set (migration 0013).
- The link is created before the outbox claim. A crash leaves at worst an unused link, never a duplicate send.
