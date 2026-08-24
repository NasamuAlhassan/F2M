import { config } from '../config';
import dag from './catalogs/dag.json' with { type: 'json' };
import ee from './catalogs/ee.json' with { type: 'json' };
import en from './catalogs/en.json' with { type: 'json' };
import ha from './catalogs/ha.json' with { type: 'json' };
import kus from './catalogs/kus.json' with { type: 'json' };
import tw from './catalogs/tw.json' with { type: 'json' };

// One flat catalog per locale; missing keys fall back to English. Non-en
// catalogs are MACHINE-DRAFTED (Khaya MT) until a native speaker reviews one
// and sets its `_reviewed` metadata — the review gate (D-040) lives in t()
// itself, so an unreviewed catalog resolves to English on every real surface
// no matter what locale a farmer has chosen. Their choice is still persisted;
// review flips the language on retroactively with no code change.
const catalogs: Record<string, Record<string, string>> = { en, tw, ee, dag, ha, kus };

export const AVAILABLE_LOCALES = [
  { code: 'en', label: 'English', endonym: 'English' },
  { code: 'tw', label: 'Twi', endonym: 'Twi' },
  { code: 'ee', label: 'Ewe', endonym: 'Eʋegbe' },
  { code: 'dag', label: 'Dagbani', endonym: 'Dagbanli' },
  { code: 'ha', label: 'Hausa', endonym: 'Hausa' },
  { code: 'kus', label: 'Kusaal', endonym: 'Kʋsaal' },
] as const;

export type I18nText = { key: string; params?: Record<string, string | number> };

// Test hook state: null → follow config.I18N_DRAFT_LOCALES_LIVE (the owner's
// live-testing escape hatch, default off).
let draftLocalesLive: boolean | null = null;

function draftsLive(): boolean {
  return draftLocalesLive ?? config.draftLocalesLive;
}

/** English needs no review; any other locale is reviewed when its catalog says so. */
export function isLocaleReviewed(code: string): boolean {
  if (code === 'en') return true;
  return Boolean(catalogs[code]?.['_reviewed']);
}

/** Live = allowed on real farmer-facing surfaces: reviewed, or drafts explicitly let live. */
export function isLocaleLive(code: string): boolean {
  if (!catalogs[code]) return false;
  return isLocaleReviewed(code) || draftsLive();
}

export function liveLocales(): Array<{ code: string; label: string; endonym: string }> {
  return AVAILABLE_LOCALES.filter((l) => isLocaleLive(l.code)).map((l) => ({ ...l }));
}

/**
 * The locale a voice should actually speak. When the gate resolves a locale's
 * TEXT to English, the TTS voice must be English too — never English words in
 * a Twi voice.
 */
export function speechLocale(locale: string): string {
  return isLocaleLive(locale) ? locale : 'en';
}

function resolve(catalog: Record<string, string> | undefined, locale: string, key: string, params?: Record<string, string | number>): string {
  const template = catalog?.[key] ?? catalogs['en']?.[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}

/**
 * Resolve a message key for a locale. Falls back to English, then to the key
 * itself (a visible '[missing]' marker beats a crash on a farmer's phone).
 * This is the ONLY place catalog text is resolved — user-facing code passes
 * {key, params} around, never strings (D-012). GATED (D-040): a locale whose
 * catalog is not live resolves entirely from English.
 */
export function t(locale: string, key: string, params?: Record<string, string | number>): string {
  const catalog = isLocaleLive(locale) ? catalogs[locale] : catalogs['en'];
  return resolve(catalog, locale, key, params);
}

/**
 * Ungated resolution for PREVIEW surfaces only (the simulation drawer, locale
 * status endpoints). Never wire this into SMS, USSD, or IVR paths.
 */
export function tDraft(locale: string, key: string, params?: Record<string, string | number>): string {
  return resolve(catalogs[locale], locale, key, params);
}

export function resolveText(locale: string, text: I18nText): string {
  return t(locale, text.key, text.params);
}

export function hasKey(locale: string, key: string): boolean {
  return Boolean(catalogs[locale]?.[key] ?? catalogs['en']?.[key]);
}

/** Test hook — force drafts live (true/false) or return to config (null). */
export function setDraftLocalesLive(v: boolean | null): void {
  draftLocalesLive = v;
}
