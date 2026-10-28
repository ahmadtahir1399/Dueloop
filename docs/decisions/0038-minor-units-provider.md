# 0038: Minor units versus the provider (prompt 5, issue I)

**Context.** Our amounts are integers in ISO 4217 minor units (rule 3). Stripe's `amount` is in "the currency's
smallest unit", with its own zero-decimal list and special cases (docs.stripe.com/currencies, fetched 2026-10-28).

**Decision.**
- `stripeAmount(minor, currency)` passes the number through unchanged in exactly two cases: ISO exponent 2
  and not on Stripe's zero-decimal list, or ISO exponent 0 and on that list (BIF CLP DJF GNF JPY KMF KRW MGA PYG
  RWF VND VUV XAF XOF XPF).
- Refused: ISK and UGX, where the page contradicts itself (UGX is on the zero-decimal list, yet both are
  "sent as two-decimal values ending in 00"); three-decimal currencies (KWD, BHD, JOD, OMR, TND), which the
  page does not cover; and any exponent mismatch. In those currencies reminders carry bank text only
  (`supportsCurrency`), and an incoming amount maps to -1, which the pipeline treats as a mismatch, never money.
- HUF and TWD charge two-decimal amounts (their zero-decimal rule is for payouts only), so they pass.

**Consequences.** Adding a refused currency needs a sandbox test of the exact amounts first.
