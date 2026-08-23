// `npm run db:seed` — apply pending migrations, then (re)seed idempotently.
import { runMigrations } from './migrate';
runMigrations();
const { seed } = await import('./seed');
await seed();
