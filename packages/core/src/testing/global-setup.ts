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

export function teardown(): void {
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
