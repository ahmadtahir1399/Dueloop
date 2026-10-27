# Dueloop: invoice follow-up agent

Status: **Phase 2 of 7**: the pure domain core and simulator (phase 1), plus the database (schema,
integrity rules, Row Level Security) and the CSV import pipeline. There is no scheduler, channel adapter,
classifier, payment integration or UI yet.

## What is here

- `packages/core`: domain types, the invoice state machine, `decide()`, the send-window calculation, money
  helpers and port interfaces. Pure; may import only `luxon` (lint-enforced).
- `packages/sim`: deterministic simulator with an invariant checker.
- `packages/db`: generated database types, pure row -> core mappers, `rls-check` and `db-types` scripts.
- `packages/ingest`: CSV validation (pure), staging and commit through the database, and the import CLI.
- `supabase/`: migrations, the demo seed, and pgTAP tests.
- `docs/decisions`: architecture decision records.

## Requirements

- Node.js >= 24.12 (`.nvmrc`) and pnpm (pinned in `package.json` `packageManager`).
- Docker, running. The Supabase CLI is a dev dependency, so `pnpm exec supabase` is always the pinned
  version.

## Commands

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm sim --days 90 --invoices 500 --seed 42
```

Local database:

```bash
pnpm db:start
pnpm db:reset
pnpm db:test
pnpm db:rls-check
pnpm db:types:check
```

- `pnpm db:start` starts the stack (Postgres, Auth, PostgREST) and applies migrations and seed.
- `pnpm db:reset` re-applies every migration and the seed from empty.
- `pnpm db:test` runs the pgTAP suite, then the integration tests against the real database.
- `pnpm db:rls-check` fails if any public table lacks RLS.
- `pnpm db:types:check` fails if `packages/db/src/database.types.ts` is stale (`pnpm db:types` regenerates it).

The demo seed creates "Demo Agency" (40 invoices, 12 overdue) with tenant id
`5eed0000-0000-4000-8000-00000000000a`, and an isolated second tenant.

## Importing invoices

The CLI uses the service role and reads it from the environment only. Export the local values first (they
are printed by `supabase status`; never commit them):

```bash
eval "$(pnpm exec supabase status -o env | grep -E '^(API_URL|SERVICE_ROLE_KEY)=' | sed -E 's/^API_URL=/export SUPABASE_URL=/; s/^SERVICE_ROLE_KEY=/export SUPABASE_SERVICE_ROLE_KEY=/')"
```

```bash
pnpm run import --tenant 5eed0000-0000-4000-8000-00000000000a --file packages/ingest/fixtures/messy-eu.csv --mapping packages/ingest/fixtures/mappings/eu.json --options packages/ingest/fixtures/options/de-dmy.json --skip-invalid --dry-run
```

- Use `pnpm run import`, not `pnpm import`: `import` is a built-in pnpm command.
- Drop `--dry-run` to commit. Add `--error-report out.csv` for a spreadsheet-safe report of every row with
  errors or warnings.
- `pnpm import:twice <same args>` imports twice and fails unless the second run changes nothing.
- Mapping and options formats are in `packages/ingest/src/types.ts`; see the files in
  `packages/ingest/fixtures/mappings` and `options`.
