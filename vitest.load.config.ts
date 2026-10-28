import { defineConfig } from 'vitest/config';

// pnpm test:load: the 5,000-invoice load test against the REAL local stack. Slow; not part of CI.
export default defineConfig({
  test: {
    include: ['packages/*/test-load/**/*.test.ts'],
    allowOnly: false,
    passWithNoTests: false,
    // Files share one database; run them one at a time.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
