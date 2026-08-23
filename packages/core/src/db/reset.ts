import fs from 'node:fs';
import { config } from '../config';

// Delete the DB files BEFORE anything opens the database.
for (const suffix of ['', '-wal', '-shm']) {
  fs.rmSync(config.databasePath + suffix, { force: true });
}

const { runMigrations } = await import('./migrate');
runMigrations();
const { seed } = await import('./seed');
await seed();
console.log(`Database reset at ${config.databasePath}`);
