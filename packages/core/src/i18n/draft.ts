/**
 * Machine-draft the i18n catalogs from English via Khaya AI MT (D-040).
 *
 *   npm run i18n:draft                      # all non-en locales, missing keys only
 *   npm run i18n:draft -- --locale tw,ee    # specific locales
 *   npm run i18n:draft -- --all             # redraft keys already present too
 *
 * Requires KHAYA_API_KEY in .env (MT_PROVIDER may stay mock — the provider is
 * instantiated directly). Every drafted catalog stays behind the review gate:
 * `_reviewed` is preserved (or ""), so nothing here reaches a farmer until a
 * native speaker signs off. Placeholders are masked as numeral sentinels for
 * the round-trip; keys whose placeholders don't survive two attempts are
 * DROPPED and reported — at runtime they fall back to English, safely.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config';
import { LOCALE_TO_KHAYA } from '../providers/khaya';
import { HfMtProvider, KhayaMtProvider, type MtProvider } from '../providers/mt/index';
import { AVAILABLE_LOCALES } from './index';
import { isPurePlaceholder, protectPlaceholders, restorePlaceholders } from './draftPlaceholders';

const CATALOG_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'catalogs');

function parseArgs(): { locales: string[]; all: boolean } {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const localeIdx = args.indexOf('--locale');
  const requested =
    localeIdx >= 0 && args[localeIdx + 1]
      ? args[localeIdx + 1]!.split(',').map((s) => s.trim())
      : AVAILABLE_LOCALES.filter((l) => l.code !== 'en').map((l) => l.code);
  for (const code of requested) {
    if (!AVAILABLE_LOCALES.some((l) => l.code === code) || code === 'en') {
      console.error(`Unknown target locale: ${code}`);
      process.exit(1);
    }
  }
  return { locales: requested, all };
}

function loadCatalog(code: string): Record<string, string> {
  const file = path.join(CATALOG_DIR, `${code}.json`);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>) : {};
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function translateWithRetry(mt: MtProvider, text: string, to: string): Promise<string> {
  try {
    return await mt.translate({ text, from: 'en', to });
  } catch (err) {
    if (err instanceof Error && err.message.includes('429')) {
      await sleep(2000);
      return mt.translate({ text, from: 'en', to });
    }
    throw err;
  }
}

// MT_PROVIDER picks the engine: 'hf' = LLM translation via the HF router
// (D-041, e.g. `MT_PROVIDER=hf npm run i18n:draft`); anything else = Khaya.
const useHf = config.MT_PROVIDER === 'hf';
if (useHf && !config.HF_TOKEN) {
  console.error('MT_PROVIDER=hf needs HF_TOKEN in .env.');
  process.exit(1);
}
if (!useHf && !config.KHAYA_API_KEY) {
  console.error('KHAYA_API_KEY is not set — add it to .env (GhanaNLP grants keys free at https://ghananlp.org).');
  process.exit(1);
}

const { locales, all } = parseArgs();
const mt: MtProvider = useHf ? new HfMtProvider() : new KhayaMtProvider();
const engine = useHf ? `hf:${config.MT_MODEL}` : 'khaya-mt';
const en = loadCatalog('en');
const enKeys = Object.keys(en).filter((k) => !k.startsWith('_'));

for (const code of locales) {
  const label = AVAILABLE_LOCALES.find((l) => l.code === code)!.label;
  console.log(`\n── ${label} (${code}) ──`);

  if (!useHf && !LOCALE_TO_KHAYA[code]) {
    console.log(`  UNSUPPORTED: Khaya AI has no language code for '${code}' yet — catalog untouched, English fallback stands.`);
    continue;
  }

  // Probe: one live sentence proves the language pair AND the response parser.
  let probe: string;
  try {
    probe = await translateWithRetry(mt, 'Thank you for selling on Farm to Market.', code);
  } catch (err) {
    console.log(`  UNSUPPORTED: probe failed (${err instanceof Error ? err.message : err}) — catalog untouched.`);
    continue;
  }
  if (!probe.trim() || probe.includes('[object Object]')) {
    console.log(`  UNSUPPORTED: probe returned garbage (${JSON.stringify(probe.slice(0, 60))}) — catalog untouched.`);
    continue;
  }

  const existing = loadCatalog(code);
  const out: Record<string, string> = {
    _note: `${label} — machine-drafted from en.json (${engine}). Native-speaker review required before farmer-facing use (D-040): set _reviewed when signed off.`,
    _machineDrafted: `${new Date().toISOString().slice(0, 10)} ${engine}`,
    _reviewed: existing['_reviewed'] ?? '',
  };
  let drafted = 0;
  let kept = 0;
  let copied = 0;
  const dropped: string[] = [];

  for (const key of enKeys) {
    const template = en[key]!;
    if (!all && existing[key] !== undefined) {
      out[key] = existing[key]!; // preserve hand fixes and prior drafts
      kept++;
      continue;
    }
    // Proper nouns and pure-placeholder templates are copied, never translated.
    if (key.startsWith('region.') || isPurePlaceholder(template)) {
      out[key] = template;
      copied++;
      continue;
    }
    let restored: string | null = null;
    for (let family = 0; family < 2 && restored === null; family++) {
      const { masked, tokens } = protectPlaceholders(template, family);
      try {
        const translated = await translateWithRetry(mt, masked, code);
        restored = restorePlaceholders(translated, tokens);
      } catch (err) {
        console.log(`  error on ${key}: ${err instanceof Error ? err.message : err}`);
        break;
      }
      await sleep(300); // stay polite to the free API
    }
    if (restored === null) {
      dropped.push(key); // runtime falls back to English — safe by construction
    } else {
      out[key] = restored;
      drafted++;
    }
  }

  fs.writeFileSync(path.join(CATALOG_DIR, `${code}.json`), JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`  drafted ${drafted} · kept ${kept} · copied ${copied} · dropped ${dropped.length} of ${enKeys.length}`);
  if (dropped.length > 0) console.log(`  dropped (English fallback at runtime): ${dropped.join(', ')}`);
}

console.log('\nDone. Drafted catalogs remain gated (_reviewed: "") until native review flips them live.');
