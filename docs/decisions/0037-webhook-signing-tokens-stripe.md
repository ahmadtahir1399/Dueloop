# 0037: Webhook signing, opaque tokens, and the Stripe adapter (prompt 5, issues G, H, O)

**Context.** Each tenant connects its OWN Stripe account (guide Part 6). The signature secret belongs to the
account, so the route must find the account before it can verify anything.

**Decision.**
- Route `/webhooks/payments/<token>`. The token is 256 random bits, and only its sha256 is stored. It finds the
  account and authorises nothing (updates ADR 0023). An unknown token gets a 404, a bad signature a 401, a
  mode mismatch a 400. Nothing unverified is stored (rule 23).
- Stripe signature (docs.stripe.com/webhooks/signatures): `Stripe-Signature` `t=` plus one or more `v1=`.
  Each is an HMAC-SHA256 over `t.rawBody`, compared in constant time, with a 300 s tolerance (the library
  default, never 0). Other schemes such as `v0` are ignored.
- API version pinned: `Stripe-Version: 2026-09-30.endive` (docs.stripe.com/api/versioning, current on
  2026-10-28). The webhook endpoint must be created with the same version.
- Events acted on (docs.stripe.com/api/events/types): `checkout.session.completed` (paid only when
  `payment_status = paid`, otherwise processing), `checkout.session.async_payment_succeeded` and `_failed`,
  `charge.refunded`, `charge.dispute.created`. `provider_ref` is the PaymentIntent id. Metadata is ignored.
- Restricted key (docs.stripe.com/keys/restricted-api-keys): the calls made are POST /v1/payment_links and
  POST /v1/payment_links/:id, which need Payment Links write, and GET /v1/checkout/sessions, which needs
  Checkout Sessions read. `price_data` may also need Products/Prices write. The docs map permissions from
  observed calls, so confirm them in a sandbox (NOT VERIFIED). Idempotency-Key on every POST.
- A key whose `rk_/sk_` mode differs from the account mode is refused before any call. `pnpm smoke:stripe`
  refuses live keys.
