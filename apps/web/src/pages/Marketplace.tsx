import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ghs, placeName, sellerName, shortDate, type MarketLot, type Registries } from '../api';
import { POLL } from '../poll';
import { NewDemandForm } from '../components/DemandForm';
import { CropMark, cropAccent, cropPhoto, Glyph } from '../components/engrave';
import { Modal } from '../components/Modal';
import { btnCls, btnGhostCls, BusyLabel, EmptyState, GradeBadge, inputCls, greetingFor, plateBtnCls, rowOffCls, rowOnCls, toast } from '../components/ui';
import { pillItemCls, SlidingPillGroup } from '../components/SlidingPill';
import { useT } from '../lib/i18n';
import { useAccount } from '../lib/session';
import { PoolBuilder } from './Consolidate';

type SortKey = 'newest' | 'nearest' | 'largest' | 'cheapest';

export function MarketplacePage() {
  const navigate = useNavigate();
  const { t } = useT();
  const { account } = useAccount();
  const [searchParams, setSearchParams] = useSearchParams();
  const q = (searchParams.get('q') ?? '').trim().toLowerCase();
  const mode = searchParams.get('mode') === 'pool' ? 'pool' : 'browse';

  // The registry never polls, so one failed fetch used to strand every bid
  // button forever: the modal was gated on `registries` and simply rendered
  // nothing. Now the trigger waits out the first load and the modal owns the
  // failure, with the retry the user needs.
  const {
    data: registries,
    isPending: registriesPending,
    isFetching: registriesFetching,
    refetch: refetchRegistries,
  } = useQuery({ queryKey: ['registries'], queryFn: () => api<Registries>('/api/registries') });
  const { data, dataUpdatedAt, isPending: lotsPending } = useQuery({
    queryKey: ['market-lots'],
    queryFn: () => api<{ lots: MarketLot[] }>('/api/market/lots'),
    refetchInterval: POLL.ambient,
  });

  // Filters live in the URL (?crop=MAIZE,RICE&grade=A&km=300&type=perishable&sort=nearest),
  // so refresh, Back/Forward and a shared link all keep the buyer's view.
  // Each setter edits the latest params (functional update), so several in
  // a row ("Clear all filters") never overwrite one another.
  const listParam = (key: string) => new Set((searchParams.get(key) ?? '').split(',').filter(Boolean));
  const crops = listParam('crop');
  const grades = listParam('grade');
  const perishRaw = searchParams.get('type');
  const perish: 'all' | 'perishable' | 'storable' = perishRaw === 'perishable' || perishRaw === 'storable' ? perishRaw : 'all';
  const kmRaw = Number(searchParams.get('km'));
  const maxKm = kmRaw >= 50 && kmRaw <= 700 ? kmRaw : 700;
  const sortRaw = searchParams.get('sort');
  const sort: SortKey = sortRaw === 'nearest' || sortRaw === 'largest' || sortRaw === 'cheapest' ? sortRaw : 'newest';
  const setParam = (key: string, value: string | null) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  const setCrops = (next: Set<string>) => setParam('crop', [...next].join(',') || null);
  const setGrades = (next: Set<string>) => setParam('grade', [...next].join(',') || null);
  const setPerish = (v: 'all' | 'perishable' | 'storable') => setParam('type', v === 'all' ? null : v);
  const setMaxKm = (km: number) => setParam('km', km >= 700 ? null : String(km));
  const setSort = (k: SortKey) => setParam('sort', k === 'newest' ? null : k);
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
    // crops/grades/perish/maxKm/sort all derive from searchParams.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, searchParams, q]);

  const updatedMin = dataUpdatedAt ? Math.max(0, Math.round((Date.now() - dataUpdatedAt) / 60000)) : null;

  const toggle = (set: Set<string>, value: string, apply: (next: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    apply(next);
  };

  // Mode rides in the URL beside the masthead's ?q — mutate a copy of the live
  // params so switching Browse↔Pool never silently drops an active search term.
  const switchMode = (m: 'browse' | 'pool') => {
    const next = new URLSearchParams(searchParams);
    if (m === 'pool') next.set('mode', 'pool');
    else next.delete('mode');
    setSearchParams(next, { replace: true });
  };

  const modeSwitch = (
    <SlidingPillGroup watch={mode} className="mb-6 inline-flex gap-1 rounded-full border border-[var(--ink-2)] bg-[var(--paper-lift)] p-1 shadow-sm">
      {(
        [
          ['browse', t('web.market.modeBrowse', 'Browse produce')],
          ['pool', t('web.market.modePool', 'Pool small lots')],
        ] as const
      ).map(([m, label]) => (
        <button key={m} type="button" aria-pressed={mode === m} onClick={() => switchMode(m)} className={pillItemCls(mode === m)}>
          {label}
        </button>
      ))}
    </SlidingPillGroup>
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
            type="button"
            className="smallcaps flex min-h-11 w-full items-center justify-between rounded-xl border border-[var(--ink-2)] bg-[var(--paper-lift)] px-3 py-2.5 text-[var(--ink)] shadow-sm transition-colors active:bg-[var(--paper-deep)] lg:hidden"
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
                {(registries?.commodities ?? []).map((c) => {
                  const accent = cropAccent(c.code);
                  const photo = cropPhoto(c.code);
                  return (
                    <label
                      key={c.code}
                      className={`flex min-h-11 items-center gap-2.5 rounded-xl px-2 py-1.5 text-sm transition-colors lg:min-h-9 ${
                        crops.has(c.code) ? rowOnCls : rowOffCls
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 accent-[var(--forest)]"
                        checked={crops.has(c.code)}
                        onChange={() => toggle(crops, c.code, setCrops)}
                      />
                      {photo ? (
                        <img
                          src={photo}
                          alt=""
                          className="h-7 w-7 flex-shrink-0 rounded-full object-cover"
                          style={{ boxShadow: `0 0 0 1.5px ${accent.wash}` }}
                        />
                      ) : (
                        <span
                          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full"
                          style={{ background: accent.wash, color: accent.ink }}
                        >
                          <CropMark code={c.code} className="h-4 w-4" />
                        </span>
                      )}
                      {c.name}
                    </label>
                  );
                })}
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
                    className={`flex min-h-11 items-center gap-2.5 rounded-xl px-2 py-1.5 text-sm transition-colors lg:min-h-9 ${
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
                aria-label="Maximum distance in kilometres"
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
                    type="button"
                    onClick={() => toggle(grades, g, setGrades)}
                    className={`flex min-h-11 flex-1 items-center justify-center rounded-xl py-1.5 transition-[opacity,background-color] hover:bg-[var(--paper-deep)] active:bg-[var(--ink-2)]/60 lg:min-h-0 ${
                      grades.size && !grades.has(g) ? 'opacity-30 hover:opacity-70' : ''
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
        {/* On a phone the title leads, above the filters; from lg it heads its column. */}
        <div className="contents lg:block lg:min-w-0 lg:flex-1">
          <div className="order-first flex flex-wrap items-end justify-between gap-3 lg:order-none lg:mb-4">
            <div>
              {account && (
                <p className="text-[15px] text-[var(--ink-7)]">
                  {greetingFor(t)}, {account.name.split(/\s+/)[0]}.
                </p>
              )}
              <h1 className="headline mt-1 text-4xl text-[var(--ink)] sm:text-5xl">{t('web.market.heading', 'Produce for sale')}</h1>
              <p className="mt-2 text-sm text-[var(--ink-6)]">
                {lotsPending
                  ? t('web.market.loading', 'Looking for produce…')
                  : lots.length === all.length
                    ? t('web.market.countAll', '{n} lots listed', { n: all.length })
                    : t('web.market.countSome', 'Showing {shown} of {n} lots', { shown: lots.length, n: all.length })}
                {updatedMin !== null && (
                  <>
                    {' '}
                    · {updatedMin === 0 ? t('web.market.updatedNow', 'updated just now') : t('web.market.updatedMin', 'updated {m} min ago', { m: updatedMin })}
                  </>
                )}
                {q && (
                  <>
                    {' '}
                    · matching “<span className="font-semibold text-[var(--ink)]">{q}</span>”
                  </>
                )}
              </p>
            </div>
            <div className="w-56">
              <select
                aria-label={t('web.market.sort', 'Sort lots')}
                className={`${inputCls} cursor-pointer rounded-full px-4`}
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
              >
                <option value="newest">{t('web.market.sortNewest', 'Newest first')}</option>
                <option value="nearest">{t('web.market.sortNearest', 'Nearest to you')}</option>
                <option value="largest">{t('web.market.sortLargest', 'Largest lots')}</option>
                <option value="cheapest">{t('web.market.sortCheapest', 'Lowest price per kg')}</option>
              </select>
            </div>
          </div>

          {/* An unfetched market and an empty one look identical once the grid is
              gone, and a market emptied by filters looks like both — so pending
              is answered first, and the empty copy names which of the two it is
              rather than blaming filters the buyer may not even have set. */}
          {lotsPending ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" aria-busy="true">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="certificate overflow-hidden">
                  <div className="skeleton h-44" />
                  <div className="space-y-2 p-3">
                    <div className="skeleton h-4 w-2/3 rounded" />
                    <div className="skeleton h-3 w-1/2 rounded" />
                    <div className="skeleton mt-3 h-9 rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : lots.length === 0 ? (
            all.length === 0 ? (
              <EmptyState
                icon={<CropMark code="MAIZE" className="h-7 w-7" />}
                title={t('web.market.emptyTitle', 'The market is quiet right now')}
                body={t(
                  'web.market.emptyBody',
                  'New lots appear here the moment a farmer lists one, by phone or on the web. Post what you need and we will match it for you.',
                )}
                action={
                  <Link to="/orders" className={`${btnCls} inline-flex items-center px-5`}>
                    {t('web.market.emptyAction', 'Post what you need')}
                  </Link>
                }
              />
            ) : (
              <EmptyState
                icon={<Glyph name="search" className="h-6 w-6" />}
                title={t('web.market.noMatchTitle', 'Nothing matches those filters')}
                body={
                  all.length === 1
                    ? t('web.market.noMatchBodyOne', 'The one lot listed is hidden by your filters. Widen the distance or grade, or clear them all.')
                    : t('web.market.noMatchBody', '{n} lots are hidden by your filters. Widen the distance or grade, or clear them all.', {
                        n: all.length,
                      })
                }
                action={
                  <button
                    type="button"
                    className={btnGhostCls}
                    onClick={() => {
                      setCrops(new Set());
                      setGrades(new Set());
                      setPerish('all');
                      setMaxKm(700);
                      if (q) {
                        const next = new URLSearchParams(searchParams);
                        next.delete('q');
                        setSearchParams(next, { replace: true });
                      }
                    }}
                  >
                    {t('web.market.clearFilters', 'Clear all filters')}
                  </button>
                }
              />
            )
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {lots.map((l) => (
                <article
                  key={l.id}
                  className="certificate flex flex-col overflow-hidden"
                >
                  {/* media well — full bleed to the card's own rounded corners. A real
                      seller photo where one was uploaded; otherwise a representative
                      stock photo of the commodity (D-042 — supersedes D-036's icon-only
                      placeholder), always labeled "Representative photo" so it's never
                      mistaken for this specific farmer's own produce. */}
                  <div className="relative h-44 flex-shrink-0 overflow-hidden">
                    {l.photoUrl ? (
                      <img src={l.photoUrl} alt={l.commodityName} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                    ) : cropPhoto(l.commodityCode) ? (
                      <>
                        <img
                          src={cropPhoto(l.commodityCode)!}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover"
                        />
                        <span className="stamp absolute bottom-2 left-2 bg-[var(--ink)]/80 px-1.5 py-0.5 text-[11px] text-[var(--paper)] backdrop-blur-sm">
                          Representative photo
                        </span>
                      </>
                    ) : (
                      <div
                        className="flex h-full w-full items-center justify-center"
                        style={{ background: cropAccent(l.commodityCode).wash, color: cropAccent(l.commodityCode).ink }}
                      >
                        <CropMark code={l.commodityCode} className="h-20 w-20" />
                      </div>
                    )}
                    <div className="absolute inset-x-0 top-0 flex items-start justify-between p-2.5">
                      <span
                        className={`stamp bg-[var(--paper-lift)]/95 px-2 py-1 text-[11px] shadow-sm backdrop-blur-sm ${
                          l.listingType === 'FORWARD' ? 'text-[var(--ink-7)]' : 'text-[var(--gold-deep)]'
                        }`}
                      >
                        {l.listingType === 'FORWARD'
                          ? t('web.market.readyOn', 'Ready {date}', { date: shortDate(l.readyDate) })
                          : t('web.market.readyNow', 'Ready now')}
                      </span>
                      <GradeBadge grade={l.declaredBand} />
                    </div>
                    {/* subject caption over the photo's own gradient scrim */}
                    {l.photoUrl && (
                      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/70 via-black/10 to-transparent p-2.5 pt-8">
                        <h2 className="truncate text-base font-bold text-white">{l.commodityName}</h2>
                        <span className="serial flex-shrink-0 text-[11px] text-white/90">{l.distanceKm} km</span>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-1 flex-col p-3">
                    {!l.photoUrl && (
                      <div className="mb-1 flex items-baseline justify-between gap-2">
                        <h2 className="truncate text-base font-bold text-[var(--ink)]">{l.commodityName}</h2>
                        <span className="serial flex-shrink-0 text-[11px] text-[var(--ink-6)]">{l.distanceKm} km</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm text-[var(--ink-6)]">
                        {sellerName(l.farmerName)} · {placeName(l.district) ? `${placeName(l.district)}, ` : ''}
                        {l.regionName}
                      </p>
                      {l.channel !== 'web' && (
                        <span className="stamp flex-shrink-0 bg-[var(--paper)] px-1.5 py-0.5 text-[11px] text-[var(--ink-6)]">
                          {l.channel === 'ivr' ? 'Voice listing' : 'USSD listing'}
                        </span>
                      )}
                    </div>

                    {/* value line */}
                    <div className="mt-2.5 flex items-baseline justify-between gap-2 border-t border-[var(--ink-2)] pt-2.5">
                      <div className="whitespace-nowrap">
                        <span className="serial text-2xl font-bold text-[var(--gold-deep)]">
                          {l.pricePerUnit !== null ? ghs(l.pricePerUnit) : '—'}
                        </span>
                        <span className="smallcaps ml-1.5 text-[var(--ink-6)]">/ {l.unitName}</span>
                      </div>
                      {l.fairPrice && l.pricePerUnit !== null && (
                        <span
                          className="stamp whitespace-nowrap bg-[var(--success-wash)] px-1.5 py-0.5 text-[11px] text-[var(--success)]"
                          title="At or below the cross-market reference average"
                        >
                          Fair price
                        </span>
                      )}
                    </div>
                    <p className="serial text-[11px] text-[var(--ink-6)]">
                      {l.unitsRemaining !== null ? `${l.unitsRemaining} × ${l.unitName} · ` : ''}
                      {t('web.market.kgAvailable', '{kg} kg available', { kg: l.remainingKg.toLocaleString() })}
                      {l.priceSource === 'market' ? ` · ${t('web.market.atMarket', 'priced at market')}` : ''}
                      <span className="text-[var(--ink-4)]"> · LOT №&nbsp;{l.lotCode.replace('FTM-', '')}</span>
                    </p>

                    {l.farmerPhone && (
                      <a
                        href={`tel:${l.farmerPhone}`}
                        className="mt-2.5 flex min-h-11 items-center justify-center gap-2 rounded-full border border-[var(--forest)] py-2 text-sm font-semibold text-[var(--forest-deep)] transition-[background-color,scale] hover:bg-[var(--forest-wash)] active:scale-[0.97] active:bg-[var(--forest-wash)] lg:min-h-0"
                      >
                        <Glyph name="phone" className="h-4 w-4" />
                        {t('web.market.call', 'Call the farmer')} <span className="serial text-xs">{l.farmerPhone}</span>
                      </a>
                    )}
                    {l.channel !== 'web' && (
                      <p className="mt-1.5 text-[11px] leading-snug text-[var(--ink-6)]">
                        {l.channel === 'ivr'
                          ? t('web.market.channelIvr', 'Listed by voice call. Call to agree a price, or bid and they get a voice call.')
                          : t('web.market.channelUssd', 'Listed from a basic phone. Call to agree a price, or bid and they get a voice call.')}
                      </p>
                    )}

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Link
                        to={`/lots/${l.id}/trace`}
                        className={`${btnGhostCls} flex items-center justify-center text-center`}
                      >
                        {t('web.market.viewTrace', 'View trace')}
                      </Link>
                      <button
                        type="button"
                        className={btnCls}
                        onClick={() => setBidLot(l)}
                        disabled={registriesPending}
                        aria-busy={registriesPending || undefined}
                        title={registriesPending ? 'Loading the crop registry…' : undefined}
                      >
                        <BusyLabel busy={registriesPending} label={t('web.market.placeBid', 'Place a bid')} />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        {/* ── Place Bid = a demand pre-filled for this lot ──────── */}
        {bidLot && (
          <Modal
            label={`Place bid on ${bidLot.remainingKg} kilograms of ${bidLot.commodityName}`}
            onClose={() => setBidLot(null)}
          >
              <div className="certificate overflow-hidden bg-[var(--paper)]">
                <div className="plate on-dark flex items-center justify-between gap-4 px-6 py-5">
                  <div>
                    <p className="headline text-2xl">
                      {t('web.market.bidTitle', 'Bid on {kg} kg of {crop}', { kg: bidLot.remainingKg, crop: bidLot.commodityName.toLowerCase() })}
                    </p>
                    <p className="mt-1.5 text-xs leading-relaxed text-[var(--ink-2)]">
                      {t(
                        'web.market.bidExplain',
                        'We send your offer to {farmer}. Your money is held only if they accept.',
                        { farmer: sellerName(bidLot.farmerName) },
                      )}
                    </p>
                  </div>
                  <button type="button" className={plateBtnCls} onClick={() => setBidLot(null)}>
                    {t('web.common.close', 'Close')}
                  </button>
                </div>
                <div className="p-5">
                  {registries ? (
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
                        toast(
                          t('web.market.bidSent', 'Offer sent to {farmer}. We will tell you when they answer.', {
                            farmer: sellerName(bidLot.farmerName),
                          }),
                        );
                        setBidLot(null);
                        navigate('/orders');
                      }}
                      onCancel={() => setBidLot(null)}
                    />
                  ) : (
                    /* The trigger already waits out the first load, so an absent
                       registry here means the fetch failed — say so and hand over
                       the one control that fixes it, never an empty dialog. */
                    <div className="py-8 text-center">
                      <p className="text-sm text-[var(--ink-6)]">Couldn't load the crop registry — the bid form needs it.</p>
                      <button
                        type="button"
                        className={`${btnGhostCls} mt-3`}
                        onClick={() => refetchRegistries()}
                        disabled={registriesFetching}
                        aria-busy={registriesFetching || undefined}
                      >
                        <BusyLabel busy={registriesFetching} label="Try again" busyLabel="Retrying…" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
          </Modal>
        )}
      </div>
    </div>
  );
}
