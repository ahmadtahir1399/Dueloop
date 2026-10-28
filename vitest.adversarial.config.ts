import { defineConfig } from 'vitest/config';

// pnpm test:adversarial: injection + spoofing (+ webhook abuse) against the REAL local stack.
export default defineConfig({
  test: {
    include: ['packages/*/test-adversarial/**/*.test.ts'],
    allowOnly: false,
    passWithNoTests: false,
    // Files share one database; run them one at a time.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
