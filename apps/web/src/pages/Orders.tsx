import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ghs, shortDate, type Demand, type Registries } from '../api';
import { POLL } from '../poll';
import { NewDemandForm } from '../components/DemandForm';
import { MatchBanner, MatchRow, SimulationDrawer, type Feed } from '../components/engine';
import { CropMark } from '../components/engrave';
import { Modal } from '../components/Modal';
import { btnCls, Card, ErrorStamp, numCls, StateBadge, tableCls, TableScroll, tdCls, thCls } from '../components/ui';

/**
 * Orders = the buyer's order book and the engine working it, on one page:
 * my demands (compact ledger, form in a modal), the advice-of-match notice
 * when an offer is live, and the intent feed the engine matches against.
 */
export function OrdersPage() {
  const queryClient = useQueryClient();
  const { data: registries } = useQuery({ queryKey: ['registries'], queryFn: () => api<Registries>('/api/registries') });
  const { data: demandData } = useQuery({
    queryKey: ['demands'],
    queryFn: () => api<{ demands: Demand[] }>('/api/demands'),
    refetchInterval: POLL.active,
  });
  const { data: feed } = useQuery({
    queryKey: ['engine-feed'],
    queryFn: () => api<Feed>('/api/engine/feed'),
    refetchInterval: POLL.active,
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
          <h1 className="display text-xl font-semibold tracking-[0.05em] text-[var(--ink)]">Orders</h1>
          <p className="mt-1 text-sm text-[var(--ink-6)]">
            Your buy orders and the engine working them — a match reserves the lot and alerts the farmer instantly
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-3">
          <span className="stamp flex items-center gap-1.5 px-2 py-1 text-[11px] text-[var(--ink)]">
            <span className="ember inline-block h-1.5 w-1.5 rounded-full bg-[var(--gold)]" />
            Engine live
          </span>
          <button className={btnCls} onClick={() => setShowForm(true)}>
            + New Demand
          </button>
        </div>
      </div>
      {error && (
        <ErrorStamp message={error} onDismiss={() => setError(null)} className="mb-4" />
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

      <div className="certificate mb-4 overflow-hidden bg-[var(--paper-lift)] p-3">
        {!demandData?.demands.length ? (
          <div className="flex flex-col items-center justify-center py-14">
            <CropMark code="MAIZE" className="mb-3 h-11 w-11 text-[var(--ink-4)]" />
            <div className="font-semibold text-[var(--ink-6)]">No demands yet</div>
            <div className="mt-1 text-sm text-[var(--ink-6)]">Post one — matching runs the moment it lands</div>
          </div>
        ) : (
          <TableScroll minWidth={640}>
          <table className={tableCls}>
            <thead>
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
            <tbody>
              {demandData.demands.map((d) => {
                const commodity = commodityById.get(d.commodityId);
                return (
                  <tr key={d.id} className="hover:bg-[var(--paper)]">
                    <td className={`${tdCls} font-bold`}>
                      <span className="flex items-center gap-2">
                        <CropMark code={commodity?.code ?? ''} className="h-5 w-5 flex-shrink-0 text-[var(--ink-7)]" />
                        {commodity?.name ?? '—'}
                      </span>
                    </td>
                    <td className={`${tdCls} ${numCls} text-xs`}>{d.quantityKg} kg</td>
                    <td className={`${tdCls} ${numCls} text-xs`}>{d.remainingKg} kg</td>
                    <td className={`${tdCls} display font-semibold`}>{d.minBand}</td>
                    <td className={tdCls}>
                      <span className="serial font-bold text-[var(--gold-deep)]">
                        {ghs(d.priceTerms[d.minBand as 'A' | 'B' | 'C'] ?? 0)}
                      </span>
                      <span className="smallcaps ml-1 text-[var(--ink-6)]">/kg</span>
                    </td>
                    <td className={`${tdCls} text-xs text-[var(--ink-6)]`}>
                      {shortDate(d.windowStart)} – {shortDate(d.windowEnd)}
                    </td>
                    <td className={tdCls}>
                      <StateBadge state={d.status} />
                    </td>
                    <td className={`${tdCls} text-right`}>
                      <Link
                        className="rounded-lg border border-[var(--ink-5)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--paper-deep)]"
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
          </TableScroll>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`Recent Engine Matches (${restMatches.length})`}>
          {restMatches.length === 0 && !newestOffered ? (
            <p className="text-sm text-[var(--ink-6)]">No matches yet. Post a demand — the engine takes it from there.</p>
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
            <p className="text-sm text-[var(--ink-6)]">No open produce listings right now.</p>
          ) : (
            <div>
              {feed.lots.slice(0, 6).map((l) => (
                <div key={l.lotCode} className="border-b border-[var(--ink-2)] py-2.5 text-sm last:border-b-0">
                  <p className="font-bold text-[var(--ink)]">
                    {l.remainingKg}kg {l.commodityName}
                    <span className="serial ml-2 text-[11px] font-normal text-[var(--ink-6)]">{l.lotCode}</span>
                  </p>
                  <p className="text-xs text-[var(--ink-6)]">
                    {l.farmerName} · declared {l.declaredBand} · {l.regionCode} · ready {shortDate(l.readyDate)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {showForm && registries && (
        <Modal label="Post a new demand" onClose={() => setShowForm(false)}>
            <div className="certificate overflow-hidden bg-[var(--paper)]">
              <div className="plate flex items-center justify-between px-6 py-4">
                <div>
                  <p className="display text-sm font-semibold tracking-[0.1em]">NEW DEMAND</p>
                  <p className="smallcaps mt-0.5 text-[var(--ink-3)]">the engine starts matching the moment you post</p>
                </div>
                <button
                  className="stamp px-2 py-0.5 text-[11px] text-[var(--paper)] hover:bg-[var(--ink-8)]"
                  onClick={() => setShowForm(false)}
                >
                  Close
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
        </Modal>
      )}

      {preview && <SimulationDrawer contractId={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
