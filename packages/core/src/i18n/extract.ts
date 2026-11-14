/**
 * `npm run i18n:extract` — collect the web interface's phrases (D-050).
 *
 * Scans apps/web/src for `t('web.<key>', 'English text', …)` and makes en.json
 * match: new keys are added, changed English replaces the old (and the stale
 * translations of that key are removed from every other catalog, so the next
 * `npm run i18n:draft` translates the new wording), and `web.*` keys no
 * longer used anywhere are removed everywhere. Non-web keys (SMS, USSD,
 * voice) are never touched.
 *
 * Only plain string literals are collected; a phrase built at runtime is a
 * bug the report below points at.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AVAILABLE_LOCALES } from './index';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_DIR = path.join(HERE, 'catalogs');
const WEB_SRC = path.resolve(HERE, '..', '..', '..', '..', 'apps', 'web', 'src');

const CALL = /\bt\(\s*(['"])(web\.[\w.-]+)\1\s*,\s*(['"])((?:\\.|(?!\3)[^\\])*)\3/g;
// A web key whose English is NOT a plain literal (a variable, a template string…).
const ANY_WEB_KEY = /\bt\(\s*(['"])(web\.[\w.-]+)\1\s*,\s*(?!['"\s])/g;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return /\.(tsx?|jsx?)$/.test(e.name) ? [full] : [];
  });
}

const unescape = (s: string) => s.replace(/\\(['"\\])/g, '$1').replace(/\\n/g, '\n');

const found = new Map<string, { text: string; where: string }>();
const conflicts: string[] = [];
const dynamic: string[] = [];
for (const file of walk(WEB_SRC)) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(WEB_SRC, file);
  for (const m of src.matchAll(CALL)) {
    const key = m[2]!;
    const text = unescape(m[4]!);
    const prior = found.get(key);
    if (prior && prior.text !== text) conflicts.push(`${key}: "${prior.text}" (${prior.where}) vs "${text}" (${rel})`);
    else found.set(key, { text, where: rel });
  }
  for (const m of src.matchAll(ANY_WEB_KEY)) dynamic.push(`${m[2]} in ${rel} — the English must be a plain string literal`);
}

if (conflicts.length > 0) {
  console.error('One key, two different English texts — give each its own key:\n  ' + conflicts.join('\n  '));
  process.exit(1);
}

const load = (code: string): Record<string, string> => JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, `${code}.json`), 'utf8'));
const save = (code: string, data: Record<string, string>) =>
  fs.writeFileSync(path.join(CATALOG_DIR, `${code}.json`), JSON.stringify(data, null, 2) + '\n', 'utf8');

const en = load('en');
let added = 0;
let changed = 0;
let removed = 0;
const stale = new Set<string>();
for (const [key, { text }] of found) {
  if (en[key] === undefined) added++;
  else if (en[key] !== text) {
    changed++;
    stale.add(key);
  }
  en[key] = text;
}
for (const key of Object.keys(en)) {
  if (key.startsWith('web.') && !found.has(key)) {
    delete en[key];
    stale.add(key);
    removed++;
  }
}
save('en', en);

for (const { code } of AVAILABLE_LOCALES.filter((l) => l.code !== 'en')) {
  const catalog = load(code);
  let dropped = 0;
  for (const key of stale) {
    if (catalog[key] !== undefined) {
      delete catalog[key];
      dropped++;
    }
  }
  if (dropped > 0) save(code, catalog);
}

console.log(`web phrases: ${found.size} in use · ${added} new · ${changed} changed · ${removed} removed`);
if (dynamic.length > 0) console.log(`not collected (built at runtime):\n  ${dynamic.join('\n  ')}`);
if (added + changed > 0) console.log('Next: npm run i18n:draft — translates the new and changed phrases with the language Space.');
