import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Each test worker makes its own throwaway database (setup.ts). Remove them
// when the run ends, so `data/` doesn't grow by ~45 MB on every `npm test`.
const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'data');

export function teardown(): void {
  if (!fs.existsSync(DATA_DIR)) return;
  for (const name of fs.readdirSync(DATA_DIR)) {
    if (/^test-\d+\.db(-wal|-shm)?$/.test(name)) fs.rmSync(path.join(DATA_DIR, name), { force: true });
  }
}
