import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api, ghs, shortDate, type Demand, type MatchRow } from '../api';
import { POLL } from '../poll';
import { Glyph } from '../components/engrave';
import { Bar, Card, EmptyState, GradeBadge, LoadGate, backLinkCls, pillCls, Stat, StateBadge } from '../components/ui';
import { useT } from '../lib/i18n';

/** UPPER_EAST → "Upper East": region codes never reach the screen raw. */
const regionLabel = (code: string): string =>
  code
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');

export function DemandDetailPage() {
  const { t } = useT();
  const { id } = useParams<{ id: string }>();
  const { data, isError, isFetching, refetch } = useQuery({
    queryKey: ['demand', id],
    queryFn: () => api<{ demand: Demand; matches: MatchRow[] }>(`/api/demands/${id}`),
    refetchInterval: POLL.active,
  });
  if (!data) return <LoadGate isError={isError} retrying={isFetching} onRetry={() => void refetch()} label={t('web.demand.loadLabel', 'this order')} />;
  const { demand, matches } = data;
  const n = matches.length;

  return (
    <div>
      <Link
        to="/orders"
        className={backLinkCls}
      >
        <span aria-hidden="true">←&nbsp;</span>
        {t('web.demand.back', 'All orders')}
      </Link>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="headline text-3xl text-[var(--ink)] sm:text-4xl">
            {t('web.demand.title', 'Your order')}
          </h1>
          <p className="mt-1 text-sm text-[var(--ink-6)]">
            {t('web.demand.subtitle', 'Farmers whose produce fits this order, best fit first. Each score shows why.')}
          </p>
        </div>
        <StateBadge state={demand.status} />
      </div>

      <Card>
        <dl className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <Info label={t('web.demand.quantity', 'Quantity')} value={`${demand.quantityKg} kg`} serial />
          <Info label={t('web.demand.remaining', 'Still needed')} value={`${demand.remainingKg} kg`} serial />
          <div>
            <dt className="smallcaps text-[var(--ink-6)]">{t('web.demand.minGrade', 'Lowest grade you take')}</dt>
            <dd className="mt-1.5">
              <GradeBadge grade={demand.minBand} />
            </dd>
          </div>
          <div>
            <dt className="smallcaps text-[var(--ink-6)]">{t('web.demand.prices', 'Your price per kg')}</dt>
            <dd className="serial mt-1 text-sm font-semibold text-[var(--ink-7)]">
              A {ghs(demand.priceTerms.A)} · B {ghs(demand.priceTerms.B)} · C {ghs(demand.priceTerms.C)}
            </dd>
          </div>
          <Info
            label={t('web.demand.window', 'Wanted between')}
            value={`${shortDate(demand.windowStart)} – ${shortDate(demand.windowEnd)}`}
          />
        </dl>
      </Card>

      <Card
        title={`${t('web.demand.matchesTitle', 'Farmers matched')}${
          n ? ` — ${n === 1 ? t('web.demand.lotOne', '1 lot') : t('web.demand.lotMany', '{n} lots', { n })}` : ''
        }`}
      >
        {n === 0 ? (
          <EmptyState
            compact
            icon={<Glyph name="farmer" className="h-5 w-5" />}
            title={t('web.demand.emptyTitle', 'No farmers matched yet')}
            body={t(
              'web.demand.emptyBody',
              'When a farmer lists produce that fits, it shows here straight away. We also check again every minute.',
            )}
          />
        ) : (
          <ul>
            {matches.map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-center gap-5 border-b border-[var(--ink-2)] py-3.5 last:border-b-0"
              >
                <div className="flex w-44 items-center gap-3">
                  <Glyph name="farmer" className="h-8 w-8 flex-shrink-0 text-[var(--ink-6)]" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-[var(--ink)]">
                      {m.farmerName ?? t('web.demand.farmer', 'Farmer')}
                    </p>
                    <p className="serial truncate text-[11px] text-[var(--ink-6)]">
                      {m.lotCode}
                      {m.farmerRegion ? ` · ${regionLabel(m.farmerRegion)}` : ''}
                    </p>
                  </div>
                </div>
                <Stat value={`${m.allocatedKg} kg`} caption={t('web.demand.allocated', 'for you')} />
                <Stat value={m.score.toFixed(2)} caption={t('web.demand.score', 'fit score')} accent />
                <Stat value={`${m.breakdown.distanceKm} km`} caption={t('web.demand.distance', 'away')} />
                <div className="min-w-52 flex-1 space-y-1">
                  <Bar label={t('web.demand.barDistance', 'Nearby')} value={m.breakdown.distance} />
                  <Bar label={t('web.demand.barQuantity', 'Amount fit')} value={m.breakdown.quantityFit} />
                  <Bar label={t('web.demand.barHistory', 'Track record')} value={m.breakdown.farmerHistory} />
                </div>
                <div className="flex w-36 flex-col items-end gap-1.5 text-right">
                  <StateBadge state={m.contractState ?? m.status} />
                  {m.contractId && (
                    <Link className={pillCls} viewTransition to={`/deals/${m.contractId}`}>
                      {t('web.demand.viewContract', 'See contract')}
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Info({ label, value, serial }: { label: string; value: string; serial?: boolean }) {
  return (
    <div>
      <dt className="smallcaps text-[var(--ink-6)]">{label}</dt>
      <dd className={`mt-1 text-sm font-bold text-[var(--ink)] ${serial ? 'serial' : ''}`}>{value}</dd>
    </div>
  );
}
