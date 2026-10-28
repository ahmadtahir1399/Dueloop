# 0017: Routing and consent; no automatic fallback

**Decision.** The policy step's channel is the only channel tried. If it cannot be used, nothing goes out
on another channel. The reasons fall into two groups:
- **skip** (recorded as a skipped message; the sequence moves on): `no_contact`, `no_consent`;
- **park** (the invoice stops and the owner gets one alert until someone fixes the cause and runs
  `pnpm messages unpark`): `budget_exhausted`, `template_missing`, `template_unapproved`,
  `account_missing`, `template_render_failed`, `unsafe_address`.

WhatsApp needs an active `customer_consents` row. Email relies on the existing business relationship plus
the opt-out footer on every email. Opted-out customers are never contacted: `decide()` checks this, and the
send gate checks it again.

**Consequences.** No surprise channel switching (issue I). The guide's fallback idea is deferred, because
it changes what the customer agreed to.
