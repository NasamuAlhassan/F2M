/**
 * `npm run demo` — runs scripts/demo.ts against its OWN throwaway database and
 * photo folder, rebuilt from scratch every run, so the demo's sample farmer,
 * driver and buyer never land in the database real people use.
 *
 * These are set before anything imports @ftm/core, which reads its settings
 * once, on load. Providers still come from .env, so `GRADING_PROVIDER=hf npm
 * run demo` exercises a real provider exactly as before.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const dbPath = path.join(REPO_ROOT, 'data', 'demo-pglite'); // a PGlite folder (docs/HOSTING.md)
const storageDir = path.join(REPO_ROOT, 'data', 'demo-storage');

fs.rmSync(dbPath, { recursive: true, force: true });
fs.rmSync(storageDir, { recursive: true, force: true });
process.env.DATABASE_PATH = dbPath;
process.env.DATABASE_URL = ''; // never the real Supabase database, whatever .env says
process.env.STORAGE_DIR = storageDir;

const { runMigrations } = await import('../../../packages/core/src/db/migrate');
await runMigrations();
const { seed } = await import('../../../packages/core/src/db/seed');
await seed();
await import('./demo');
