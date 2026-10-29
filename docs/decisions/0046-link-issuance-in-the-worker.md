# 0046: Link issuance in the worker (prompt 6, issues C, D)

**Context.** The payment block of prompt 5 carried a provider link created before the claim. Prompt 6 replaces it
with OUR pay-page URL; the provider object is created only when the customer presses Pay.

**Decision.**
- When `PUBLIC_APP_URL` is a valid base URL, the worker (composition root `publicLinksFrom`) issues one fresh `pay`
  link (TTL `PAY_LINK_TTL_DAYS` = 60) and one fresh `opt_out` link (TTL `OPT_OUT_LINK_TTL_DAYS` = 365) per outbound
  reminder, in one transaction, BEFORE the outbox claim. A failure releases the job with backoff, then parks it
  (`public_link_unavailable`); it can never leave a message in the unknown state.
- **Deviation:** links are not reused across reminders. Tokens are stored only as hashes, so an existing link's URL
  cannot be rebuilt; reusing would mean storing tokens recoverably. Each reminder carries its own links; old ones
  stay valid until they expire or are revoked, and the page always shows the CURRENT balance and state.
- The payment block gets the pay-page URL (built from configuration, so not passed through `safePayLink`, which is
  for provider URLs). The footer gets "Or stop them here: <opt-out URL>" after the reply-STOP text (WhatsApp; email says "use this link"
  and never "reply STOP" since review round 2, because email replies are not read in production); email gets the
  RFC 8058 headers when the URL is https. Without `PUBLIC_APP_URL` the prompt 5 behaviour is unchanged.
- Final invoices need no revocation trigger: the page shows "already paid" or "closed" for them.
- **WhatsApp (issue D): STOPPED, not changed.** The approved `nudge` template has no link variable (its body has no
  `{{payment_block}}`). Meta's docs (third-party summaries checked; Meta's own reference NOT VERIFIED here) describe
  URL buttons with one dynamic suffix appended to a fixed base URL. Options for the owner: (a) submit a new template
  with a URL button `PUBLIC_APP_URL/p/{{1}}`, (b) keep WhatsApp link-free (current), (c) a body variable, if Meta's
  rules allow it. Approved text was not edited and no link was dropped silently: WhatsApp reminders never had one.

**Consequences.** More rows in `public_links` (purged by the retention job, prompt 7). DECISIONS NEEDED: TTLs, reuse.
