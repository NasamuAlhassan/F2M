/**
 * Placeholder protection for machine-drafting catalogs (D-040). `{param}`
 * tokens must survive an MT round-trip verbatim; braces usually don't, so each
 * placeholder is masked as a bare five-digit numeral (numerals pass through MT
 * untouched far more reliably than markup), translated, then restored. A
 * translation that loses or duplicates any sentinel is rejected (null) — the
 * caller retries with the alternate sentinel family, then drops the key, which
 * safely falls back to English at runtime.
 */

const SENTINEL_FAMILIES = [70901, 84101];

export interface MaskedTemplate {
  masked: string;
  tokens: Array<{ sentinel: string; param: string }>;
}

export function protectPlaceholders(template: string, family = 0): MaskedTemplate {
  const base = SENTINEL_FAMILIES[family % SENTINEL_FAMILIES.length]!;
  const tokens: Array<{ sentinel: string; param: string }> = [];
  const masked = template.replace(/\{(\w+)\}/g, (_whole, param: string) => {
    const sentinel = String(base + tokens.length);
    tokens.push({ sentinel, param });
    return sentinel;
  });
  return { masked, tokens };
}

export function restorePlaceholders(translated: string, tokens: MaskedTemplate['tokens']): string | null {
  let out = translated;
  for (const { sentinel, param } of tokens) {
    const matches = out.split(sentinel).length - 1;
    if (matches !== 1) return null; // lost or duplicated in translation
    out = out.replace(sentinel, `{${param}}`);
  }
  return out;
}

/** A template that is nothing but placeholders and punctuation ("{n}. {label}") — copy, never translate. */
export function isPurePlaceholder(template: string): boolean {
  return !/[a-zA-Z]/.test(template.replace(/\{\w+\}/g, ''));
}
