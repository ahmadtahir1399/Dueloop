# 0018: Message budget semantics

**Decision.**
- `tenants.monthly_message_budget_minor` is in the tenant currency's minor units and covers **paid
  channels only** (WhatsApp, SMS).
- The month is the tenant-local calendar month. Spend is the sum of `messages.cost_minor` over sent,
  pending and unknown messages in that month.
- The cost per message is a documented placeholder (`COST_MINOR`: whatsapp 10, sms 10, email 0) until we
  have real provider pricing.
- A budget of 0 blocks paid channels (the step parks with `budget_exhausted`, issue H). Email is never
  budgeted.

**Decision needed.** Should 0 mean "unlimited" instead? Should the budget also cover email-provider
costs?
