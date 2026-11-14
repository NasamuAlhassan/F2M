import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, ghs, shortDate, type ContractListRow, type PriceTerms } from '../api';
import { POLL } from '../poll';
import { CropMark, Glyph } from '../components/engrave';
import { btnCls, EmptyState, GradeBadge, LoadGate, numCls, pillCls, rowLinkCls, StateBadge, tableCls, TableScroll, tdCls, thCls } from '../components/ui';
import { useT } from '../lib/i18n';

interface Row extends ContractListRow {
  quantityKg: number;
  holdAmount: number;
  finalAmount: number | null;
  priceTerms: PriceTerms;
}

/** Every contract in one ledger — the QR and full instrument live on each detail page. */
export function ContractsPage() {
  const { t } = useT();
  const { data, isError, isFetching, refetch } = useQuery({
    queryKey: ['contracts'],
    queryFn: () => api<{ contracts: Row[] }>('/api/contracts'),
    refetchInterval: POLL.ambient,
  });
  if (!data) return <LoadGate isError={isError} retrying={isFetching} onRetry={() => void refetch()} label="contracts" />;

  return (
    <div>
      <div className="mb-4">
        <h1 className="headline text-3xl text-[var(--ink)] sm:text-4xl">Contracts</h1>
        <p className="mt-1 text-sm text-[var(--ink-6)]">
          {t('web.contracts.subtitle', 'Every purchase a farmer has accepted. Open one to follow the money, the grading, the truck and the trace.')}
        </p>
      </div>

      <div className={data.contracts.length ? 'certificate overflow-hidden bg-[var(--paper-lift)] p-3' : ''}>
        {data.contracts.length === 0 ? (
          <EmptyState
            icon={<Glyph name="scale" className="h-7 w-7" />}
            title={t('web.contracts.emptyTitle', 'No purchases yet')}
            body={t(
              'web.contracts.emptyBody',
              'When a farmer accepts one of your offers, the purchase appears here with every step from payment to delivery.',
            )}
            action={
              <Link to="/market" className={`${btnCls} inline-flex items-center px-5`}>
                {t('web.contracts.browse', 'Browse produce')}
              </Link>
            }
          />
        ) : (
          <>
            {/* Phones read the ledger as stacked tickets — the whole ticket is the tap target. */}
            <div className="md:hidden">
              {data.contracts.map((c) => (
                <Link
                  key={c.id}
                  to={`/deals/${c.id}`}
                  className={`${rowLinkCls} block border-b border-[var(--ink-2)] px-1 py-3 last:border-b-0`}
                >
                  <span className="flex items-center gap-2">
                    <CropMark code={c.commodityCode} className="h-5 w-5 flex-shrink-0 text-[var(--ink-7)]" />
                    <span className="min-w-0 flex-1 truncate font-bold text-[var(--ink)]">{c.commodityName}</span>
                    {c.finalGrade && <GradeBadge grade={c.finalGrade} />}
                    <StateBadge state={c.state} />
                  </span>
                  <span className="mt-1 block truncate text-sm text-[var(--ink-7)]">
                    {c.farmerName ?? '—'} · <span className="serial text-xs text-[var(--ink-6)]">{c.lotCode}</span> ·{' '}
                    {shortDate(c.createdAt)}
                  </span>
                  <span className="mt-1 flex items-baseline justify-between">
                    <span>
                      <span className="serial font-bold text-[var(--gold-deep)]">
                        {c.finalAmount !== null ? ghs(c.finalAmount) : ghs(c.holdAmount)}
                      </span>
                      <span className="smallcaps ml-1.5 text-[var(--ink-6)]">{c.finalAmount !== null ? 'final' : 'hold'}</span>
                    </span>
                    <span className={`${numCls} text-xs text-[var(--ink-6)]`}>{c.quantityKg} kg</span>
                  </span>
                </Link>
              ))}
            </div>

            <div className="hidden md:block">
              <TableScroll minWidth={760}>
          <table className={tableCls}>
            <thead>
              <tr>
                <th className={thCls}>Commodity</th>
                <th className={thCls}>Farmer</th>
                <th className={thCls}>Lot №</th>
                <th className={thCls}>Quantity</th>
                <th className={thCls}>Grade</th>
                <th className={thCls}>Amount</th>
                <th className={thCls}>Status</th>
                <th className={thCls}>Created</th>
                <th className={thCls} />
              </tr>
            </thead>
            <tbody>
              {data.contracts.map((c) => (
                <tr key={c.id} className="hover:bg-[var(--paper)]">
                  <td className={`${tdCls} font-bold`}>
                    <span className="flex items-center gap-2">
                      <CropMark code={c.commodityCode} className="h-5 w-5 flex-shrink-0 text-[var(--ink-7)]" />
                      {c.commodityName}
                    </span>
                  </td>
                  <td className={`${tdCls} text-sm text-[var(--ink-7)]`}>{c.farmerName ?? '—'}</td>
                  <td className={`${tdCls} serial text-xs text-[var(--ink-6)]`}>{c.lotCode}</td>
                  <td className={`${tdCls} ${numCls} text-xs`}>{c.quantityKg} kg</td>
                  <td className={tdCls}>
                    {c.finalGrade ? <GradeBadge grade={c.finalGrade} /> : <span className="text-xs text-[var(--ink-4)]">—</span>}
                  </td>
                  <td className={tdCls}>
                    <span className="serial font-bold text-[var(--gold-deep)]">
                      {c.finalAmount !== null ? ghs(c.finalAmount) : ghs(c.holdAmount)}
                    </span>
                    <span className="smallcaps ml-1.5 text-[var(--ink-6)]">{c.finalAmount !== null ? 'final' : 'hold'}</span>
                  </td>
                  <td className={tdCls}>
                    <StateBadge state={c.state} />
                  </td>
                  <td className={`${tdCls} text-xs text-[var(--ink-6)]`}>{shortDate(c.createdAt)}</td>
                  <td className={`${tdCls} text-right`}>
                    <Link className={pillCls} to={`/deals/${c.id}`}>
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
              </TableScroll>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
