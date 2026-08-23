import type { I18nText } from '@ftm/core';

export const PAGE_SIZE = 6;

export function paginate<T>(items: T[], page: number): { pageItems: T[]; hasMore: boolean; start: number } {
  const start = page * PAGE_SIZE;
  return { pageItems: items.slice(start, start + PAGE_SIZE), hasMore: start + PAGE_SIZE < items.length, start };
}

/** Numbered list lines + optional More/Back footer. */
export function listLines(labels: string[], opts: { hasMore: boolean; back?: boolean }): I18nText[] {
  const lines: I18nText[] = labels.map((label, i) => ({ key: 'ussd.listItem', params: { n: i + 1, label } }));
  if (opts.hasMore) lines.push({ key: 'ussd.common.more' });
  if (opts.back !== false) lines.push({ key: 'ussd.common.back' });
  return lines;
}

export function invalid(): { error: I18nText } {
  return { error: { key: 'ussd.common.invalid' } };
}

/** Parse a 1-based list selection against the current page; returns the absolute index. */
export function parseSelection(input: string, pageItemCount: number, start: number): number | null {
  const n = Number(input);
  if (!Number.isInteger(n) || n < 1 || n > pageItemCount) return null;
  return start + n - 1;
}

export const DAY_MS = 24 * 60 * 60 * 1000;
