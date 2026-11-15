// `npm run db:seed` — apply pending migrations, then (re)seed idempotently.
import { runMigrations } from './migrate';
await runMigrations();
const { seed } = await import('./seed');
await seed();
