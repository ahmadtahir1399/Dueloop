# 0030: Inbound PII, logging and purge (rule 25)

**Decision.**
- **Raw provider payloads** (`inbound_events.payload` / `raw_mime`) are PII. No client role can read them
  (RLS on, no policy, no grant). They carry `purge_after = received_at + 90 days`, and
  `private.purge_inbound` deletes processed or dead events past that point. It runs daily via pg_cron and
  is gated by `cron_enabled`.
- **The inbox** (`messages`, direction `in`) keeps the normalised text so humans can work tasks. Retention
  tooling beyond the purge column is out of scope (prompt 7).
- **The model's `summary`** is stored only as `analysis.untrustedSummary`. It is never logged, never put in a
  draft, event, alert or outbound message, and is marked untrusted for prompt 6's UI.
- **Logs**: ids, codes and counters only (the worker's allowlisting logger). The correlation id is
  `inbound:<event id>`. Bodies, contact details, raw payloads, tokens and the summary are never logged.
  Error strings stored on events are codes (`last_error`), never provider text.
- **What the model sees** is redacted: emails, phone/account numbers, the customer's and business's names
  and the customer's invoice numbers are replaced. Dates and amounts are kept, because the model needs
  them; the SIGKILL test caught a bug where they were redacted.
