# 0004: Tooling versions and TypeScript runner

**Context.** Phase 1 asked for the current stable versions of each tool. On 2026-10-27 npm's
`typescript@latest` is 7.0.2, but the newest `typescript-eslint` (8.72.x) declares a peer range of
`typescript >=4.8.4 <6.1.0`.

**Decision.**
- TypeScript is pinned to **6.0.3**, the newest version typescript-eslint supports, so `pnpm lint`
  runs on a supported pair. Revisit when typescript-eslint supports TypeScript 7.
- The simulator runs on **Node's built-in type stripping** (`node packages/sim/src/cli.ts`).
  The Node docs mark it "Stability: 2 - Stable" since v24.12.0, and it needs no extra
  dependency. The code therefore uses only erasable syntax (`erasableSyntaxOnly`) and explicit
  `.ts` import extensions (`allowImportingTsExtensions`, with `noEmit`).
- No strictness flag from the brief was loosened. `noImplicitReturns`, `noUnusedLocals` and
  `noUnusedParameters` were added on top.

**Consequences.** `engines.node` is `>=24.12.0`. CI reads `.nvmrc` (24) and the pnpm version from
`packageManager`.
