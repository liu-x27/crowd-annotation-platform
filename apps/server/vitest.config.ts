import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Each file boots its own in-memory Postgres (PGlite); isolate them in forks.
    pool: 'forks',
  },
});
