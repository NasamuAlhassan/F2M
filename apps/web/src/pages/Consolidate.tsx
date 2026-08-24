import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ghs, placeName, sellerName, type MarketLot, type Registries } from '../api';
import { POLL } from '../poll';
import { CropMark, Glyph, VehicleMark } from '../components/engrave';
import { ErrorStamp, GradeBadge } from '../components/ui';

const BAND_ORDER: Record<string, number> = { A: 3, B: 2, C: 1 };

/**
 * The Pool Builder: bundle small same-crop lots toward one truck. "Dispatch"
 * is a pool bid — ONE demand sized to the selection; the engine splits it, so
 * each farmer still consents to their own offer (D-034).
 */
export function PoolBuilder() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: registries } = useQuery({ queryKey: ['registries'], queryFn: () => api<Registries>('/api/registries') });
  const { data } = useQuery({
    queryKey: ['market-lots'],
    queryFn: () => api<{ lots: MarketLot[] }>('/api/market/lots'),
    refetchInterval: POLL.ambient,
  });

  const all = data?.lots ?? [];
  const commodityCodes = useMemo(() => [...new Set(all.map((l) => l.commodityCode))], [all]);
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
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed'),
  });

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      {/* ── The waybill manifest ─────────────────────────────── */}
      <aside className="w-full flex-shrink-0 lg:w-72">
        <div className="certificate overflow-hidden bg-[var(--paper-lift)]">
          <div className="plate px-5 py-4">
            <div className="display text-base font-semibold tracking-[0.08em]">CONSOLIDATION</div>
            <div className="smallcaps mt-0.5 text-[var(--ink-3)]">bundle small lots into one dispatch</div>
          </div>
          <div className="guilloche h-[10px] w-full bg-[var(--ink)] opacity-90" />
          <div className="flex flex-col gap-5 p-5">
            <div>
              <p className="rule-double smallcaps mb-2 pb-1.5 text-[var(--ink-6)]">Target Truck</p>
              {vehicles.map((v) => (
                <button
                  key={v.code}
                  onClick={() => setTruckCode(v.code)}
                  className={`mb-2 flex w-full items-center gap-3 border p-3 text-left transition-colors ${
                    truck?.code === v.code
                      ? 'border-[var(--ink)] bg-[var(--gold-wash)]'
                      : 'border-[var(--ink-2)] hover:border-[var(--ink-5)]'
                  }`}
                >
                  <VehicleMark code={v.code} className="h-8 w-8 flex-shrink-0 text-[var(--ink)]" />
                  <span>
                    <span className="block text-sm font-bold text-[var(--ink)]">{v.name}</span>
                    <span className="serial block text-[11px] text-[var(--ink-6)]">
                      up to {v.capacityKg.toLocaleString()} kg
                    </span>
                  </span>
                </button>
              ))}
            </div>

            <div>
              <p className="rule-double smallcaps mb-2 pb-1.5 text-[var(--ink-6)]">Load Capacity</p>
              <div className="mb-1.5 flex items-end justify-between">
                <span
                  className={`serial text-2xl font-bold ${
                    overload ? 'text-[var(--stamp)]' : full ? 'text-[var(--ink)]' : 'text-[var(--ink-7)]'
                  }`}
                >
                  {pct}%
                </span>
                <span className="serial text-xs text-[var(--ink-6)]">
                  {totalKg.toLocaleString()} / {capacity.toLocaleString()} kg
                </span>
              </div>
              <div className="h-4 border border-[var(--ink-3)] bg-[var(--paper)] p-[2px]">
                <div
                  className={`h-full transition-[width,background-color] duration-500 ${
                    overload ? 'bg-[var(--stamp)]' : full ? 'bg-[var(--ink)]' : 'bg-[var(--gold)]'
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {overload && (
                <p className="mt-1.5 text-[11px] font-semibold text-[var(--stamp)]">Exceeds truck capacity — remove lots</p>
              )}
              {full && <p className="mt-1.5 text-[11px] font-semibold text-[var(--ink)]">Good load — ready to bid</p>}
            </div>

            <div className="flex flex-col gap-1.5 border-t border-[var(--ink-2)] pt-4">
              {(
                [
                  ['Lots selected', `${chosen.length} / ${lots.length}`],
                  ['Total cargo', `${totalKg.toLocaleString()} kg`],
                  ['Estimated value', ghs(Math.round(value))],
                  ['Logistics est.', chosen.length ? ghs(logisticsEst) : '—'],
                  ['Pool min grade', minBand],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="flex justify-between text-xs">
                  <span className="smallcaps text-[var(--ink-6)]">{k}</span>
                  <span className="serial font-semibold text-[var(--ink)]">{v}</span>
                </div>
              ))}
            </div>

            {error && (
              <ErrorStamp message={error} onDismiss={() => setError(null)} />
            )}
            <button
              disabled={chosen.length === 0 || overload || poolBid.isPending}
              onClick={() => poolBid.mutate()}
              className={`rounded-lg py-2.5 text-sm font-semibold transition-colors ${
                chosen.length && !overload
                  ? 'bg-[var(--ink)] text-[var(--paper)] hover:bg-[var(--ink-8)]'
                  : 'cursor-not-allowed bg-[var(--ink-2)] text-[var(--ink-6)]'
              }`}
            >
              {poolBid.isPending
                ? 'Posting pool bid…'
                : chosen.length && !overload
                  ? `Place Pool Bid — ${totalKg.toLocaleString()} kg`
                  : 'Select lots to build a load'}
            </button>
            <p className="text-[11px] leading-relaxed text-[var(--ink-6)]">
              A pool bid posts one demand for the whole load. The engine offers each farmer their share — every farmer
              accepts their own contract, then transport dispatches per contract.
            </p>
          </div>
        </div>
      </aside>

      {/* ── The board ────────────────────────────────────────── */}
      <div className="min-w-0 flex-1">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <p className="text-sm text-[var(--ink-6)]">
            Select same-crop lots to consolidate into one truck-sized pool bid — each farmer still accepts their own
            offer
          </p>
          <div className="flex border border-[var(--ink-3)]">
            {commodityCodes.map((code) => (
              <button
                key={code}
                onClick={() => {
                  setCommodity(code);
                  setSelected(new Set());
                }}
                className={`smallcaps flex items-center gap-1.5 px-3 py-1.5 transition-colors ${
                  activeCommodity === code
                    ? 'bg-[var(--ink)] text-[var(--paper)]'
                    : 'bg-[var(--paper-lift)] text-[var(--ink-6)] hover:text-[var(--ink)]'
                }`}
              >
                <CropMark code={code} className="h-4 w-4" />
                {code}
              </button>
            ))}
          </div>
        </div>

        {lots.length === 0 ? (
          <div className="certificate flex flex-col items-center justify-center bg-[var(--paper-lift)] py-20">
            <Glyph name="scale" className="mb-3 h-12 w-12 text-[var(--ink-4)]" />
            <p className="font-semibold text-[var(--ink-6)]">No open lots to consolidate</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {lots.map((lot) => {
              const sel = selected.has(lot.id);
              const wouldOverload = !sel && totalKg + lot.remainingKg > capacity;
              return (
                <div
                  key={lot.id}
                  onClick={() => !wouldOverload && toggle(lot.id)}
                  className={`certificate p-4 transition-colors ${
                    sel
                      ? 'bg-[var(--gold-wash)]'
                      : wouldOverload
                        ? 'cursor-not-allowed bg-[var(--paper-lift)] opacity-40'
                        : 'cursor-pointer bg-[var(--paper-lift)] hover:bg-[var(--paper)]'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors ${
                        sel ? 'border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]' : 'border-[var(--ink-3)] text-[var(--ink-6)]'
                      }`}
                    >
                      {sel ? <Glyph name="check" className="h-4 w-4" /> : <CropMark code={lot.commodityCode} className="h-5 w-5" />}
                    </span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-[var(--ink)]">{sellerName(lot.farmerName)}</span>
                        <GradeBadge grade={lot.declaredBand} />
                      </div>
                      <div className="mt-0.5 text-xs text-[var(--ink-6)]">
                        {placeName(lot.district) ? `${placeName(lot.district)}, ` : ''}
                        {lot.regionName} · {lot.distanceKm} km · <span className="serial">{lot.lotCode}</span>
                        {lot.farmerPhone && (
                          <>
                            {' · '}
                            <a
                              href={`tel:${lot.farmerPhone}`}
                              className="serial font-semibold text-[var(--stamp)] hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {lot.farmerPhone}
                            </a>
                          </>
                        )}
                      </div>
                      <div className="mt-2 flex items-center gap-5">
                        <div>
                          <div className="serial text-lg font-bold text-[var(--ink)]">{lot.remainingKg.toLocaleString()}</div>
                          <div className="smallcaps text-[var(--ink-6)]">kg available</div>
                        </div>
                        <div>
                          <div className="serial text-base font-bold text-[var(--gold-deep)]">
                            {lot.pricePerUnit !== null ? ghs(lot.pricePerUnit) : '—'}
                          </div>
                          <div className="smallcaps text-[var(--ink-6)]">/ {lot.unitName}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
