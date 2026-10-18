import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Each file boots its own in-memory Postgres (PGlite), or with TEST_DATABASE_URL gets
    // its own copy of a migrated template on that server; isolate them in forks.
    pool: 'forks',
    globalSetup: ['src/test/global-setup.ts'],
  },
});
