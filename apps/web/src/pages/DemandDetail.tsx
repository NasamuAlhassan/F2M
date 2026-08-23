import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api, ghs, shortDate, type Demand, type MatchRow } from '../api';
import { Bar, Card, numCls, StateBadge } from '../components/ui';

export function DemandDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data } = useQuery({
    queryKey: ['demand', id],
    queryFn: () => api<{ demand: Demand; matches: MatchRow[] }>(`/api/demands/${id}`),
    refetchInterval: 5000,
  });
  if (!data) return <p className="text-sm text-ink-soft">Loading…</p>;
  const { demand, matches } = data;

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-lg font-bold uppercase tracking-widest">Demand</h1>
        <StateBadge state={demand.status} />
      </div>

      <Card>
        <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-5">
          <Info label="Quantity" value={`${demand.quantityKg}kg`} mono />
          <Info label="Remaining" value={`${demand.remainingKg}kg`} mono />
          <Info label="Minimum band" value={demand.minBand} mono />
          <Info
            label="Prices /kg"
            value={`A ${ghs(demand.priceTerms.A)} · B ${ghs(demand.priceTerms.B)} · C ${ghs(demand.priceTerms.C)}`}
            mono
          />
          <Info label="Window" value={`${shortDate(demand.windowStart)} – ${shortDate(demand.windowEnd)}`} />
        </div>
      </Card>

      <Card title={`Matches (${matches.length}) — ranked by score, each explainable`}>
        {matches.length === 0 ? (
          <p className="text-sm text-ink-soft">
            No matches yet. Offers appear here the moment an eligible lot is registered — matching also re-runs on the sweep.
          </p>
        ) : (
          <div className="divide-y-2 divide-ink">
            {matches.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center gap-4 py-3 first:pt-0 last:pb-0">
                <div className="w-40">
                  <p className="font-bold">{m.farmerName ?? 'Farmer'}</p>
                  <p className={`text-xs text-ink-soft ${numCls}`}>
                    {m.lotCode} · {m.farmerRegion ?? ''}
                  </p>
                </div>
                <div className="w-24 text-sm">
                  <p className={`font-bold ${numCls}`}>{m.allocatedKg}kg</p>
                  <p className="text-[10px] uppercase tracking-wide text-ink-soft">allocated</p>
                </div>
                <div className="w-24">
                  <p className={`text-lg font-bold ${numCls}`}>{m.score.toFixed(2)}</p>
                  <p className="text-[10px] uppercase tracking-wide text-ink-soft">score</p>
                </div>
                <div className="min-w-52 flex-1 space-y-0.5">
                  <Bar label="Distance" value={m.breakdown.distance} />
                  <Bar label="Quantity fit" value={m.breakdown.quantityFit} />
                  <Bar label="History" value={m.breakdown.farmerHistory} />
                  <p className={`text-xs text-ink-soft ${numCls}`}>≈ {m.breakdown.distanceKm}km away</p>
                </div>
                <div className="w-36 text-right">
                  <StateBadge state={m.contractState ?? m.status} />
                  {m.contractId && (
                    <p className="mt-1">
                      <Link className="text-sm font-bold uppercase text-accent underline" to={`/contracts/${m.contractId}`}>
                        Contract
                      </Link>
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-ink-soft">{label}</p>
      <p className={`font-bold ${mono ? numCls : ''}`}>{value}</p>
    </div>
  );
}
