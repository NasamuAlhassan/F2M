import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api, type PriceTerms, type Registries } from '../api';
import { btnCls, btnGhostCls, Card, ErrorStamp, Field, GradeBadge, inputCls } from './ui';

const MULTIPLIERS: Record<'A' | 'B' | 'C', number> = { A: 1.0, B: 0.88, C: 0.7 };

export interface DemandPrefill {
  commodityCode?: string;
  unitCode?: string;
  unitQty?: number;
  minBand?: 'A' | 'B' | 'C';
  basePriceGhs?: string;
}

export function NewDemandForm({
  registries,
  onDone,
  onCancel,
  initial,
}: {
  registries: Registries;
  onDone: () => void;
  onCancel?: () => void;
  initial?: DemandPrefill;
}) {
  const queryClient = useQueryClient();
  const [commodityCode, setCommodityCode] = useState(initial?.commodityCode ?? registries.commodities[0]?.code ?? '');
  const commodity = registries.commodities.find((c) => c.code === commodityCode);
  const [unitCode, setUnitCode] = useState(initial?.unitCode ?? '');
  const [unitQty, setUnitQty] = useState(String(initial?.unitQty ?? 10));
  const [minBand, setMinBand] = useState<'A' | 'B' | 'C'>(initial?.minBand ?? 'B');
  const [basePrice, setBasePrice] = useState(initial?.basePriceGhs ?? '4.00'); // GHS/kg
  const [terms, setTerms] = useState<Partial<Record<'A' | 'B' | 'C', string>>>({});
  const [windowStart, setWindowStart] = useState(() => new Date().toISOString().slice(0, 10));
  const [windowEnd, setWindowEnd] = useState(() => new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10));
  const [regionCode, setRegionCode] = useState('GREATER_ACCRA');
  const [error, setError] = useState<string | null>(null);

  const units = commodity?.units ?? [];
  const activeUnit = units.find((u) => u.code === unitCode) ?? units[0];

  // A perishable's clock caps the window (end date is inclusive) — snap the
  // end date down whenever the chosen commodity can't reach the current one.
  useEffect(() => {
    if (!commodity) return;
    const maxDays = commodity.clock.maxWindowDays;
    const start = new Date(windowStart).getTime();
    const end = new Date(windowEnd).getTime();
    const lastAllowed = start + (maxDays - 1) * 86400000;
    if (Number.isFinite(start) && Number.isFinite(end) && end > lastAllowed) {
      setWindowEnd(new Date(lastAllowed).toISOString().slice(0, 10));
    }
  }, [commodity, windowStart, windowEnd]);

  // Per-band schedule: derived from the base price via multipliers, each band editable.
  const derived = useMemo(() => {
    const base = Math.round(Number(basePrice) * 100) || 0;
    const out: Record<'A' | 'B' | 'C', number> = { A: 0, B: 0, C: 0 };
    for (const band of ['A', 'B', 'C'] as const) {
      const override = terms[band];
      out[band] =
        override !== undefined && override !== ''
          ? Math.round(Number(override) * 100)
          : Math.round((base * MULTIPLIERS[band]) / MULTIPLIERS[minBand]);
    }
    return out;
  }, [basePrice, terms, minBand]);

  const create = useMutation({
    mutationFn: () => {
      const priceTerms: PriceTerms = { ...derived, REJECT: 0 };
      return api('/api/demands', {
        method: 'POST',
        body: JSON.stringify({
          commodityCode,
          unitCode: activeUnit?.code,
          unitQty: Number(unitQty),
          minBand,
          priceTerms,
          windowStart: new Date(windowStart).getTime(),
          windowEnd: new Date(windowEnd).getTime() + 86399000, // end of day
          regionCode,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['demands'] });
      onDone();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed'),
  });

  const kg = activeUnit ? Math.round(activeUnit.kgPerUnit * Number(unitQty) * 10) / 10 : 0;

  return (
    <Card title="Post a New Demand">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Field label="Commodity">
          <select
            className={inputCls}
            value={commodityCode}
            onChange={(e) => {
              setCommodityCode(e.target.value);
              setUnitCode('');
            }}
          >
            {registries.commodities.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
                {c.clockType === 'perishable' ? ' · perishable' : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label={`Quantity (${activeUnit?.name ?? 'unit'})`}>
          <div className="flex gap-2">
            <input className={inputCls} type="number" min="1" value={unitQty} onChange={(e) => setUnitQty(e.target.value)} />
            <select className={inputCls} value={activeUnit?.code} onChange={(e) => setUnitCode(e.target.value)}>
              {units.map((u) => (
                <option key={u.code} value={u.code}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          <span className="serial mt-1 block text-[11px] text-[var(--ink-6)]">= {kg} kg</span>
        </Field>
        <Field label="Minimum Grade">
          <div className="flex items-center gap-2 py-1">
            {(['A', 'B', 'C'] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setMinBand(g)}
                className={`flex min-h-11 flex-1 items-center justify-center py-1 transition-opacity lg:min-h-0 ${minBand === g ? '' : 'opacity-30 hover:opacity-60'}`}
                aria-pressed={minBand === g}
              >
                <GradeBadge grade={g} />
              </button>
            ))}
          </div>
        </Field>
        <Field label={`Base Price GHS/kg (grade ${minBand})`}>
          <input
            className={`${inputCls} serial`}
            type="number"
            step="0.01"
            value={basePrice}
            onChange={(e) => setBasePrice(e.target.value)}
          />
        </Field>
        <Field label="Window Start">
          <input className={inputCls} type="date" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} />
        </Field>
        <Field label="Window End">
          <input className={inputCls} type="date" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} />
          {commodity?.clockType === 'perishable' && (
            <span className="mt-1 block text-[11px] font-semibold text-[var(--gold-deep)]">
              Perishable — window limited to {commodity.clock.maxWindowDays} days
            </span>
          )}
        </Field>
        <Field label="Delivery Region">
          <select className={inputCls} value={regionCode} onChange={(e) => setRegionCode(e.target.value)}>
            {registries.regions.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="certificate mt-4 bg-[var(--paper)] p-4">
        <p className="smallcaps mb-3 text-[var(--ink-6)]">Price per grade — this full schedule is what the farmer accepts</p>
        <div className="flex flex-wrap items-center gap-4">
          {(['A', 'B', 'C'] as const).map((band) => (
            <label key={band} className="flex items-center gap-2 text-sm">
              <GradeBadge grade={band} />
              <input
                className={`${inputCls} serial w-24`}
                type="number"
                step="0.01"
                value={terms[band] ?? (derived[band] / 100).toFixed(2)}
                onChange={(e) => setTerms((t) => ({ ...t, [band]: e.target.value }))}
              />
              <span className="smallcaps text-[var(--ink-6)]">/kg</span>
            </label>
          ))}
          <span className="smallcaps ml-auto text-[var(--ink-6)]">Reject pays 0</span>
        </div>
      </div>

      {error && (
        <ErrorStamp message={error} onDismiss={() => setError(null)} className="mt-3" />
      )}
      <div className="mt-4 flex gap-3">
        <button className={`${btnCls} flex-1 py-2.5`} onClick={() => create.mutate()} disabled={create.isPending}>
          {create.isPending ? 'Posting…' : 'Post Demand'}
        </button>
        <button className={`${btnGhostCls} flex-1 py-2.5`} onClick={onCancel ?? onDone}>
          Cancel
        </button>
      </div>
    </Card>
  );
}
