import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    // .only must never sneak into a green run, locally or in CI.
    allowOnly: false,
    passWithNoTests: false,
  },
});
