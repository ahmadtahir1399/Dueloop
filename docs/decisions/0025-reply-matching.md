# 0025: Matching replies to invoices (never guess)

**Decision** (`packages/inbound/src/match.ts`, rule 24):

1. **Thread.** The email's In-Reply-To or References (or a DSN's returned Message-ID), or WhatsApp
   `context.id`, points at one of OUR outbound messages. Its `message_invoices` give the invoice. A hit
   counts only if that outbound message went to the same customer; a forwarded or hijacked thread from
   someone else does not.
2. **Otherwise**, if the customer has exactly one non-final invoice with an outbound reminder in the last
   30 days (`MATCH_WINDOW_DAYS`), that invoice is used.
3. **Otherwise** nothing matches. The pipeline creates an `ambiguous_invoice` task listing the candidates
   (ids and numbers only) with a code-written DRAFT "which invoice do you mean?". Opt-out is still honoured.

`messages.matched_by` records which rule applied: `thread`, `context_id`, `single_open_invoice` or
`none`. A match to a FINAL invoice stores the message and honours only opt-out and dispute-as-task.

**Consequences.** A customer with several open invoices who replies without quoting gets a human, never a
guess. WhatsApp `context.id` on a quoted user reply is used when present; Meta's reference
(webhooks/reference/messages/text) documents `context` only for "Message business" button messages, so
quoted-reply `context.id` is NOT VERIFIED against live traffic.
