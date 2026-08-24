/**
 * Khaya AI (GhanaNLP) language-code mapping. Our locale codes are passed to
 * three Khaya endpoints (MT, ASR, TTS); this table is the single translation
 * point so an internal code that differs from Khaya's (or a language Khaya
 * does not carry yet — Kusaal today) fails loudly instead of silently sending
 * a code the API misreads. GhanaNLP's published set: tw, gaa, dag, ee, ki,
 * gur, yo, ha; kus stays unmapped until they add it.
 */
export const LOCALE_TO_KHAYA: Record<string, string | undefined> = {
  en: 'en',
  tw: 'tw',
  ee: 'ee',
  dag: 'dag',
  ha: 'ha',
  kus: undefined,
};

export function khayaLang(locale: string): string {
  const code = LOCALE_TO_KHAYA[locale];
  if (!code) throw new Error(`Khaya AI has no language code for locale '${locale}'`);
  return code;
}

/** English names for prompting LLM translators (D-041) — every locale has one. */
export const LOCALE_ENGLISH_NAME: Record<string, string> = {
  en: 'English',
  tw: 'Twi (Akan, Ghana)',
  ee: 'Ewe (Ghana/Togo)',
  dag: 'Dagbani (northern Ghana)',
  ha: 'Hausa',
  kus: 'Kusaal (Kusasi, north-eastern Ghana)',
};
