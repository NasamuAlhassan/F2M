import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiError } from '../api';
import { useT } from '../lib/i18n';
import { BusyLabel, btnGhostCls, fieldCls } from './ui';

export interface RequestFields {
  commodityCode?: string;
  unitCode?: string;
  unitQty?: number;
  quantityKg?: number;
  pricePerKgGhs?: number;
  minBand?: 'A' | 'B' | 'C';
  regionCode?: string;
  windowDays?: number;
}

/**
 * "Describe what you need" (D-056): the buyer types it the way they would say
 * it and the form below fills in. It only suggests — every field stays theirs to
 * check and change before they post — and it is not shown at all unless the
 * owner has switched the assist on.
 */
export function AiRequestBox({ onFields }: { onFields: (fields: RequestFields) => void }) {
  const { t } = useT();
  const [text, setText] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const { data: status } = useQuery({
    queryKey: ['ai-status'],
    queryFn: () => api<{ enabled: boolean }>('/api/ai/status'),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const read = useMutation({
    mutationFn: () => api<{ fields: RequestFields | null }>('/api/ai/parse-request', { method: 'POST', body: JSON.stringify({ text }) }),
    onSuccess: ({ fields }) => {
      if (!fields) {
        setNote(t('web.ai.nothing', 'We could not pick out the details. Please fill the form in by hand.'));
        return;
      }
      onFields(fields);
      setNote(t('web.ai.filled', 'We filled in what we could. Please check every field before you post.'));
    },
    onError: (e) => setNote(e instanceof ApiError ? e.message : t('web.ai.failed', 'That did not work. Please fill the form in by hand.')),
  });

  if (!status?.enabled) return null;

  return (
    <div className="rounded-2xl bg-[var(--paper-deep)] p-4">
      <label htmlFor="ai-request-text" className="smallcaps mb-1.5 block text-[var(--ink-6)]">
        {t('web.ai.label', 'Describe what you need')}
      </label>
      <textarea
        id="ai-request-text"
        className={`${fieldCls} min-h-20`}
        value={text}
        maxLength={600}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('web.ai.placeholder', 'For example: 5 tonnes of grade A tomatoes to Kumasi within 2 days, up to GHS 6 a kilo')}
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={btnGhostCls}
          disabled={text.trim().length < 3 || read.isPending}
          aria-busy={read.isPending || undefined}
          onClick={() => {
            setNote(null);
            read.mutate();
          }}
        >
          <BusyLabel busy={read.isPending} label={t('web.ai.fill', 'Fill the form for me')} busyLabel={t('web.ai.reading', 'Reading…')} />
        </button>
        <p role="status" aria-live="polite" className="text-xs text-[var(--ink-6)]">
          {note ?? t('web.ai.hint', 'A suggestion only. You check and post it.')}
        </p>
      </div>
    </div>
  );
}
