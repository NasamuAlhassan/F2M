import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api, ghs, shortDate, type Demand, type MatchRow } from '../api';
import { Bar, Card, StateBadge } from '../components/ui';

export function DemandDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data } = useQuery({
    queryKey: ['demand', id],
    queryFn: () => api<{ demand: Demand; matches: MatchRow[] }>(`/api/demands/${id}`),
    refetchInterval: 5000,
  });
  if (!data) return <p className="text-sm text-stone-500">Loading…</p>;
  const { demand, matches } = data;

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-bold">Demand</h1>
        <StateBadge state={demand.status} />
      </div>

      <Card>
        <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-5">
          <Info label="Quantity" value={`${demand.quantityKg}kg`} />
          <Info label="Remaining" value={`${demand.remainingKg}kg`} />
          <Info label="Minimum band" value={demand.minBand} />
          <Info
            label="Prices /kg"
            value={`A ${ghs(demand.priceTerms.A)} · B ${ghs(demand.priceTerms.B)} · C ${ghs(demand.priceTerms.C)}`}
          />
          <Info label="Window" value={`${shortDate(demand.windowStart)} – ${shortDate(demand.windowEnd)}`} />
        </div>
      </Card>

      <Card title={`Matches (${matches.length}) — ranked by score, each explainable`}>
        {matches.length === 0 ? (
          <p className="text-sm text-stone-500">
            No matches yet. Offers appear here the moment an eligible lot is registered — matching also re-runs on the sweep.
          </p>
        ) : (
          <div className="divide-y divide-stone-100">
            {matches.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center gap-4 py-3">
                <div className="w-40">
                  <p className="font-semibold">{m.farmerName ?? 'Farmer'}</p>
                  <p className="text-xs text-stone-500">
                    {m.lotCode} · {m.farmerRegion ?? ''}
                  </p>
                </div>
                <div className="w-24 text-sm">
                  <p className="font-medium">{m.allocatedKg}kg</p>
                  <p className="text-xs text-stone-400">allocated</p>
                </div>
                <div className="w-24">
                  <p className="text-lg font-bold tabular-nums text-green-800">{m.score.toFixed(2)}</p>
                  <p className="text-xs text-stone-400">score</p>
                </div>
                <div className="min-w-52 flex-1 space-y-0.5">
                  <Bar label="Distance" value={m.breakdown.distance} />
                  <Bar label="Quantity fit" value={m.breakdown.quantityFit} />
                  <Bar label="History" value={m.breakdown.farmerHistory} />
                  <p className="text-xs text-stone-400">≈ {m.breakdown.distanceKm}km away</p>
                </div>
                <div className="w-36 text-right">
                  <StateBadge state={m.contractState ?? m.status} />
                  {m.contractId && (
                    <p className="mt-1">
                      <Link className="text-sm text-green-700 hover:underline" to={`/contracts/${m.contractId}`}>
                        Contract →
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

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase text-stone-400">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
