import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useT } from '../lib/i18n';

export interface PriceCheck {
  verdict: 'very_low' | 'low' | 'fair' | 'high' | 'very_high' | 'unknown';
  message: string;
  trendText: string;
  ageDays: number | null;
  estimate: { confidence: 'high' | 'medium' | 'low' | 'reference'; count: number } | null;
}

/** Wait for typing to pause, so every keystroke is not a request. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/**
 * "Is this a sensible price?" under a price box (D-053). The wording comes from
 * the server so the web, USSD and calls say the same thing. It advises; it
 * never blocks — the person decides.
 *
 * `price` is pesewas, per `unitCode` when one is given, else per kg. Pass null
 * to just show what the crop has been fetching.
 */
export function PriceHint({
  commodityCode,
  unitCode,
  regionCode,
  price,
  side,
}: {
  commodityCode: string;
  unitCode?: string | null;
  regionCode?: string | null;
  price: number | null;
  side: 'sell' | 'buy';
}) {
  const { t, code } = useT();
  const settled = useDebounced(price, 450);
  const { data } = useQuery({
    queryKey: ['price-check', commodityCode, unitCode ?? '', regionCode ?? '', settled ?? 0, side, code],
    queryFn: () => {
      const q = new URLSearchParams({ commodity: commodityCode, side, locale: code });
      if (unitCode) q.set('unit', unitCode);
      if (regionCode) q.set('regionCode', regionCode);
      if (settled && settled > 0) q.set('price', String(Math.round(settled)));
      return api<PriceCheck>(`/api/prices/check?${q}`);
    },
    enabled: Boolean(commodityCode),
    staleTime: 30_000,
    refetchInterval: 60_000, // the market moves while the form is open
    retry: false,
  });

  if (!data || data.verdict === 'unknown' && !data.message) return null;

  // Tone is a second channel; the sentence and the mark carry the meaning on their own.
  const tone =
    data.verdict === 'fair'
      ? { cls: 'bg-[var(--success-wash)] text-[var(--success)]', mark: '✓' }
      : data.verdict === 'unknown'
        ? { cls: 'bg-[var(--paper-deep)] text-[var(--ink-7)]', mark: 'i' }
        : data.verdict.startsWith('very')
          ? { cls: 'bg-[var(--stamp-wash)] text-[var(--stamp-deep)]', mark: '!' }
          : { cls: 'bg-[var(--gold-wash)] text-[var(--gold-ink)]', mark: '!' };

  return (
    <p role="status" aria-live="polite" className={`mt-2 flex items-start gap-2 rounded-xl px-3 py-2 text-xs leading-snug ${tone.cls}`}>
      <span aria-hidden="true" className="mt-px inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-current text-[10px] font-bold">
        {tone.mark}
      </span>
      <span>
        {data.message}
        {data.trendText ? ` ${data.trendText}.` : ''}
        {data.estimate?.confidence === 'reference' || data.estimate?.confidence === 'low'
          ? ` ${t('web.prices.hintThin', 'Based on very little recent data.')}`
          : ''}
      </span>
    </p>
  );
}
