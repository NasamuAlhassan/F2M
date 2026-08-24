import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ghs, placeName, sellerName, shortDate, type MarketLot, type Registries } from '../api';
import { NewDemandForm } from '../components/DemandForm';
import { CropMark, Glyph } from '../components/engrave';
import { btnCls, GradeBadge, inputCls, rowOffCls, rowOnCls } from '../components/ui';
import { PoolBuilder } from './Consolidate';

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
  // On phones the certificates lead; the filter ledger folds behind a summary row.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilters = crops.size + grades.size + (perish !== 'all' ? 1 : 0) + (maxKm < 700 ? 1 : 0);

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
    <div className="mb-4 inline-flex border border-[var(--ink-7)]">
      {(
        [
          ['browse', 'Browse Lots'],
          ['pool', 'Pool Builder'],
        ] as const
      ).map(([m, label]) => (
        <button
          key={m}
          onClick={() => setSearchParams(m === 'pool' ? { mode: 'pool' } : {}, { replace: true })}
          className={`smallcaps min-h-11 px-4 py-2 transition-colors lg:min-h-0 ${
            mode === m ? 'bg-[var(--ink)] text-[var(--paper)]' : 'bg-[var(--paper-lift)] text-[var(--ink-6)] hover:text-[var(--ink)]'
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
      <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
        {/* ── The filter index (folds behind a summary row on phones) ── */}
        <aside className="w-full flex-shrink-0 lg:w-52">
          <button
            className="smallcaps flex min-h-11 w-full items-center justify-between border border-[var(--ink-3)] bg-[var(--paper-lift)] px-3 py-2.5 text-[var(--ink)] lg:hidden"
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={filtersOpen}
          >
            <span>
              Filters
              {activeFilters > 0 && <span className="serial ml-2 text-[var(--gold-ink)]">{activeFilters} active</span>}
            </span>
            <span>{filtersOpen ? 'Hide' : 'Show'}</span>
          </button>
          <div className={`${filtersOpen ? 'mt-4 block' : 'hidden'} space-y-6 lg:mt-0 lg:block`}>
            <div>
              <p className="rule-double smallcaps mb-2.5 pb-1.5 text-[var(--ink-6)]">Crop Type</p>
              <div className="space-y-0.5">
                {(registries?.commodities ?? []).map((c) => (
                  <label
                    key={c.code}
                    className={`flex cursor-pointer items-center gap-2.5 px-2 py-1.5 text-sm transition-colors ${
                      crops.has(c.code) ? rowOnCls : rowOffCls
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-[var(--ink)]"
                      checked={crops.has(c.code)}
                      onChange={() => toggle(crops, c.code, setCrops)}
                    />
                    <CropMark code={c.code} className="h-5 w-5 flex-shrink-0" />
                    {c.name}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="rule-double smallcaps mb-2.5 pb-1.5 text-[var(--ink-6)]">Perishability</p>
              <div className="space-y-0.5">
                {(
                  [
                    ['all', 'All Types'],
                    ['perishable', 'Perishable'],
                    ['storable', 'Storable'],
                  ] as const
                ).map(([value, label]) => (
                  <label
                    key={value}
                    className={`flex cursor-pointer items-center gap-2.5 px-2 py-1.5 text-sm transition-colors ${
                      perish === value ? rowOnCls : rowOffCls
                    }`}
                  >
                    <input
                      type="radio"
                      name="perish"
                      className="h-3.5 w-3.5 accent-[var(--ink)]"
                      checked={perish === value}
                      onChange={() => setPerish(value)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="rule-double smallcaps mb-2 pb-1.5 text-[var(--ink-6)]">Distance from you</p>
              <p className="serial mb-2 text-2xl font-bold text-[var(--ink)]">{maxKm} km</p>
              <input
                type="range"
                min={50}
                max={700}
                step={10}
                value={maxKm}
                onChange={(e) => setMaxKm(Number(e.target.value))}
                className="w-full accent-[var(--ink)]"
              />
              <div className="serial flex justify-between text-[11px] text-[var(--ink-4)]">
                <span>50 km</span>
                <span>700 km</span>
              </div>
            </div>

            <div>
              <p className="rule-double smallcaps mb-2.5 pb-1.5 text-[var(--ink-6)]">Declared Grade</p>
              <div className="flex gap-2">
                {(['A', 'B', 'C'] as const).map((g) => (
                  <button
                    key={g}
                    onClick={() => toggle(grades, g, setGrades)}
                    className={`flex min-h-11 flex-1 items-center justify-center py-1.5 transition-opacity lg:min-h-0 ${
                      grades.size && !grades.has(g) ? 'opacity-30' : ''
                    }`}
                    aria-pressed={grades.has(g)}
                  >
                    <GradeBadge grade={g} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </aside>

        {/* ── The certificates ─────────────────────────────────── */}
        <div className="min-w-0 flex-1">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="display text-xl font-semibold tracking-[0.05em] text-[var(--ink)]">Active Commodity Lots</h1>
              <p className="mt-1 text-sm text-[var(--ink-6)]">
                Showing {lots.length} of {all.length} lots
                {updatedMin !== null && <> · updated {updatedMin === 0 ? 'just now' : `${updatedMin} min ago`}</>}
                {q && (
                  <>
                    {' '}
                    · matching “<span className="font-semibold text-[var(--ink)]">{q}</span>”
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
            <div className="certificate flex flex-col items-center justify-center bg-[var(--paper-lift)] py-20 text-center">
              <CropMark code="MAIZE" className="mb-3 h-12 w-12 text-[var(--ink-4)]" />
              <p className="font-semibold text-[var(--ink-6)]">No lots match these filters</p>
              <p className="mt-1 text-sm text-[var(--ink-6)]">Lots appear the moment a farmer registers one — by web, USSD, or voice</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {lots.map((l) => (
                <article key={l.id} className="certificate flex flex-col bg-[var(--paper-lift)] p-3">
                  {/* document head: serial + seal */}
                  <div className="mb-2 flex items-center justify-between px-1">
                    <span className="serial text-[11px] font-bold tracking-[0.06em] text-[var(--ink-7)]">
                      LOT №&nbsp;{l.lotCode.replace('FTM-', '')}
                    </span>
                    <GradeBadge grade={l.declaredBand} />
                  </div>

                  {/* media well */}
                  <div className="relative h-36 overflow-hidden border border-[var(--ink-2)]">
                    {l.photoUrl ? (
                      <img src={l.photoUrl} alt={l.commodityName} className="h-full w-full object-cover" />
                    ) : (
                      <div className="hatch flex h-full w-full items-center justify-center">
                        <CropMark code={l.commodityCode} className="h-20 w-20 text-[var(--ink-7)]" />
                      </div>
                    )}
                    <span
                      className={`stamp absolute left-2 top-2 bg-[var(--paper)] px-1.5 py-0.5 text-[11px] ${
                        l.listingType === 'FORWARD' ? 'text-[var(--ink-7)]' : 'text-[var(--gold-deep)]'
                      }`}
                    >
                      {l.listingType === 'FORWARD' ? `Ready ${shortDate(l.readyDate)}` : 'Same-day'}
                    </span>
                    {l.channel !== 'web' && (
                      <span className="stamp absolute right-2 top-2 bg-[var(--paper)] px-1.5 py-0.5 text-[11px] text-[var(--ink-6)]">
                        {l.channel === 'ivr' ? 'Voice listing' : 'USSD listing'}
                      </span>
                    )}
                  </div>

                  {/* subject */}
                  <div className="mt-3 flex items-baseline justify-between gap-2 px-1">
                    <h2 className="truncate text-base font-bold text-[var(--ink)]">{l.commodityName}</h2>
                    <span className="serial flex-shrink-0 text-[11px] text-[var(--ink-6)]">{l.distanceKm} km</span>
                  </div>
                  <p className="truncate px-1 text-sm text-[var(--ink-6)]">
                    {sellerName(l.farmerName)} · {placeName(l.district) ? `${placeName(l.district)}, ` : ''}
                    {l.regionName}
                  </p>

                  {/* value line */}
                  <div className="mt-2.5 flex items-baseline justify-between gap-2 border-t border-[var(--ink-2)] px-1 pt-2.5">
                    <div className="whitespace-nowrap">
                      <span className="serial text-2xl font-bold text-[var(--gold-deep)]">
                        {l.pricePerUnit !== null ? ghs(l.pricePerUnit) : '—'}
                      </span>
                      <span className="smallcaps ml-1.5 text-[var(--ink-6)]">/ {l.unitName}</span>
                    </div>
                    {l.fairPrice && l.pricePerUnit !== null && (
                      <span
                        className="stamp whitespace-nowrap px-1.5 py-0.5 text-[11px] text-[var(--ink)]"
                        title="At or below the cross-market reference average"
                      >
                        Fair price
                      </span>
                    )}
                  </div>
                  <p className="serial px-1 text-[11px] text-[var(--ink-6)]">
                    {l.unitsRemaining !== null ? `${l.unitsRemaining} units · ` : ''}
                    {l.remainingKg.toLocaleString()} kg on offer
                    {l.priceSource === 'market' ? ' · market ref' : ''}
                  </p>

                  {l.farmerPhone && (
                    <a
                      href={`tel:${l.farmerPhone}`}
                      className="mt-2.5 flex min-h-11 items-center justify-center gap-2 border border-[var(--stamp)] py-2 text-sm font-semibold text-[var(--stamp)] transition-colors hover:bg-[var(--stamp-wash)] lg:min-h-0"
                    >
                      <Glyph name="phone" className="h-4 w-4" />
                      Call to negotiate <span className="serial text-xs">{l.farmerPhone}</span>
                    </a>
                  )}
                  {l.channel !== 'web' && (
                    <p className="mt-1.5 px-1 text-[11px] leading-snug text-[var(--ink-6)]">
                      This farmer listed by {l.channel === 'ivr' ? 'voice call' : 'USSD'} and may not read SMS — call to
                      agree terms, or bid and they'll get a voice call.
                    </p>
                  )}

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Link
                      to={`/lots/${l.id}/trace`}
                      className="rounded-[2px] border border-[var(--ink-5)] py-2 text-center text-sm font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--paper-deep)]"
                    >
                      View Trace
                    </Link>
                    <button className={btnCls} onClick={() => setBidLot(l)}>
                      Place Bid
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        {/* ── Place Bid = a demand pre-filled for this lot ──────── */}
        {bidLot && registries && (
          <div className="fixed inset-0 z-40 overflow-y-auto" onClick={() => setBidLot(null)}>
            <div className="absolute inset-0 bg-[var(--ink)]/70" />
            <div className="relative mx-auto my-8 w-full max-w-3xl px-4" onClick={(e) => e.stopPropagation()}>
              <div className="certificate overflow-hidden bg-[var(--paper)]">
                <div className="plate flex items-center justify-between px-6 py-4">
                  <div>
                    <p className="display text-sm font-semibold tracking-[0.08em]">
                      PLACE BID — {bidLot.remainingKg}KG {bidLot.commodityName.toUpperCase()}
                    </p>
                    <p className="smallcaps mt-0.5 text-[var(--ink-3)]">
                      a bid is a demand: the engine offers this lot to {bidLot.farmerName ?? 'the farmer'} — escrow moves
                      only if they accept
                    </p>
                  </div>
                  <button
                    className="stamp px-2 py-0.5 text-[11px] text-[var(--paper)] hover:bg-[var(--ink-8)]"
                    onClick={() => setBidLot(null)}
                  >
                    Close
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
