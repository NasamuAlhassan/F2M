import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ghs, shortDate, type Demand, type PriceTerms, type Registries } from '../api';
import { btnCls, btnGhostCls, Card, CROP_EMOJI, Field, inputCls, numCls, StateBadge, tableCls, tdCls, thCls } from '../components/ui';

const MULTIPLIERS: Record<'A' | 'B' | 'C', number> = { A: 1.0, B: 0.88, C: 0.7 };

export function DemandsPage() {
  const { data: registries } = useQuery({ queryKey: ['registries'], queryFn: () => api<Registries>('/api/registries') });
  const { data } = useQuery({
    queryKey: ['demands'],
    queryFn: () => api<{ demands: Demand[] }>('/api/demands'),
    refetchInterval: 5000,
  });
  const [showForm, setShowForm] = useState(false);
  const commodityById = useMemo(
    () => new Map((registries?.commodities ?? []).map((c) => [c.id, c])),
    [registries],
  );

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-gray-900">My Demands</h1>
          <p className="mt-0.5 text-sm text-gray-500">Post buy orders — the engine matches them the moment they land</p>
        </div>
        <button className={btnCls} onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Close' : '+ New Demand'}
        </button>
      </div>

      {showForm && registries && <NewDemandForm registries={registries} onDone={() => setShowForm(false)} />}

      <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
        {!data?.demands.length ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <div className="mb-2 text-4xl">🌾</div>
            <div className="font-semibold text-gray-500">No demands yet</div>
            <div className="mt-1 text-sm">Post one — matching runs the moment it lands</div>
          </div>
        ) : (
          <table className={tableCls}>
            <thead className="border-b border-gray-100">
              <tr>
                <th className={thCls}>Commodity</th>
                <th className={thCls}>Quantity</th>
                <th className={thCls}>Remaining</th>
                <th className={thCls}>Min Grade</th>
                <th className={thCls}>Price (min band)</th>
                <th className={thCls}>Window</th>
                <th className={thCls}>Status</th>
                <th className={thCls} />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {data.demands.map((d) => {
                const commodity = commodityById.get(d.commodityId);
                return (
                  <tr key={d.id} className="hover:bg-gray-50">
                    <td className={`${tdCls} font-bold text-gray-900`}>
                      {CROP_EMOJI[commodity?.code ?? ''] ?? '📦'} {commodity?.name ?? '—'}
                    </td>
                    <td className={`${tdCls} ${numCls} text-xs`}>{d.quantityKg}kg</td>
                    <td className={`${tdCls} ${numCls} text-xs`}>{d.remainingKg}kg</td>
                    <td className={tdCls}>
                      <span className="font-bold">{d.minBand}</span>
                    </td>
                    <td className={`${tdCls} font-extrabold text-[#1B4332]`}>{ghs(d.priceTerms[d.minBand as 'A' | 'B' | 'C'] ?? 0)}<span className="text-[10px] font-medium text-gray-400">/kg</span></td>
                    <td className={`${tdCls} text-xs text-gray-500`}>
                      {shortDate(d.windowStart)} – {shortDate(d.windowEnd)}
                    </td>
                    <td className={tdCls}>
                      <StateBadge state={d.status} />
                    </td>
                    <td className={`${tdCls} text-right`}>
                      <Link
                        className="rounded-lg border border-[#1B4332] px-3 py-1.5 text-xs font-semibold text-[#1B4332] transition-colors hover:bg-green-50"
                        to={`/demands/${d.id}`}
                      >
                        View Matches
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

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
                {CROP_EMOJI[c.code] ?? ''} {c.name} {c.clockType === 'perishable' ? '· perishable' : ''}
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
          <span className="mono mt-1 block text-[10px] text-gray-400">= {kg} kg</span>
        </Field>
        <Field label="Minimum Grade">
          <div className="flex gap-2">
            {(['A', 'B', 'C'] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setMinBand(g)}
                className={`flex-1 rounded-lg border-2 py-1.5 text-sm font-bold transition-colors ${
                  minBand === g
                    ? g === 'A'
                      ? 'border-green-700 bg-green-700 text-white'
                      : g === 'B'
                        ? 'border-amber-600 bg-amber-600 text-white'
                        : 'border-red-600 bg-red-600 text-white'
                    : 'border-gray-200 text-gray-500 hover:border-gray-400'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </Field>
        <Field label={`Base Price GHS/kg (grade ${minBand})`}>
          <input className={inputCls} type="number" step="0.01" value={basePrice} onChange={(e) => setBasePrice(e.target.value)} />
        </Field>
        <Field label="Window Start">
          <input className={inputCls} type="date" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} />
        </Field>
        <Field label="Window End">
          <input className={inputCls} type="date" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} />
          {commodity?.clockType === 'perishable' && (
            <span className="mt-1 block text-[10px] font-semibold text-[#D97706]">
              ⚡ Perishable — window limited to {commodity.clock.maxWindowDays} days
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

      <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50 p-4">
        <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-gray-400">
          Price per grade — this full schedule is what the farmer accepts
        </p>
        <div className="flex flex-wrap items-center gap-4">
          {(['A', 'B', 'C'] as const).map((band) => (
            <label key={band} className="flex items-center gap-2 text-sm">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded text-[11px] font-extrabold text-white ${
                  band === 'A' ? 'bg-green-700' : band === 'B' ? 'bg-amber-600' : 'bg-red-600'
                }`}
              >
                {band}
              </span>
              <input
                className={`${inputCls} mono w-24`}
                type="number"
                step="0.01"
                value={terms[band] ?? (derived[band] / 100).toFixed(2)}
                onChange={(e) => setTerms((t) => ({ ...t, [band]: e.target.value }))}
              />
              <span className="text-[10px] text-gray-400">/kg</span>
            </label>
          ))}
          <span className="ml-auto text-[10px] font-semibold uppercase text-gray-400">Reject pays 0</span>
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>
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
