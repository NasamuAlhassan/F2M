import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ghs, shortDate, type Demand, type Registries } from '../api';
import { NewDemandForm } from '../components/DemandForm';
import { MatchBanner, MatchRow, SimulationDrawer, type Feed } from '../components/engine';
import { btnCls, Card, CROP_EMOJI, numCls, StateBadge, tableCls, tdCls, thCls } from '../components/ui';

/**
 * Orders = the buyer's order book and the engine working it, on one page:
 * my demands (compact table, form in a modal), the AI Match banner when an
 * offer is live, and the intent feed the engine matches against.
 */
export function OrdersPage() {
  const queryClient = useQueryClient();
  const { data: registries } = useQuery({ queryKey: ['registries'], queryFn: () => api<Registries>('/api/registries') });
  const { data: demandData } = useQuery({
    queryKey: ['demands'],
    queryFn: () => api<{ demands: Demand[] }>('/api/demands'),
    refetchInterval: 5000,
  });
  const { data: feed } = useQuery({
    queryKey: ['engine-feed'],
    queryFn: () => api<Feed>('/api/engine/feed'),
    refetchInterval: 5000,
  });

  const [showForm, setShowForm] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commodityById = useMemo(
    () => new Map((registries?.commodities ?? []).map((c) => [c.id, c])),
    [registries],
  );

  const simulate = useMutation({
    mutationFn: (contractId: string) =>
      api('/api/engine/simulate-accept', { method: 'POST', body: JSON.stringify({ contractId }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['engine-feed'] }),
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed'),
  });

  const newestOffered = feed?.matches.find((m) => m.state === 'OFFERED') ?? null;
  const restMatches = (feed?.matches ?? []).filter((m) => m !== newestOffered).slice(0, 5);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-gray-900">Orders</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Your buy orders and the engine working them — matches reserve the lot and alert the farmer instantly
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-3">
          <span className="flex items-center gap-1.5 rounded-full border border-green-300 bg-green-50 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-green-700">
            <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-green-600" />
            Engine live
          </span>
          <button className={btnCls} onClick={() => setShowForm(true)}>
            + New Demand
          </button>
        </div>
      </div>
      {error && (
        <p
          className="mb-4 cursor-pointer rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700"
          onClick={() => setError(null)}
        >
          {error}
        </p>
      )}

      {newestOffered && (
        <MatchBanner
          match={newestOffered}
          simulateEnabled={feed?.simulateEnabled ?? false}
          onPreview={() => setPreview(newestOffered.contractId)}
          onSimulate={() => simulate.mutate(newestOffered.contractId)}
          simulating={simulate.isPending}
        />
      )}

      <div className="mb-4 overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
        {!demandData?.demands.length ? (
          <div className="flex flex-col items-center justify-center py-14 text-gray-400">
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
              {demandData.demands.map((d) => {
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
                    <td className={`${tdCls} font-extrabold text-[#1B4332]`}>
                      {ghs(d.priceTerms[d.minBand as 'A' | 'B' | 'C'] ?? 0)}
                      <span className="text-[10px] font-medium text-gray-400">/kg</span>
                    </td>
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
                        Matches
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`Recent Engine Matches (${restMatches.length})`}>
          {restMatches.length === 0 && !newestOffered ? (
            <p className="text-sm text-gray-400">No matches yet. Post a demand — the engine takes it from there.</p>
          ) : (
            restMatches.map((m) => (
              <MatchRow
                key={m.contractId}
                match={m}
                simulateEnabled={feed?.simulateEnabled ?? false}
                onPreview={() => setPreview(m.contractId)}
                onSimulate={() => simulate.mutate(m.contractId)}
                simulating={simulate.isPending}
              />
            ))
          )}
        </Card>

        <Card title={`Intent Feed — open produce listings (${feed?.lots.length ?? 0})`}>
          {!feed?.lots.length ? (
            <p className="text-sm text-gray-400">No open produce listings right now.</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {feed.lots.slice(0, 6).map((l) => (
                <div key={l.lotCode} className="py-2 text-sm">
                  <p className="font-bold text-gray-900">
                    {l.remainingKg}kg {l.commodityName}
                    <span className="mono ml-2 text-[10px] font-medium text-gray-400">{l.lotCode}</span>
                  </p>
                  <p className="text-xs text-gray-500">
                    {l.farmerName} · declared {l.declaredBand} · {l.regionCode} · ready {shortDate(l.readyDate)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {showForm && registries && (
        <div className="fixed inset-0 z-40 overflow-y-auto" onClick={() => setShowForm(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative mx-auto my-8 w-full max-w-3xl px-4" onClick={(e) => e.stopPropagation()}>
            <div className="overflow-hidden rounded-2xl bg-white shadow-2xl">
              <div className="flex items-center justify-between bg-[#1B4332] px-6 py-4">
                <div>
                  <p className="text-sm font-bold text-white">New Demand</p>
                  <p className="text-[11px] text-green-300">the engine starts matching the moment you post</p>
                </div>
                <button
                  className="rounded-full bg-white/10 px-2.5 py-1 text-white hover:bg-white/20"
                  onClick={() => setShowForm(false)}
                >
                  ✕
                </button>
              </div>
              <div className="p-4">
                <NewDemandForm
                  registries={registries}
                  onDone={() => setShowForm(false)}
                  onCancel={() => setShowForm(false)}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {preview && <SimulationDrawer contractId={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
