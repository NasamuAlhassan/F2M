import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api, ghs, shortDate, type Demand, type MatchRow } from '../api';
import { Bar, Card, GradeBadge, Stat, StateBadge } from '../components/ui';

export function DemandDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data } = useQuery({
    queryKey: ['demand', id],
    queryFn: () => api<{ demand: Demand; matches: MatchRow[] }>(`/api/demands/${id}`),
    refetchInterval: 5000,
  });
  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;
  const { demand, matches } = data;

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-gray-900">Demand</h1>
          <p className="mt-0.5 text-sm text-gray-500">Matches ranked by score — every score explains itself</p>
        </div>
        <StateBadge state={demand.status} />
      </div>

      <Card>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <Info label="Quantity" value={`${demand.quantityKg}kg`} mono />
          <Info label="Remaining" value={`${demand.remainingKg}kg`} mono />
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400">Minimum Grade</p>
            <p className="mt-1">
              <GradeBadge grade={demand.minBand} />
            </p>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400">Prices /kg</p>
            <p className="mono mt-1 text-sm font-semibold text-gray-700">
              A {ghs(demand.priceTerms.A)} · B {ghs(demand.priceTerms.B)} · C {ghs(demand.priceTerms.C)}
            </p>
          </div>
          <Info label="Window" value={`${shortDate(demand.windowStart)} – ${shortDate(demand.windowEnd)}`} />
        </div>
      </Card>

      <Card title={`Matches (${matches.length})`}>
        {matches.length === 0 ? (
          <p className="text-sm text-gray-400">
            No matches yet. Offers appear here the moment an eligible lot is registered — matching also re-runs on the sweep.
          </p>
        ) : (
          <div className="space-y-3">
            {matches.map((m) => (
              <div
                key={m.id}
                className="flex flex-wrap items-center gap-5 rounded-xl border border-gray-100 bg-white p-4 transition-shadow hover:shadow-md"
              >
                <div className="flex w-44 items-center gap-3">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-green-50 text-lg">
                    👨🏾‍🌾
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-gray-900">{m.farmerName ?? 'Farmer'}</p>
                    <p className="mono truncate text-[10px] text-gray-400">
                      {m.lotCode} · {m.farmerRegion ?? ''}
                    </p>
                  </div>
                </div>
                <Stat value={`${m.allocatedKg}kg`} caption="allocated" />
                <Stat value={m.score.toFixed(2)} caption="match score" accent />
                <Stat value={`${m.breakdown.distanceKm}km`} caption="distance" />
                <div className="min-w-52 flex-1 space-y-1">
                  <Bar label="Distance" value={m.breakdown.distance} />
                  <Bar label="Quantity fit" value={m.breakdown.quantityFit} />
                  <Bar label="History" value={m.breakdown.farmerHistory} />
                </div>
                <div className="w-36 text-right">
                  <StateBadge state={m.contractState ?? m.status} />
                  {m.contractId && (
                    <p className="mt-1.5">
                      <Link
                        className="text-xs font-semibold text-[#1B4332] hover:underline"
                        to={`/contracts/${m.contractId}`}
                      >
                        View Contract →
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
      <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400">{label}</p>
      <p className={`mt-1 text-sm font-bold text-gray-800 ${mono ? 'mono' : ''}`}>{value}</p>
    </div>
  );
}
