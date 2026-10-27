# 0011: Type-checking packages that use supabase-js

**Context.** `@supabase/supabase-js` 2.118 (via `@supabase/auth-js`) ships declaration files that refer to
DOM types (`BroadcastChannel`, WebAuthn types). With only the `ES2023` lib, they fail to resolve. With the
`DOM` lib from TypeScript 6.0.3, its `webauthn.dom.d.ts` conflicts with the built-in
`PublicKeyCredential` (TS2430). Both errors are inside the library's `.d.ts` files, not in our code.

**Decision.** Only for `packages/db` and `packages/ingest`, the two packages that import supabase-js:
- add `"DOM"` to `lib`, so the library's types resolve;
- set `"skipLibCheck": true`, which skips checking third-party `.d.ts` files. All of our own `.ts` files
  remain fully checked with every strict flag from the base config.

`packages/core` and `packages/sim` keep the strict base: no DOM lib, `skipLibCheck: false`, and core still
has `types: []`.

**Consequences.** A real type error inside a dependency's declarations would go unnoticed in these two
packages. Revisit when auth-js and the TypeScript DOM lib agree: remove `skipLibCheck` and run
`pnpm typecheck`.
