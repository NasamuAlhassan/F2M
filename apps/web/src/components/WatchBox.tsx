import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiError, ghs } from '../api';
import { useT } from '../lib/i18n';
import { useAccount } from '../lib/session';
import { BusyLabel, btnCls, Field, inputCls, toast } from './ui';

type Kind = 'listing' | 'price_above' | 'price_below';
interface Watch {
  id: string;
  commodityCode: string;
  commodityName: string;
  kind: Kind;
  thresholdPerKg: number;
  regionCode: string | null;
}

/**
 * "Tell me when…" for one crop (D-055). A buyer hears in the app; a farmer by SMS
 * in her own language. The same three questions for both, worded for what each
 * side cares about.
 */
export function WatchBox({ commodityCode, commodityName }: { commodityCode: string; commodityName: string }) {
  const { t } = useT();
  const { account } = useAccount();
  const queryClient = useQueryClient();
  const role = account?.role;
  const [kind, setKind] = useState<Kind>('price_above');
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ['watches'],
    queryFn: () => api<{ watches: Watch[] }>('/api/watches'),
    enabled: role === 'buyer' || role === 'farmer',
  });

  const save = useMutation({
    mutationFn: () => api('/api/watches', { method: 'POST', body: JSON.stringify({ commodityCode, kind, ghsPerKg: Number(price) }) }),
    onSuccess: () => {
      setPrice('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['watches'] });
      toast(
        role === 'farmer'
          ? t('web.alerts.savedFarmer', 'Saved. We will text you.')
          : t('web.alerts.savedBuyer', 'Saved. You will see it under your alerts.'),
      );
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('web.alerts.failed', 'Could not save that. Try again.')),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/watches/${id}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['watches'] }),
  });

  if (role !== 'buyer' && role !== 'farmer') {
    return <p className="p-4 text-xs text-[var(--ink-6)]">{t('web.alerts.signIn', 'Sign in as a buyer or farmer to set alerts.')}</p>;
  }
  const mine = (data?.watches ?? []).filter((w) => w.commodityCode === commodityCode);
  const kindText: Record<Kind, string> =
    role === 'buyer'
      ? {
          price_above: t('web.alerts.buyAbove', 'The price goes above'),
          price_below: t('web.alerts.buyBelow', 'The price drops below'),
          listing: t('web.alerts.buyListing', 'Someone lists it at or under'),
        }
      : {
          price_above: t('web.alerts.sellAbove', 'The price goes above'),
          price_below: t('web.alerts.sellBelow', 'The price drops below'),
          listing: t('web.alerts.sellRequest', 'A buyer asks for it at or over'),
        };
  const valid = Number(price) > 0 && Number(price) <= 1000;

  return (
    <div className="space-y-3 p-4">
      <p className="text-xs text-[var(--ink-6)]">{t('web.alerts.intro', 'Tell me about {crop} when…', { crop: commodityName.toLowerCase() })}</p>
      <Field label={t('web.alerts.when', 'When')}>
        <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
          {(['price_above', 'price_below', 'listing'] as const).map((k) => (
            <option key={k} value={k}>
              {kindText[k]}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('web.alerts.line', 'Price per kg (GHS)')}>
        <input className={inputCls} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/\s+/g, ''))} placeholder="0.00" />
      </Field>
      {error && (
        <p role="alert" className="text-xs text-[var(--stamp-deep)]">
          {error}
        </p>
      )}
      <button type="button" className={btnCls} disabled={!valid || save.isPending} aria-busy={save.isPending || undefined} onClick={() => save.mutate()}>
        <BusyLabel busy={save.isPending} label={t('web.alerts.save', 'Alert me')} busyLabel={t('web.alerts.saving', 'Saving…')} />
      </button>

      {mine.length > 0 && (
        <ul className="m-0 list-none space-y-1.5 p-0 pt-1">
          {mine.map((w) => (
            <li key={w.id} className="flex items-center justify-between gap-2 rounded-lg bg-[var(--paper-deep)] px-3 py-2 text-xs">
              <span>
                {kindText[w.kind]} <span className="serial font-semibold">{ghs(w.thresholdPerKg)}</span>
              </span>
              <button
                type="button"
                className="smallcaps min-h-8 px-2 text-[var(--stamp-deep)] hover:underline"
                onClick={() => remove.mutate(w.id)}
                aria-label={t('web.alerts.removeLabel', 'Remove this alert')}
              >
                {t('web.alerts.remove', 'Remove')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
