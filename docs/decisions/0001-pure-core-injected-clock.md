# 0001: Pure core with an injected clock

**Context.** Collections rules (quiet hours, caps, promises, escalation) are where the product
can do harm: a message at 3 a.m., a second reminder for the same step, a message to someone who
opted out. These rules must be testable exhaustively and reproducibly, which a function that
reads the clock or talks to a database cannot be.

**Decision.** `packages/core` is pure. `decide(ctx)` gets everything as arguments, including
`now`, and returns a list of actions; it never sends, stores or schedules anything itself. The
state machine is the only code that changes an invoice's status. Core may import only `luxon`.
This is enforced by lint, not convention: `no-restricted-imports` plus a small local rule that
stops relative imports escaping `packages/core/src`, and bans on `new Date()`, `Date()`,
`Date.now`, `Math.random`, `DateTime.now/local`, `crypto` randomness and Node globals. Core's
tsconfig also has `types: []` and no DOM lib, so `process` and `console` do not type-check there.
A test lints fixture code to prove each rule fires.

**Consequences.** Every behaviour is a plain unit or property test. The simulator can replay
months in about a second, deterministically. Adapters (later prompts) must assemble the full
`Ctx` (history, settings, policy) before calling `decide()`, and must persist the actions it
returns. Expected outcomes are result objects, never thrown errors.
