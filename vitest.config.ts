import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/server/**/*.test.ts'],
    setupFiles: ['./packages/core/src/testing/setup.ts'],
    // DB-backed tests share one SQLite file per worker; keep a single worker so
    // suites don't race on the same database.
    pool: 'forks',
    maxWorkers: 1,
    minWorkers: 1,
  },
});
