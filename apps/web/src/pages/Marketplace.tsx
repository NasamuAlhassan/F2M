import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ghs, shortDate, type MarketLot, type Registries } from '../api';
import { NewDemandForm } from '../components/DemandForm';
import { btnCls, CROP_EMOJI, GradeBadge, inputCls } from '../components/ui';
import { PoolBuilder } from './Consolidate';

// Hero gradients per crop — we have no lot photos (farmers list over USSD from
// basic phones), so the card art is an honest brand-styled stand-in.
const CROP_GRADIENT: Record<string, string> = {
  MAIZE: 'from-yellow-100 to-amber-200',
  TOMATO: 'from-red-100 to-rose-200',
  YAM: 'from-orange-100 to-amber-200',
  RICE: 'from-stone-100 to-yellow-100',
  GROUNDNUT: 'from-amber-100 to-orange-200',
  PEPPER: 'from-red-100 to-orange-200',
  ONION: 'from-purple-100 to-fuchsia-200',
  PLANTAIN: 'from-lime-100 to-green-200',
};

type SortKey = 'newest' | 'nearest' | 'largest' | 'cheapest';

export function MarketplacePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const q = (searchParams.get('q') ?? '').trim().toLowerCase();
  const mode = searchParams.get('mode') === 'pool' ? 'pool' : 'browse';

  const { data: registries } = useQuery({ queryKey: ['registries'], queryFn: () => api<Registries>('/api/registries') });
  const { data, dataUpdatedAt } = useQuery({
    queryKey: ['market-lots'],
    queryFn: () => api<{ lots: MarketLot[] }>('/api/market/lots'),
    refetchInterval: 10000,
  });

  const [crops, setCrops] = useState<Set<string>>(new Set());
  const [perish, setPerish] = useState<'all' | 'perishable' | 'storable'>('all');
  const [maxKm, setMaxKm] = useState(700);
  const [grades, setGrades] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortKey>('newest');
  const [bidLot, setBidLot] = useState<MarketLot | null>(null);

  const all = data?.lots ?? [];
  const lots = useMemo(() => {
    const filtered = all.filter((l) => {
      if (crops.size && !crops.has(l.commodityCode)) return false;
      if (perish !== 'all' && l.clockType !== perish) return false;
      if (l.distanceKm > maxKm) return false;
      if (grades.size && !grades.has(l.declaredBand)) return false;
      if (q) {
        const hay = `${l.commodityName} ${l.farmerName ?? ''} ${l.regionName} ${l.district ?? ''} ${l.lotCode}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const by: Record<SortKey, (a: MarketLot, b: MarketLot) => number> = {
      newest: (a, b) => b.createdAt - a.createdAt,
      nearest: (a, b) => a.distanceKm - b.distanceKm,
      largest: (a, b) => b.remainingKg - a.remainingKg,
      cheapest: (a, b) => (a.pricePerKg ?? Infinity) - (b.pricePerKg ?? Infinity),
    };
    return [...filtered].sort(by[sort]);
  }, [all, crops, perish, maxKm, grades, q, sort]);

  const updatedMin = dataUpdatedAt ? Math.max(0, Math.round((Date.now() - dataUpdatedAt) / 60000)) : null;

  const toggle = (set: Set<string>, value: string, apply: (next: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    apply(next);
  };

  const modeSwitch = (
    <div className="mb-4 inline-flex rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
      {(
        [
          ['browse', '🛒 Browse Lots'],
          ['pool', '🚚 Pool Builder'],
        ] as const
      ).map(([m, label]) => (
        <button
          key={m}
          onClick={() => setSearchParams(m === 'pool' ? { mode: 'pool' } : {}, { replace: true })}
          className={`rounded-lg px-4 py-1.5 text-sm font-bold transition-colors ${
            mode === m ? 'bg-[#1B4332] text-white' : 'text-gray-500 hover:text-gray-800'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  if (mode === 'pool') {
    return (
      <div>
        {modeSwitch}
        <PoolBuilder />
      </div>
    );
  }

  return (
    <div>
      {modeSwitch}
      <div className="flex flex-col gap-6 lg:flex-row">
      {/* ── Filters sidebar (Frame 01) ─────────────────────────── */}
      <aside className="w-full flex-shrink-0 lg:w-52">
        <div className="space-y-6">
          <div>
            <p className="mb-2.5 text-[11px] font-bold uppercase tracking-widest text-gray-400">Crop Type</p>
            <div className="space-y-1">
              {(registries?.commodities ?? []).map((c) => (
                <label
                  key={c.code}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors ${
                    crops.has(c.code) ? 'bg-green-50 font-semibold text-[#1B4332]' : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[#1B4332]"
                    checked={crops.has(c.code)}
                    onChange={() => toggle(crops, c.code, setCrops)}
                  />
                  {CROP_EMOJI[c.code] ?? '📦'} {c.name}
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2.5 text-[11px] font-bold uppercase tracking-widest text-gray-400">Perishability</p>
            <div className="space-y-1">
              {(
                [
                  ['all', 'All Types'],
                  ['perishable', 'Perishable'],
                  ['storable', 'Storable'],
                ] as const
              ).map(([value, label]) => (
                <label
                  key={value}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors ${
                    perish === value ? 'bg-green-50 font-semibold text-[#1B4332]' : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <input
                    type="radio"
                    name="perish"
                    className="h-4 w-4 accent-[#1B4332]"
                    checked={perish === value}
                    onChange={() => setPerish(value)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-gray-400">Distance from you</p>
            <p className="mono mb-2 text-2xl font-extrabold text-gray-900">{maxKm} km</p>
            <input
              type="range"
              min={50}
              max={700}
              step={10}
              value={maxKm}
              onChange={(e) => setMaxKm(Number(e.target.value))}
              className="w-full accent-[#1B4332]"
            />
            <div className="mono flex justify-between text-[10px] text-gray-400">
              <span>50 km</span>
              <span>700 km</span>
            </div>
          </div>

          <div>
            <p className="mb-2.5 text-[11px] font-bold uppercase tracking-widest text-gray-400">Quality Grade</p>
            <div className="flex gap-2">
              {(['A', 'B', 'C'] as const).map((g) => (
                <button
                  key={g}
                  onClick={() => toggle(grades, g, setGrades)}
                  className={`flex-1 rounded-lg border-2 py-1.5 text-sm font-bold transition-colors ${
                    grades.has(g)
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
          </div>
        </div>
      </aside>

      {/* ── Lot cards ──────────────────────────────────────────── */}
      <div className="min-w-0 flex-1">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-extrabold text-gray-900">Active Commodity Lots</h1>
            <p className="mt-0.5 text-sm text-gray-500">
              Showing {lots.length} of {all.length} lots
              {updatedMin !== null && <> · Updated {updatedMin === 0 ? 'just now' : `${updatedMin} min ago`}</>}
              {q && (
                <>
                  {' '}
                  · matching “<span className="font-semibold text-gray-700">{q}</span>”
                </>
              )}
            </p>
          </div>
          <div className="w-52">
            <select className={inputCls} value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="newest">Sort: Newest</option>
              <option value="nearest">Sort: Nearest</option>
              <option value="largest">Sort: Largest</option>
              <option value="cheapest">Sort: Lowest price/kg</option>
            </select>
          </div>
        </div>

        {lots.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-gray-100 bg-white py-20 text-gray-400 shadow-sm">
            <div className="mb-2 text-4xl">🌾</div>
            <p className="font-semibold text-gray-500">No lots match these filters</p>
            <p className="mt-1 text-sm">Lots appear here the moment a farmer registers one over USSD</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {lots.map((l) => (
              <div
                key={l.id}
                className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm transition-shadow hover:shadow-lg"
              >
                {/* hero — real produce photo when the seller uploaded one (D-036) */}
                <div className={`relative h-40 bg-gradient-to-br ${CROP_GRADIENT[l.commodityCode] ?? 'from-gray-100 to-gray-200'}`}>
                  {l.photoUrl ? (
                    <img src={l.photoUrl} alt={l.commodityName} className="absolute inset-0 h-full w-full object-cover" />
                  ) : (
                    <span className="absolute inset-0 flex items-center justify-center text-7xl opacity-80 drop-shadow-sm">
                      {CROP_EMOJI[l.commodityCode] ?? '📦'}
                    </span>
                  )}
                  <span
                    className={`absolute left-3 top-3 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide shadow-sm ${
                      l.listingType === 'FORWARD' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-800'
                    }`}
                  >
                    {l.listingType === 'SAME_DAY' && <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-current" />}
                    {l.listingType === 'FORWARD' ? 'Forward' : 'Same-day'}
                  </span>
                  {l.channel !== 'web' && (
                    <span className="absolute left-3 top-10 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-gray-700 shadow-sm">
                      {l.channel === 'ivr' ? '🎙 Voice listing' : '📟 USSD listing'}
                    </span>
                  )}
                  <span className="absolute right-3 top-3">
                    <GradeBadge grade={l.declaredBand} />
                  </span>
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-4 pb-2.5 pt-8">
                    <div className="flex items-end justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-lg font-extrabold leading-tight text-white">{l.commodityName}</p>
                        <p className="truncate text-xs text-white/80">{l.farmerName ?? 'Farmer'}</p>
                      </div>
                      <span className="mono flex-shrink-0 rounded-md bg-black/50 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        {l.distanceKm} km
                      </span>
                    </div>
                  </div>
                </div>

                {/* body */}
                <div className="p-4">
                  <div className="flex items-baseline justify-between">
                    <p className="mono text-[10px] font-bold uppercase tracking-widest text-gray-400">
                      {/* many unit names already carry their kg — don't say it twice */}
                      {/\d+\s*kg/i.test(l.unitName) ? l.unitName : `${l.unitName} (${l.kgPerUnit} kg)`}
                    </p>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Location</p>
                  </div>
                  <div className="mt-1 flex items-start justify-between gap-3">
                    <p className="text-2xl font-extrabold text-gray-900">
                      {l.pricePerUnit !== null ? ghs(l.pricePerUnit) : '—'}
                    </p>
                    <p className="text-right text-sm font-semibold text-gray-700">
                      {l.district ? `${l.district}, ` : ''}
                      {l.regionName}
                    </p>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    {l.unitsRemaining !== null && (
                      <span className="text-sm font-medium text-gray-600">{l.unitsRemaining} units</span>
                    )}
                    {l.fairPrice && l.pricePerUnit !== null && (
                      <span
                        className="rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-bold text-green-700"
                        title={
                          l.priceSource === 'market'
                            ? 'Priced at the cross-market reference average'
                            : 'Asking price at or below the cross-market average'
                        }
                      >
                        ✓ Fair Price
                      </span>
                    )}
                    {l.priceSource === 'market' && (
                      <span className="text-[10px] text-gray-400" title="No asking price — showing the market reference value">
                        market ref
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                        l.listingType === 'FORWARD'
                          ? 'border-blue-200 bg-blue-50 text-blue-700'
                          : 'border-gray-200 bg-gray-50 text-gray-500'
                      }`}
                    >
                      {l.listingType === 'FORWARD' ? `Ready ${shortDate(l.readyDate)}` : `Lot ${l.lotCode}`}
                    </span>
                    <span className="mono text-[10px] text-gray-400">{l.kgPerUnit} kg / unit</span>
                  </div>

                  {l.farmerPhone && (
                    <a
                      href={`tel:${l.farmerPhone}`}
                      className="mt-3 flex items-center justify-center gap-2 rounded-xl border-2 border-[#D97706] py-2 text-sm font-bold text-[#B45309] transition-colors hover:bg-amber-50"
                    >
                      📞 Call to negotiate <span className="mono text-xs font-semibold">{l.farmerPhone}</span>
                    </a>
                  )}
                  {l.channel !== 'web' && (
                    <p className="mt-1.5 text-[10px] leading-snug text-gray-400">
                      This farmer listed by {l.channel === 'ivr' ? 'voice call' : 'USSD'} and may not read SMS — call to
                      agree terms, or bid and they'll get a voice call.
                    </p>
                  )}
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Link
                      to={`/lots/${l.id}/trace`}
                      className="rounded-xl border border-gray-200 py-2 text-center text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-50"
                    >
                      View Trace
                    </Link>
                    <button className={btnCls} onClick={() => setBidLot(l)}>
                      Place Bid
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Place Bid = a demand pre-filled for this lot ───────── */}
      {bidLot && registries && (
        <div className="fixed inset-0 z-40 overflow-y-auto" onClick={() => setBidLot(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative mx-auto my-8 w-full max-w-3xl px-4" onClick={(e) => e.stopPropagation()}>
            <div className="overflow-hidden rounded-2xl bg-white shadow-2xl">
              <div className="flex items-center justify-between bg-[#1B4332] px-6 py-4">
                <div>
                  <p className="text-sm font-bold text-white">
                    Place Bid — {CROP_EMOJI[bidLot.commodityCode]} {bidLot.remainingKg}kg {bidLot.commodityName} from{' '}
                    {bidLot.farmerName ?? 'farmer'}
                  </p>
                  <p className="text-[11px] text-green-300">
                    A bid is a demand: post it and the engine offers this lot to the farmer instantly — escrow only
                    moves if they accept
                  </p>
                </div>
                <button className="rounded-full bg-white/10 px-2.5 py-1 text-white hover:bg-white/20" onClick={() => setBidLot(null)}>
                  ✕
                </button>
              </div>
              <div className="p-4">
                <NewDemandForm
                  registries={registries}
                  initial={{
                    commodityCode: bidLot.commodityCode,
                    unitCode: bidLot.unitCode ?? undefined,
                    unitQty: bidLot.unitsRemaining ?? undefined,
                    minBand: (['A', 'B', 'C'].includes(bidLot.declaredBand) ? bidLot.declaredBand : 'B') as 'A' | 'B' | 'C',
                    basePriceGhs: bidLot.pricePerKg !== null ? (bidLot.pricePerKg / 100).toFixed(2) : undefined,
                  }}
                  onDone={() => {
                    setBidLot(null);
                    navigate('/orders');
                  }}
                  onCancel={() => setBidLot(null)}
                />
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
