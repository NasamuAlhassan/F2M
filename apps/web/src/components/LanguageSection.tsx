import { useQuery } from '@tanstack/react-query';
import { api, type LocaleInfo } from '../api';

/**
 * The SMS & call language picker (D-040), shared by the farmer dashboard and
 * the driver profile card. Each language names itself (endonym); locales still
 * awaiting native review stay visibly present but disabled — the D-029
 * convention, carried into the Trade Instrument world.
 */
export function LanguageSection({ current, saving, onPick }: { current: string; saving: boolean; onPick: (code: string) => void }) {
  const { data } = useQuery({
    queryKey: ['locales'],
    queryFn: () => api<{ locales: LocaleInfo[] }>('/api/i18n/locales'),
    staleTime: 60_000,
  });
  const locales = data?.locales ?? [];
  if (locales.length === 0) return null;

  return (
    <div>
      <p className="rule-double smallcaps mb-2 pb-1.5 text-[var(--ink-6)]">SMS &amp; Call Language</p>
      <div className="space-y-2">
        {locales.map((l) => {
          const on = current === l.code;
          const locked = !l.live && !on;
          return (
            <button
              key={l.code}
              disabled={locked || saving}
              title={locked ? 'Machine-drafted only — awaiting native-speaker review' : undefined}
              className={`flex w-full items-center gap-3 border px-3 py-2 text-left transition-colors ${
                on
                  ? 'border-[var(--ink)] bg-[var(--gold-wash)]'
                  : locked
                    ? 'cursor-not-allowed border-[var(--ink-1)] opacity-60'
                    : 'border-[var(--ink-2)] hover:border-[var(--ink-5)]'
              }`}
              onClick={() => !on && onPick(l.code)}
            >
              <span className="min-w-0 flex-1">
                <span className={`block text-sm font-bold ${locked ? 'text-[var(--ink-5)]' : 'text-[var(--ink)]'}`}>{l.endonym}</span>
                <span className="smallcaps block text-[var(--ink-6)]">
                  {locked ? 'Awaiting native review' : l.label}
                </span>
              </span>
              {on && <span className="serial text-sm font-bold text-[var(--ink)]">✓</span>}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-[var(--ink-6)]">Offers, receipts, and voice calls arrive in this language.</p>
    </div>
  );
}
