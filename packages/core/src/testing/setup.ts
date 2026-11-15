// Point core at a throwaway database BEFORE config/client load, then migrate + seed.
// Runs for each test file: an in-memory Postgres (PGlite, docs/HOSTING.md), so
// every file starts from the same clean, seeded database and nothing is left on disk.
// Every setting a test depends on is pinned here, so `npm test` behaves the
// same whatever the developer's own .env switches on (real providers, live
// languages, the simulator off). Values already in the environment win over
// .env, so setting them before config loads is enough.
process.env.DATABASE_PATH = ':memory:';
process.env.DATABASE_URL = ''; // set-but-empty: .env cannot fill it in, and config reads it as unset
Object.assign(process.env, {
  GRADING_PROVIDER: 'mock',
  LLM_PROVIDER: 'off', // tests that need the assist install a stand-in with setLlmProvider
  STORAGE_PROVIDER: 'disk',
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

if (process.env.FTM_TEST_SNAPSHOT) {
  // The database was opened from the run's snapshot: migrated and seeded already.
  const { loadRegistries } = await import('../domain/registries');
  await loadRegistries();
} else {
  const { runMigrations } = await import('../db/migrate');
  await runMigrations();
  const { seed } = await import('../db/seed');
  await seed();
}

// Tests never reach the real Supabase project: bearer tokens are test tokens,
// and the shared test buyer exists up front like the old seeded demo buyer did.
const { setTokenVerifier } = await import('../auth/tokens');
const { testBuyer, testTokenVerifier } = await import('./fixtures');
setTokenVerifier(testTokenVerifier);
await testBuyer();

export {}; // a module: top-level await above
