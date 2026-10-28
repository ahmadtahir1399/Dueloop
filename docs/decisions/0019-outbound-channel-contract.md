# 0019: OutboundChannel: a four-way send outcome outside core

**Context.** Core's `MessageChannel.send` returns `{ ok, retryable }`, which cannot express "we do not know
whether it was sent" (issue K). Prompt 3 runs with decisions = none yet, so core does not change.

**Decision.** `packages/messaging` defines the send-only `OutboundChannel`, with
`SendOutcome = sent | not_sent_retryable | permanent | ambiguous`. Adapters must never throw. The worker
also treats a throw, or its own hard timeout, as ambiguous. `OutboundEnvelope` carries the tenant's
non-secret channel-account config; secrets are passed separately and read from Vault at send time.

**Consequences.** Core's `MessageChannel` (including `parseWebhook`) stays for Prompt 4's inbound side.
The two interfaces should be reconciled the next time core is allowed to change.
