import fs from 'node:fs';
import { config } from '../config';

// Wipe the LOCAL database (a PGlite folder) before anything opens it. Never
// touches a real database: with DATABASE_URL set, this refuses.
if (config.DATABASE_URL) {
  console.error('db:reset only resets the local PGlite database. Unset DATABASE_URL to use it.');
  process.exit(1);
}
fs.rmSync(config.databasePath, { recursive: true, force: true });

const { runMigrations } = await import('./migrate');
await runMigrations();
const { seed } = await import('./seed');
await seed();
console.log(`Database reset at ${config.databasePath}`);
