import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ghs, shortDate, type Demand, type PriceTerms, type Registries } from '../api';
import { btnCls, btnGhostCls, Card, Field, inputCls, numCls, StateBadge, tableCls, tdCls, thCls } from '../components/ui';

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
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-bold uppercase tracking-widest">Demands</h1>
        <button className={btnCls} onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Close' : 'New demand'}
        </button>
      </div>

      {showForm && registries && <NewDemandForm registries={registries} onDone={() => setShowForm(false)} />}

      <Card>
        {!data?.demands.length ? (
          <p className="text-sm text-ink-soft">No demands yet. Post one — matching runs the moment it lands.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className={tableCls}>
              <thead>
                <tr>
                  <th className={thCls}>Commodity</th>
                  <th className={thCls}>Quantity</th>
                  <th className={thCls}>Remaining</th>
                  <th className={thCls}>Min band</th>
                  <th className={thCls}>Price (min band)</th>
                  <th className={thCls}>Window</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody>
                {data.demands.map((d, i) => (
                  <tr key={d.id} className={i % 2 ? 'bg-paper-dim' : ''}>
                    <td className={`${tdCls} font-bold`}>{commodityById.get(d.commodityId)?.name ?? '—'}</td>
                    <td className={`${tdCls} ${numCls}`}>{d.quantityKg}kg</td>
                    <td className={`${tdCls} ${numCls}`}>{d.remainingKg}kg</td>
                    <td className={`${tdCls} ${numCls}`}>{d.minBand}</td>
                    <td className={`${tdCls} ${numCls}`}>{ghs(d.priceTerms[d.minBand as 'A' | 'B' | 'C'] ?? 0)}/kg</td>
                    <td className={tdCls}>
                      {shortDate(d.windowStart)} – {shortDate(d.windowEnd)}
                    </td>
                    <td className={tdCls}>
                      <StateBadge state={d.status} />
                    </td>
                    <td className={`${tdCls} text-right`}>
                      <Link className="font-bold uppercase text-accent underline" to={`/demands/${d.id}`}>
                        Matches
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function NewDemandForm({ registries, onDone }: { registries: Registries; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [commodityCode, setCommodityCode] = useState(registries.commodities[0]?.code ?? '');
  const commodity = registries.commodities.find((c) => c.code === commodityCode);
  const [unitCode, setUnitCode] = useState('');
  const [unitQty, setUnitQty] = useState('10');
  const [minBand, setMinBand] = useState<'A' | 'B' | 'C'>('B');
  const [basePrice, setBasePrice] = useState('4.00'); // GHS/kg
  const [terms, setTerms] = useState<Partial<Record<'A' | 'B' | 'C', string>>>({});
  const [windowStart, setWindowStart] = useState(() => new Date().toISOString().slice(0, 10));
  const [windowEnd, setWindowEnd] = useState(() => new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10));
  const [regionCode, setRegionCode] = useState('GREATER_ACCRA');
  const [error, setError] = useState<string | null>(null);

  const units = commodity?.units ?? [];
  const activeUnit = units.find((u) => u.code === unitCode) ?? units[0];

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
    <Card title="New demand">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
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
                {c.name} {c.clockType === 'perishable' ? '(perishable)' : ''}
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
          <span className={`mt-1 block text-xs text-ink-soft ${numCls}`}>= {kg}kg</span>
        </Field>
        <Field label="Minimum band">
          <select className={inputCls} value={minBand} onChange={(e) => setMinBand(e.target.value as 'A' | 'B' | 'C')}>
            <option value="A">Grade A</option>
            <option value="B">Grade B</option>
            <option value="C">Grade C</option>
          </select>
        </Field>
        <Field label={`Base price GHS/kg (band ${minBand})`}>
          <input className={inputCls} type="number" step="0.01" value={basePrice} onChange={(e) => setBasePrice(e.target.value)} />
        </Field>
        <Field label="Window start">
          <input className={inputCls} type="date" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} />
        </Field>
        <Field label="Window end">
          <input className={inputCls} type="date" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} />
          {commodity?.clockType === 'perishable' && (
            <span className="mt-1 block text-xs font-bold text-warn">
              Perishable: window limited to {commodity.clock.maxWindowDays} days
            </span>
          )}
        </Field>
        <Field label="Delivery region">
          <select className={inputCls} value={regionCode} onChange={(e) => setRegionCode(e.target.value)}>
            {registries.regions.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="mt-4 border-2 border-ink bg-paper-dim p-3">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-widest">
          Price per grade — this full schedule is what the farmer accepts
        </p>
        <div className="flex flex-wrap gap-4">
          {(['A', 'B', 'C'] as const).map((band) => (
            <label key={band} className="flex items-center gap-2 text-sm">
              <span className="font-mono font-bold">{band}</span>
              <input
                className={`${inputCls} w-24`}
                type="number"
                step="0.01"
                value={terms[band] ?? (derived[band] / 100).toFixed(2)}
                onChange={(e) => setTerms((t) => ({ ...t, [band]: e.target.value }))}
              />
              <span className="text-xs text-ink-soft">/kg</span>
            </label>
          ))}
          <span className="flex items-center font-mono text-sm text-ink-soft">REJECT PAYS 0</span>
        </div>
      </div>

      {error && <p className="mt-2 border border-err px-2 py-1.5 text-sm text-err">{error}</p>}
      <div className="mt-4 flex gap-2">
        <button className={btnCls} onClick={() => create.mutate()} disabled={create.isPending}>
          {create.isPending ? 'Posting…' : 'Post demand'}
        </button>
        <button className={btnGhostCls} onClick={onDone}>
          Cancel
        </button>
      </div>
    </Card>
  );
}
