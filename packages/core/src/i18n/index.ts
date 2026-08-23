import en from './catalogs/en.json' with { type: 'json' };

// One flat catalog per locale. Adding Twi later = add tw.json here + set farmers.locale.
const catalogs: Record<string, Record<string, string>> = { en };

export type I18nText = { key: string; params?: Record<string, string | number> };

/**
 * Resolve a message key for a locale. Falls back to English, then to the key
 * itself (a visible '[missing]' marker beats a crash on a farmer's phone).
 * This is the ONLY place catalog text is resolved — user-facing code passes
 * {key, params} around, never strings (D-012).
 */
export function t(locale: string, key: string, params?: Record<string, string | number>): string {
  const template = catalogs[locale]?.[key] ?? catalogs['en']?.[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}

export function resolveText(locale: string, text: I18nText): string {
  return t(locale, text.key, text.params);
}

export function hasKey(locale: string, key: string): boolean {
  return Boolean(catalogs[locale]?.[key] ?? catalogs['en']?.[key]);
}
