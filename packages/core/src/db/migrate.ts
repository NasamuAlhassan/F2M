import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, dbEngine } from './client';

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');

/**
 * Apply pending migrations (Postgres: Supabase or PGlite). On Vercel this runs
 * in the build, not on each cold start (docs/HOSTING.md); locally and in
 * tests it runs at start.
 */
export async function runMigrations(): Promise<void> {
  if (dbEngine === 'pglite') {
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    await migrate(db as never, { migrationsFolder });
  } else {
    const { migrate } = await import('drizzle-orm/postgres-js/migrator');
    await migrate(db, { migrationsFolder });
  }
}
