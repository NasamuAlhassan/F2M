import fs from 'node:fs';

// Point core at a throwaway DB BEFORE config/client load, then migrate + seed.
// Runs once per vitest worker (singleFork keeps DB-backed suites serialized).
// Every setting a test depends on is pinned here, so `npm test` behaves the
// same whatever the developer's own .env switches on (real providers, live
// languages, the simulator off). Values already in the environment win over
// .env, so setting them before config loads is enough.
process.env.DATABASE_PATH = `data/test-${process.pid}.db`;
Object.assign(process.env, {
  GRADING_PROVIDER: 'mock',
  PAYMENT_PROVIDER: 'mock',
  NOTIFY_PROVIDER: 'mock',
  VOICE_PROVIDER: 'mock',
  ASR_PROVIDER: 'mock',
  MT_PROVIDER: 'mock',
  TTS_PROVIDER: 'mock',
  I18N_DRAFT_LOCALES_LIVE: 'false',
  SIMULATOR_ENABLED: 'true',
  PUBLIC_BASE_URL: 'http://localhost:3000',
});

const { config } = await import('../config');
for (const suffix of ['', '-wal', '-shm']) {
  fs.rmSync(config.databasePath + suffix, { force: true });
}

const { runMigrations } = await import('../db/migrate');
runMigrations();
const { seed } = await import('../db/seed');
await seed();

// Tests never reach the real Supabase project: bearer tokens are test tokens,
// and the shared test buyer exists up front like the old seeded demo buyer did.
const { setTokenVerifier } = await import('../auth/tokens');
const { testBuyer, testTokenVerifier } = await import('./fixtures');
setTokenVerifier(testTokenVerifier);
testBuyer();
