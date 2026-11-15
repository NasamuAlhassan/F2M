import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Each test worker makes its own throwaway database, data/test-<pid>.db
// (setup.ts). When a run ends, remove the ones whose process is gone, so
// `data/` doesn't grow by ~45 MB on every `npm test` — while a run still going
// in another terminal keeps its own (its workers are alive).
const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'data');

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = "does it exist?", sends nothing
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'; // exists, just not ours
  }
}

/**
 * Build one migrated, seeded database for the whole run and snapshot it
 * (docs/HOSTING.md): each test file then opens an in-memory copy in a fraction
 * of a second instead of migrating and seeding its own (45 files, ~5 s each).
 */
export async function setup(): Promise<void> {
  process.env.DATABASE_PATH = ':memory:';
  process.env.DATABASE_URL = '';
  // Same pins as setup.ts: building the snapshot must not depend on the developer's .env.
  Object.assign(process.env, { GRADING_PROVIDER: 'mock', LLM_PROVIDER: 'off', STORAGE_PROVIDER: 'disk' });
  const { runMigrations } = await import('../db/migrate');
  await runMigrations();
  const { seed } = await import('../db/seed');
  await seed();
  const { pglite } = await import('../db/client');
  const blob = await pglite!.dumpDataDir('none');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, `test-snapshot-${process.pid}.tar`);
  fs.writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
  process.env.FTM_TEST_SNAPSHOT = file; // inherited by the test workers, started after this
}

export function teardown(): void {
  if (process.env.FTM_TEST_SNAPSHOT) fs.rmSync(process.env.FTM_TEST_SNAPSHOT, { force: true });
  if (!fs.existsSync(DATA_DIR)) return;
  for (const name of fs.readdirSync(DATA_DIR)) {
    const m = /^test-(\d+)\.db(-wal|-shm)?$/.exec(name);
    if (!m || alive(Number(m[1]))) continue;
    try {
      fs.rmSync(path.join(DATA_DIR, name), { force: true });
    } catch {
      // still locked — the next run's teardown tries again
    }
  }
}
