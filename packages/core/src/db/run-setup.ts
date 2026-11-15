// `npm run db:setup` — the deploy step (docs/HOSTING.md): apply pending
// migrations, then add any reference data the seed has and the database lacks.
// Insert-only: nothing that exists is changed. Vercel's server build runs this,
// so cold starts never migrate or seed.
//
// It exits explicitly: against Supabase's pooler an idle connection can keep the
// process alive after the work is done, and a build that never exits hangs
// until Vercel's 45-minute limit.
import { closeDb, dbEngine } from './client';
import { runMigrations } from './migrate';

const started = Date.now();
const step = (msg: string) => console.log(`[db:setup +${((Date.now() - started) / 1000).toFixed(1)}s] ${msg}`);

try {
  step(`engine: ${dbEngine}`);
  await runMigrations();
  step('migrations applied');
  const { seed } = await import('./seed');
  await seed({ refresh: false });
  step('reference data in place');
  // Don't let closing the connection hold the build either.
  await Promise.race([closeDb(), new Promise((r) => setTimeout(r, 5000))]);
  step('done');
  process.exit(0);
} catch (err) {
  console.error('[db:setup] failed:', err);
  process.exit(1);
}
