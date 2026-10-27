import { defineConfig } from 'vitest/config';

// Integration tests against the REAL local Supabase stack (`pnpm db:start` first).
export default defineConfig({
  test: {
    include: ['packages/*/test-db/**/*.test.ts'],
    allowOnly: false,
    passWithNoTests: false,
    // Files share one database; run them one at a time.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
