import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { drizzle as drizzlePostgres, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../config';
import * as schema from './schema';

/**
 * The database (docs/HOSTING.md). One Postgres API, two engines:
 *
 * - `DATABASE_URL` set → Supabase Postgres through its transaction pooler
 *   (port 6543). The pooler cannot keep prepared statements, hence
 *   `prepare: false`; a serverless instance needs only a few connections.
 * - otherwise → PGlite, Postgres compiled to run in-process: a folder under
 *   `data/` for local dev, or memory (`DATABASE_PATH=:memory:`) for tests. No
 *   Docker, no cloud, works offline.
 *
 * Both are drizzle's Postgres builders, so the rest of the code sees one `db`.
 */
export type Db = PostgresJsDatabase<typeof schema>;

export type DbEngine = 'postgres' | 'pglite';

function connect(): { db: Db; engine: DbEngine; close: () => Promise<void>; pglite?: PGlite } {
  if (config.DATABASE_URL) {
    // One connection, one query in flight: parallel queries (the four registry
    // loads) hung the deploy, the extra connections never getting through the
    // pooler. Supabase advises max 1 for serverless anyway, and PGlite (local,
    // tests) is a single connection too, so the code already lives with it.
    // fetch_types off: no extra type-lookup query on connect.
    const client = postgres(config.DATABASE_URL, {
      prepare: false,
      max: 1,
      ...({ max_pipeline: 1 } as object), // a real postgres-js option its types leave out
      fetch_types: false,
      idle_timeout: 20,
      connect_timeout: 15,
    });
    return { db: drizzlePostgres(client, { schema }), engine: 'postgres', close: () => client.end() };
  }
  const inMemory = config.DATABASE_PATH === ':memory:';
  // An older .env may still point DATABASE_PATH at the SQLite file (data/ftm.db).
  // PGlite needs a folder, so use one beside it rather than fail.
  let dataDir = config.databasePath;
  if (!inMemory && fs.existsSync(dataDir) && fs.statSync(dataDir).isFile()) dataDir = `${dataDir.replace(/\.db$/, '')}-pglite`;
  if (!inMemory) fs.mkdirSync(dataDir, { recursive: true });
  // Tests: an in-memory copy of the run's migrated, seeded snapshot (testing/global-setup.ts).
  const snapshot = inMemory ? process.env.FTM_TEST_SNAPSHOT : undefined;
  const pglite = inMemory
    ? new PGlite(snapshot && fs.existsSync(snapshot) ? { loadDataDir: new Blob([fs.readFileSync(snapshot)]) } : undefined)
    : new PGlite(dataDir);
  // Same query builder at run time; the cast unifies the two drivers' result types.
  const db = drizzlePglite(pglite, { schema }) as unknown as Db;
  return { db, engine: 'pglite', close: () => pglite.close(), pglite };
}

const connection = connect();

/**
 * Queries inside a transaction must run ON that transaction. SQLite made this
 * free (one synchronous connection), so the code calls helpers that use `db`
 * from inside `db.transaction(...)`. On Postgres those would run on another
 * connection, outside the transaction (and on PGlite, which has one
 * connection, wait for it forever). So while a transaction is open in the
 * current async context, `db` IS that transaction, and a nested
 * `db.transaction()` joins it rather than opening a second one.
 */
const activeTx = new AsyncLocalStorage<Db>();

const routed = new Proxy(connection.db, {
  get(target, prop, receiver) {
    const tx = activeTx.getStore();
    if (prop === 'transaction') {
      return (fn: (t: Db) => Promise<unknown>, cfg?: unknown) =>
        tx ? fn(tx) : target.transaction((t) => activeTx.run(t as unknown as Db, () => fn(t as unknown as Db)), cfg as never);
    }
    const source = (tx ?? target) as unknown as Record<PropertyKey, unknown>;
    const value = Reflect.get(source, prop, tx ? source : receiver);
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(source) : value;
  },
}) as Db;

export const db: Db = routed;
export const dbEngine: DbEngine = connection.engine;
export const closeDb = connection.close;
/** The in-process engine, when there is one (migrations use its own migrator). */
export const pglite = connection.pglite;
