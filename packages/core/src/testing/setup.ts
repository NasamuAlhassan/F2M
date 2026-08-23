import fs from 'node:fs';

// Point core at a throwaway DB BEFORE config/client load, then migrate + seed.
// Runs once per vitest worker (singleFork keeps DB-backed suites serialized).
process.env.DATABASE_PATH = `data/test-${process.pid}.db`;
process.env.GRADING_PROVIDER = 'mock';
process.env.PAYMENT_PROVIDER = 'mock';

const { config } = await import('../config');
for (const suffix of ['', '-wal', '-shm']) {
  fs.rmSync(config.databasePath + suffix, { force: true });
}

const { runMigrations } = await import('../db/migrate');
runMigrations();
const { seed } = await import('../db/seed');
await seed();
