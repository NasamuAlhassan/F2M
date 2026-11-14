import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db, sqlite } from './client';

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');

/**
 * Apply pending migrations. Drizzle changes a SQLite column by rebuilding the
 * table (create new → copy → drop old → rename), and dropping a table that
 * other rows point at fails while foreign keys are enforced. The PRAGMA lines
 * drizzle writes into the migration do nothing inside its transaction, so the
 * switch happens here, outside it — and every reference is checked before
 * enforcement comes back on, so a bad migration fails loudly instead of
 * leaving orphaned rows.
 */
export function runMigrations(): void {
  sqlite.pragma('foreign_keys = OFF');
  try {
    migrate(db, { migrationsFolder });
    const broken = sqlite.pragma('foreign_key_check') as unknown[];
    if (broken.length > 0) {
      throw new Error(`Migration left ${broken.length} broken foreign-key reference(s): ${JSON.stringify(broken.slice(0, 3))}`);
    }
  } finally {
    sqlite.pragma('foreign_keys = ON');
  }
}
