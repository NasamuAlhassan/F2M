// `npm run db:setup` — the deploy step (docs/HOSTING.md): apply pending
// migrations, then add any reference data the seed has and the database lacks.
// Insert-only: nothing that exists is changed. Vercel's server build runs this,
// so cold starts never migrate or seed.
import { closeDb } from './client';
import { runMigrations } from './migrate';

await runMigrations();
const { seed } = await import('./seed');
await seed({ refresh: false });
await closeDb();
