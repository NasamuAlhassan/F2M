import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ghs, type MarketLot, type Registries } from '../api';
import { CROP_EMOJI, GradeBadge, VEHICLE_EMOJI } from '../components/ui';

const BAND_ORDER: Record<string, number> = { A: 3, B: 2, C: 1 };

/**
 * Frame 10: bundle small same-crop lots toward one truck. "Dispatch" here is a
 * pool bid — ONE demand sized to the selection; the engine already splits a
 * demand across lots, so each farmer still consents to their own offer (D-034).
 * Rendered as the Marketplace's "Pool builder" mode since M26.
 */
export function PoolBuilder() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: registries } = useQuery({ queryKey: ['registries'], queryFn: () => api<Registries>('/api/registries') });
  const { data } = useQuery({
    queryKey: ['market-lots'],
    queryFn: () => api<{ lots: MarketLot[] }>('/api/market/lots'),
    refetchInterval: 10000,
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
      {/* Sidebar: truck + capacity + pool summary */}
      <aside className="w-full flex-shrink-0 lg:w-72">
        <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
          <div className="bg-[#1B4332] px-5 py-4">
            <div className="text-base font-extrabold text-white">Co-op Consolidation</div>
            <div className="mt-0.5 text-[11px] text-green-300">Bundle small lots into one dispatch</div>
          </div>
          <div className="flex flex-col gap-5 p-5">
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-gray-400">Target Truck</p>
              {vehicles.map((v) => (
                <button
                  key={v.code}
                  onClick={() => setTruckCode(v.code)}
                  className={`mb-2 flex w-full items-center gap-3 rounded-xl border-2 p-3 text-left transition-colors ${
                    truck?.code === v.code ? 'border-[#1B4332] bg-green-50' : 'border-gray-100 hover:border-gray-300'
                  }`}
                >
                  <span className="text-xl">{VEHICLE_EMOJI[v.code] ?? '🚚'}</span>
                  <span>
                    <span className={`block text-sm font-bold ${truck?.code === v.code ? 'text-[#1B4332]' : 'text-gray-800'}`}>
                      {v.name}
                    </span>
                    <span className="mono block text-[10px] text-gray-500">up to {v.capacityKg.toLocaleString()} kg</span>
                  </span>
                </button>
              ))}
            </div>

            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-gray-400">Load Capacity</p>
              <div className="mb-1.5 flex items-end justify-between">
                <span className={`mono text-2xl font-extrabold ${overload ? 'text-red-600' : full ? 'text-green-700' : 'text-gray-800'}`}>
                  {pct}%
                </span>
                <span className="mono text-xs text-gray-400">
                  {totalKg.toLocaleString()} / {capacity.toLocaleString()} kg
                </span>
              </div>
              <div className="h-4 overflow-hidden rounded-full border border-gray-200 bg-gray-100">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    overload ? 'bg-red-500' : full ? 'bg-green-600' : 'bg-[#D97706]'
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {overload && <p className="mt-1 text-[10px] font-semibold text-red-600">⚠ Exceeds truck capacity — remove lots</p>}
              {full && <p className="mt-1 text-[10px] font-semibold text-green-600">✓ Good load — ready to bid</p>}
            </div>

            <div className="flex flex-col gap-1.5 border-t border-gray-100 pt-4">
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
                  <span className="text-gray-400">{k}</span>
                  <span className="mono font-semibold text-gray-800">{v}</span>
                </div>
              ))}
            </div>

            {error && (
              <p
                className="cursor-pointer rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700"
                onClick={() => setError(null)}
              >
                {error}
              </p>
            )}
            <button
              disabled={chosen.length === 0 || overload || poolBid.isPending}
              onClick={() => poolBid.mutate()}
              className={`rounded-xl py-2.5 text-sm font-bold transition-colors ${
                chosen.length && !overload
                  ? 'bg-[#1B4332] text-white hover:bg-green-900'
                  : 'cursor-not-allowed bg-gray-200 text-gray-500'
              }`}
            >
              {poolBid.isPending
                ? 'Posting pool bid…'
                : chosen.length && !overload
                  ? `Place Pool Bid — ${totalKg.toLocaleString()} kg`
                  : 'Select lots to build a load'}
            </button>
            <p className="text-[10px] leading-relaxed text-gray-400">
              A pool bid posts one demand for the whole load. The engine offers each farmer their share — every farmer
              accepts (or declines) their own contract, then transport dispatches per contract.
            </p>
          </div>
        </div>
      </aside>

      {/* Board */}
      <div className="min-w-0 flex-1">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-gray-500">
            Select same-crop lots to consolidate into one truck-sized pool bid — each farmer still accepts their own
            offer
          </p>
          <div className="flex gap-1.5">
            {commodityCodes.map((code) => (
              <button
                key={code}
                onClick={() => {
                  setCommodity(code);
                  setSelected(new Set());
                }}
                className={`rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
                  activeCommodity === code
                    ? 'border-[#1B4332] bg-[#1B4332] text-white'
                    : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                }`}
              >
                {CROP_EMOJI[code] ?? ''} {code}
              </button>
            ))}
          </div>
        </div>

        {lots.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-gray-100 bg-white py-20 text-gray-400 shadow-sm">
            <div className="mb-2 text-4xl">🌾</div>
            <p className="font-semibold text-gray-500">No open lots to consolidate</p>
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
                  className={`rounded-xl border-2 bg-white p-4 shadow-sm transition-all ${
                    sel
                      ? 'border-[#1B4332] bg-green-50'
                      : wouldOverload
                        ? 'cursor-not-allowed border-gray-100 opacity-40'
                        : 'cursor-pointer border-gray-100 hover:border-gray-300 hover:shadow-md'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                        sel ? 'border-[#1B4332] bg-[#1B4332]' : 'border-gray-300'
                      }`}
                    >
                      {sel ? (
                        <span className="text-sm font-extrabold text-white">✓</span>
                      ) : (
                        <span className="text-lg">{CROP_EMOJI[lot.commodityCode] ?? '📦'}</span>
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-gray-900">{lot.farmerName ?? 'Farmer'}</span>
                        <GradeBadge grade={lot.declaredBand} />
                      </div>
                      <div className="mt-0.5 text-xs text-gray-500">
                        {lot.district ? `${lot.district}, ` : ''}
                        {lot.regionName} · {lot.distanceKm} km · <span className="mono">{lot.lotCode}</span>
                        {lot.farmerPhone && (
                          <>
                            {' · '}
                            <a href={`tel:${lot.farmerPhone}`} className="mono font-semibold text-[#B45309] hover:underline">
                              📞 {lot.farmerPhone}
                            </a>
                          </>
                        )}
                      </div>
                      <div className="mt-2 flex items-center gap-5">
                        <div>
                          <div className="mono text-lg font-extrabold text-gray-800">{lot.remainingKg.toLocaleString()}</div>
                          <div className="text-[10px] text-gray-400">kg available</div>
                        </div>
                        <div>
                          <div className="text-base font-bold text-[#1B4332]">
                            {lot.pricePerUnit !== null ? ghs(lot.pricePerUnit) : '—'}
                          </div>
                          <div className="text-[10px] text-gray-400">/ {lot.unitName}</div>
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
