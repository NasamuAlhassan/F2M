import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ghs, placeName, sellerName, type MarketLot, type Registries } from '../api';
import { POLL } from '../poll';
import { CropMark, Glyph, VehicleMark } from '../components/engrave';
import { btnCls, BusyLabel, choiceCls, EmptyState, ErrorStamp, GradeBadge, LoadGate, textLinkCls } from '../components/ui';
import { pillItemCls, SlidingPillGroup } from '../components/SlidingPill';
import { useT } from '../lib/i18n';

const BAND_ORDER: Record<string, number> = { A: 3, B: 2, C: 1 };

/**
 * The Pool Builder: bundle small same-crop lots toward one truck. "Dispatch"
 * is a pool bid — ONE demand sized to the selection; the engine splits it, so
 * each farmer still consents to their own offer (D-034).
 */
export function PoolBuilder() {
  const { t } = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: registries } = useQuery({ queryKey: ['registries'], queryFn: () => api<Registries>('/api/registries') });
  const { data, isError, isFetching, refetch } = useQuery({
    queryKey: ['market-lots'],
    queryFn: () => api<{ lots: MarketLot[] }>('/api/market/lots'),
    refetchInterval: POLL.ambient,
  });

  const all = data?.lots ?? [];
  const commodityCodes = useMemo(() => [...new Set(all.map((l) => l.commodityCode))], [all]);
  const commodityNames = useMemo(() => new Map(all.map((l) => [l.commodityCode, l.commodityName])), [all]);
  const [commodity, setCommodity] = useState<string | null>(null);
  const activeCommodity = commodity ?? commodityCodes[0] ?? null;
  const lots = all.filter((l) => l.commodityCode === activeCommodity);

  const vehicles = registries?.vehicleClasses ?? [];
  const [truckCode, setTruckCode] = useState<string | null>(null);
  const truck = vehicles.find((v) => v.code === (truckCode ?? 'light_truck')) ?? vehicles[vehicles.length - 1];

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const chosen = lots.filter((l) => selected.has(l.id));
  const totalKg = Math.round(chosen.reduce((s, l) => s + l.remainingKg, 0) * 10) / 10;
  const capacity = truck?.capacityKg ?? 0;
  const pct = capacity ? Math.min(100, Math.round((totalKg / capacity) * 100)) : 0;
  const overload = totalKg > capacity;
  const full = pct >= 80 && !overload;
  const value = chosen.reduce((s, l) => s + (l.pricePerKg ?? 0) * l.remainingKg, 0);
  const maxKm = chosen.length ? Math.max(...chosen.map((l) => l.distanceKm)) : 0;
  const logisticsEst = truck && chosen.length ? truck.baseFee + Math.round(truck.perKmRate * maxKm) : 0;
  const minBand = chosen.length
    ? chosen.reduce((lowest, l) => ((BAND_ORDER[l.declaredBand] ?? 0) < (BAND_ORDER[lowest] ?? 0) ? l.declaredBand : lowest), 'A')
    : 'B';

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const avgPerKg = chosen.length ? Math.round(value / Math.max(1, totalKg)) : 0;
  const DAY = 86400000;
  const poolBid = useMutation({
    mutationFn: () => {
      // Whole pool must clear the pickiest perishable clock — use the tightest window.
      const maxDays = Math.min(
        ...chosen.map((l) => registries?.commodities.find((c) => c.code === l.commodityCode)?.clock.maxWindowDays ?? 7),
      );
      return api('/api/demands', {
        method: 'POST',
        body: JSON.stringify({
          commodityCode: activeCommodity,
          quantityKg: totalKg,
          minBand,
          basePricePerKg: avgPerKg || undefined,
          windowStart: Date.now(),
          windowEnd: Date.now() + Math.max(1, maxDays - 1) * DAY,
          regionCode: 'GREATER_ACCRA',
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['demands'] });
      navigate('/orders');
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : t('web.pool.failed', 'Could not post the order. Please try again.')),
  });

  const ready = chosen.length > 0 && !overload;

  return (
    <div>
      <div className="mb-5">
        <h1 className="headline text-3xl text-[var(--ink)] sm:text-4xl">
          {t('web.pool.title', 'Pool small lots')}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--ink-6)]">
          {t(
            'web.pool.subtitle',
            'Pick small lots of the same crop to fill one vehicle. Each farmer still says yes or no to their own offer.',
          )}
        </p>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* ── The load summary ─────────────────────────────── */}
        <aside className="w-full flex-shrink-0 lg:w-72" aria-label={t('web.pool.summaryLabel', 'Your load')}>
          <div className="certificate overflow-hidden bg-[var(--paper-lift)]">
            <div className="plate on-dark px-5 py-5">
              <p className="headline text-2xl">{t('web.pool.plateTitle', 'Your load')}</p>
              <p className="mt-1 text-sm text-[var(--ink-2)]">{t('web.pool.plateEyebrow', 'One vehicle, many farmers')}</p>
            </div>
            <div className="flex flex-col gap-5 p-5">
              <div role="group" aria-labelledby="pool-vehicle-label">
                <p id="pool-vehicle-label" className="rule-double smallcaps mb-2 pb-1.5 text-[var(--ink-6)]">
                  {t('web.pool.vehicle', 'Choose a vehicle')}
                </p>
                {vehicles.map((v) => (
                  <button
                    key={v.code}
                    type="button"
                    aria-pressed={truck?.code === v.code}
                    onClick={() => setTruckCode(v.code)}
                    className={`${choiceCls(truck?.code === v.code)} mb-2`}
                  >
                    <VehicleMark code={v.code} className="h-8 w-8 flex-shrink-0 text-[var(--ink)]" />
                    <span className="flex-1">
                      <span className="block text-sm font-bold text-[var(--ink)]">{v.name}</span>
                      <span className="serial block text-[11px] text-[var(--ink-6)]">
                        {t('web.pool.upTo', 'up to {kg} kg', { kg: v.capacityKg.toLocaleString() })}
                      </span>
                    </span>
                    {truck?.code === v.code && <Glyph name="check" className="h-4 w-4 flex-shrink-0 text-[var(--forest-deep)]" />}
                  </button>
                ))}
              </div>

              <div>
                <p className="rule-double smallcaps mb-2 pb-1.5 text-[var(--ink-6)]">{t('web.pool.howFull', 'How full')}</p>
                <div className="mb-1.5 flex items-end justify-between">
                  <span
                    className={`serial text-2xl font-bold ${
                      overload ? 'text-[var(--stamp-deep)]' : full ? 'text-[var(--forest-deep)]' : 'text-[var(--ink-7)]'
                    }`}
                  >
                    {pct}%
                  </span>
                  <span className="serial text-xs text-[var(--ink-6)]">
                    {totalKg.toLocaleString()} / {capacity.toLocaleString()} kg
                  </span>
                </div>
                <div aria-hidden="true" className="h-4 rounded-full border border-[var(--ink-3)] bg-[var(--paper)] p-[2px]">
                  <div
                    className={`h-full rounded-full transition-[width,background-color] duration-[var(--dur-base)] ${
                      overload ? 'bg-[var(--stamp)]' : full ? 'bg-[var(--forest)]' : 'bg-[var(--gold)]'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div aria-live="polite">
                  {overload && (
                    <p className="mt-1.5 text-[11px] font-semibold text-[var(--stamp-deep)]">
                      {t('web.pool.overload', 'Too heavy for this vehicle. Remove a lot.')}
                    </p>
                  )}
                  {full && (
                    <p className="mt-1.5 text-[11px] font-semibold text-[var(--forest-deep)]">
                      {t('web.pool.goodLoad', 'Good load. Ready to post.')}
                    </p>
                  )}
                </div>
              </div>

              <dl className="flex flex-col gap-1.5 border-t border-[var(--ink-2)] pt-4">
                {(
                  [
                    [t('web.pool.sumLots', 'Lots picked'), `${chosen.length} / ${lots.length}`],
                    [t('web.pool.sumWeight', 'Total weight'), `${totalKg.toLocaleString()} kg`],
                    [t('web.pool.sumValue', 'Value of produce'), ghs(Math.round(value))],
                    [t('web.pool.sumTransport', 'Transport, about'), chosen.length ? ghs(logisticsEst) : '—'],
                    [t('web.pool.sumGrade', 'Lowest grade in load'), minBand],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3 text-xs">
                    <dt className="smallcaps text-[var(--ink-6)]">{k}</dt>
                    <dd className="serial text-right font-semibold text-[var(--ink)]">{v}</dd>
                  </div>
                ))}
              </dl>

              {error && <ErrorStamp message={error} onDismiss={() => setError(null)} />}
              <button
                type="button"
                disabled={!ready || poolBid.isPending}
                aria-busy={poolBid.isPending || undefined}
                onClick={() => poolBid.mutate()}
                className={`${btnCls} w-full py-2.5`}
              >
                <BusyLabel
                  busy={poolBid.isPending}
                  label={
                    ready
                      ? t('web.pool.post', 'Post one order for {kg} kg', { kg: totalKg.toLocaleString() })
                      : t('web.pool.pickFirst', 'Pick lots to build a load')
                  }
                  busyLabel={t('web.pool.posting', 'Posting your order…')}
                />
              </button>
              <p className="text-[11px] leading-relaxed text-[var(--ink-6)]">
                {t(
                  'web.pool.explain',
                  'This posts one order for the whole load. We send each farmer an offer for their part, and each one says yes or no. A driver is then booked for each deal.',
                )}
              </p>
            </div>
          </div>
        </aside>

        {/* ── The board ────────────────────────────────────────── */}
        <div className="min-w-0 flex-1">
          {commodityCodes.length > 1 && (
            <SlidingPillGroup
              watch={activeCommodity}
              role="group"
              aria-label={t('web.pool.cropFilter', 'Crop')}
              className="mb-4 inline-flex flex-wrap gap-1 rounded-full border border-[var(--ink-2)] bg-[var(--paper-lift)] p-1 shadow-sm"
            >
              {commodityCodes.map((code) => (
                <button
                  key={code}
                  type="button"
                  aria-pressed={activeCommodity === code}
                  onClick={() => {
                    setCommodity(code);
                    setSelected(new Set());
                  }}
                  className={pillItemCls(activeCommodity === code)}
                >
                  <CropMark code={code} className="h-4 w-4" />
                  {commodityNames.get(code) ?? code}
                </button>
              ))}
            </SlidingPillGroup>
          )}

          {!data ? (
            <div className="certificate bg-[var(--paper-lift)] p-5">
              <LoadGate isError={isError} retrying={isFetching} onRetry={() => void refetch()} label={t('web.pool.loadLabel', 'the lots on the market')} />
            </div>
          ) : lots.length === 0 ? (
            <EmptyState
              icon={<Glyph name="scale" className="h-7 w-7" />}
              title={t('web.pool.emptyTitle', 'No lots to pool right now')}
              body={t(
                'web.pool.emptyBody',
                'When farmers list produce, you can pick small lots of the same crop here to fill one vehicle.',
              )}
            />
          ) : (
            <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {lots.map((lot) => {
                const sel = selected.has(lot.id);
                const wouldOverload = !sel && totalKg + lot.remainingKg > capacity;
                const place = placeName(lot.district);
                return (
                  <li key={lot.id}>
                    {/* A real checkbox under the card: Space toggles it, a screen
                        reader hears checked/unchecked, and the phone link inside
                        stays its own target (a label never fires for a link). */}
                    <label
                      className={`certificate block h-full p-4 transition-colors has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-[var(--forest-night)] ${
                        sel
                          ? 'cursor-pointer bg-[var(--gold-wash)]'
                          : wouldOverload
                            ? 'cursor-not-allowed bg-[var(--paper-deep)]'
                            : 'cursor-pointer bg-[var(--paper-lift)] hover:bg-[var(--paper)] active:bg-[var(--paper-deep)]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={sel}
                        disabled={wouldOverload}
                        onChange={() => toggle(lot.id)}
                        aria-label={t('web.pool.lotLabel', '{name}, {kg} kg, grade {g}', {
                          name: sellerName(lot.farmerName),
                          kg: lot.remainingKg.toLocaleString(),
                          g: lot.declaredBand,
                        })}
                      />
                      <span className="flex items-start gap-3">
                        <span
                          aria-hidden="true"
                          className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors ${
                            sel ? 'border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]' : 'border-[var(--ink-3)] text-[var(--ink-6)]'
                          }`}
                        >
                          {sel ? <Glyph name="check" className="h-4 w-4" /> : <CropMark code={lot.commodityCode} className="h-5 w-5" />}
                        </span>
                        <span className="block flex-1">
                          <span className="flex items-center gap-2">
                            <span className="text-sm font-bold text-[var(--ink)]">{sellerName(lot.farmerName)}</span>
                            <GradeBadge grade={lot.declaredBand} />
                          </span>
                          <span className="mt-0.5 block text-xs text-[var(--ink-6)]">
                            {place ? `${place}, ` : ''}
                            {lot.regionName} · {lot.distanceKm} km · <span className="serial">{lot.lotCode}</span>
                            {lot.farmerPhone && (
                              <>
                                {' · '}
                                <a
                                  href={`tel:${lot.farmerPhone}`}
                                  className={`${textLinkCls} serial font-semibold text-[var(--forest-deep)]`}
                                  onClick={(e) => e.stopPropagation()}
                                  aria-label={t('web.pool.callFarmer', 'Call {name} on {phone}', {
                                    name: sellerName(lot.farmerName),
                                    phone: lot.farmerPhone,
                                  })}
                                >
                                  {lot.farmerPhone}
                                </a>
                              </>
                            )}
                          </span>
                          <span className="mt-2 flex items-center gap-5">
                            <span className="block">
                              <span className="serial block text-lg font-bold text-[var(--ink)]">
                                {lot.remainingKg.toLocaleString()}
                              </span>
                              <span className="smallcaps block text-[var(--ink-6)]">{t('web.pool.kgAvailable', 'kg for sale')}</span>
                            </span>
                            <span className="block">
                              <span className="serial block text-base font-bold text-[var(--gold-deep)]">
                                {lot.pricePerUnit !== null ? ghs(lot.pricePerUnit) : '—'}
                              </span>
                              <span className="smallcaps block text-[var(--ink-6)]">
                                {t('web.pool.perUnit', 'per {unit}', { unit: lot.unitName })}
                              </span>
                            </span>
                          </span>
                          {wouldOverload && (
                            <span className="mt-2 block text-[11px] font-semibold text-[var(--ink-6)]">
                              {t('web.pool.tooHeavy', 'Too heavy to add to this vehicle')}
                            </span>
                          )}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
