import { useQuery } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * The web interface in the person's own language (D-050).
 *
 * Write every phrase a person reads as `t('web.<page>.<name>', 'English text')`
 * — the English is the source of truth AND the fallback, so a page renders
 * correctly before any translation exists. `npm run i18n:extract` collects the
 * keys into the language catalogs and `npm run i18n:draft` translates them
 * with the language Space. Placeholders work like the SMS templates:
 * `t('web.lots.left', '{kg}kg left', { kg: 40 })`.
 *
 * Leave out what should not change with the language: names, lot codes,
 * amounts, phone numbers, crop photos' alt text that names a person.
 */

export interface UiLanguage {
  code: string;
  setCode: (code: string) => void;
  t: (key: string, english: string, params?: Record<string, string | number>) => string;
}

const STORAGE_KEY = 'ftm_ui_lang';

function initialCode(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? 'en';
  } catch {
    return 'en';
  }
}

function fill(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (params[name] === undefined ? whole : String(params[name])));
}

const english: UiLanguage = { code: 'en', setCode: () => undefined, t: (_key, en, params) => fill(en, params) };
const Ctx = createContext<UiLanguage>(english);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [code, setCodeState] = useState(initialCode);
  const setCode = useCallback((next: string) => {
    setCodeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private windows: the choice lasts for this visit only.
    }
  }, []);

  // English needs no fetch — the phrases in the code are the English.
  const { data } = useQuery({
    queryKey: ['web-messages', code],
    queryFn: async () => {
      const res = await fetch(`/api/i18n/web/${encodeURIComponent(code)}`);
      if (!res.ok) throw new Error(`Could not load the ${code} phrases (${res.status})`);
      return (await res.json()) as { locale: string; messages: Record<string, string> };
    },
    enabled: code !== 'en',
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    document.documentElement.lang = code;
  }, [code]);

  const value = useMemo<UiLanguage>(() => {
    const messages = code !== 'en' ? data?.messages : undefined;
    return { code, setCode, t: (key, en, params) => fill(messages?.[key] ?? en, params) };
  }, [code, setCode, data]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The current language and its translator. */
export function useT(): UiLanguage {
  return useContext(Ctx);
}
