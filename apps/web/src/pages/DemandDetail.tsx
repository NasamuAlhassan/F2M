import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api, ghs, shortDate, type Demand, type MatchRow } from '../api';
import { Glyph } from '../components/engrave';
import { Bar, Card, GradeBadge, Stat, StateBadge } from '../components/ui';

export function DemandDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data } = useQuery({
    queryKey: ['demand', id],
    queryFn: () => api<{ demand: Demand; matches: MatchRow[] }>(`/api/demands/${id}`),
    refetchInterval: 5000,
  });
  if (!data) return <p className="text-sm text-[var(--ink-6)]">Loading…</p>;
  const { demand, matches } = data;

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <div>
          <h1 className="display text-xl font-semibold tracking-[0.05em] text-[var(--ink)]">Demand</h1>
          <p className="mt-1 text-sm text-[var(--ink-6)]">Matches ranked by score — every score explains itself</p>
        </div>
        <StateBadge state={demand.status} />
      </div>

      <Card>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <Info label="Quantity" value={`${demand.quantityKg} kg`} serial />
          <Info label="Remaining" value={`${demand.remainingKg} kg`} serial />
          <div>
            <p className="smallcaps text-[var(--ink-6)]">Minimum Grade</p>
            <p className="mt-1.5">
              <GradeBadge grade={demand.minBand} />
            </p>
          </div>
          <div>
            <p className="smallcaps text-[var(--ink-6)]">Prices /kg</p>
            <p className="serial mt-1 text-sm font-semibold text-[var(--ink-7)]">
              A {ghs(demand.priceTerms.A)} · B {ghs(demand.priceTerms.B)} · C {ghs(demand.priceTerms.C)}
            </p>
          </div>
          <Info label="Window" value={`${shortDate(demand.windowStart)} – ${shortDate(demand.windowEnd)}`} />
        </div>
      </Card>

      <Card title={`Matches (${matches.length})`}>
        {matches.length === 0 ? (
          <p className="text-sm text-[var(--ink-6)]">
            No matches yet. Offers appear here the moment an eligible lot is registered — matching also re-runs on the sweep.
          </p>
        ) : (
          <div>
            {matches.map((m) => (
              <div
                key={m.id}
                className="flex flex-wrap items-center gap-5 border-b border-[var(--ink-2)] py-3.5 last:border-b-0"
              >
                <div className="flex w-44 items-center gap-3">
                  <Glyph name="farmer" className="h-8 w-8 flex-shrink-0 text-[var(--ink-6)]" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-[var(--ink)]">{m.farmerName ?? 'Farmer'}</p>
                    <p className="serial truncate text-[11px] text-[var(--ink-6)]">
                      {m.lotCode} · {m.farmerRegion ?? ''}
                    </p>
                  </div>
                </div>
                <Stat value={`${m.allocatedKg} kg`} caption="allocated" />
                <Stat value={m.score.toFixed(2)} caption="match score" accent />
                <Stat value={`${m.breakdown.distanceKm} km`} caption="distance" />
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
                        className="text-xs font-semibold text-[var(--gold-deep)] hover:underline"
                        to={`/contracts/${m.contractId}`}
                      >
                        View Contract
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

function Info({ label, value, serial }: { label: string; value: string; serial?: boolean }) {
  return (
    <div>
      <p className="smallcaps text-[var(--ink-6)]">{label}</p>
      <p className={`mt-1 text-sm font-bold text-[var(--ink)] ${serial ? 'serial' : ''}`}>{value}</p>
    </div>
  );
}
