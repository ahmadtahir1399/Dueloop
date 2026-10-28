# 0026: Spoofing stance (issue J)

**Context.** An email's From header is trivially forged. WhatsApp numbers are verified by Meta.

**Decision.** A sender is *trusted* when the reply threads to one of OUR outbound Message-IDs for the same
customer (`matched_by = thread`), or when it arrives on WhatsApp. Only a trusted sender gets auto-effects:

| Intent | Trusted sender | Spoofable sender (email, no thread match) |
|---|---|---|
| promise_to_pay | `promised` + promise row (if clear and legal) | `review_promise` task (`unverified_sender`) |
| dispute | `disputed` + task + instant alert | `dispute` task only (`unverified_sender`) |
| already_paid | verification task + 3-day reminder pause | verification task, no pause |
| needs_info | info task + pause | info task, no pause |
| opt_out | honoured | honoured (it only reduces messaging) |

Unknown senders (no customer resolves) produce an `unmatched_inbound` task and no effects, not even an
opt-out, because the opt-out would resolve to no one.

**Consequences.** A forger can create work (a task) but cannot change an invoice, pause reminders or close
anything. Covered by the adversarial suite (c). The thread requirement depends on our Message-ID format
(`messageIdFor`, prompt 3) and on mail clients keeping In-Reply-To/References, which most do.
