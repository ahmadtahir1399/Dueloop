# Dueloop: invoice follow-up agent

Status: **Phase 1 of 7**: the pure domain core and a deterministic simulator. There is no
database, scheduler, channel adapter, classifier, payment integration or UI yet.

## What is here

- `packages/core`: domain types, the invoice state machine, `decide()` (what should happen next
  for one invoice), the send-window calculation, money helpers and port interfaces. It is pure:
  no I/O, no clock and no randomness. It may import only `luxon`, and lint enforces that.
- `packages/sim`: replays N days of synthetic invoices on a fake hourly clock across several
  tenants and time zones, applies `decide()` through the state machine, and fails if any
  invariant is broken (quiet hours, holidays, opt-outs, final/disputed invoices, duplicate
  idempotency keys, weekly cap, illegal transitions).
- `docs/decisions`: short architecture decision records.

## Requirements

Node.js >= 24.12 (LTS; `.nvmrc` says 24) and pnpm (the version is pinned in `package.json`
`packageManager`).

## Commands

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm sim --days 90 --invoices 500 --seed 42
```

Simulator options: `--days N --invoices N --seed N [--start <ISO UTC>] [--trace <invoiceId>] [--json]`.
The same arguments always produce byte-identical output. Exit code 0 means zero invariant
violations, 1 means at least one violation, and 2 means bad arguments.
