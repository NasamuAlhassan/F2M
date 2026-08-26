import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, ghs, shortDate, type ContractListRow, type PriceTerms } from '../api';
import { POLL } from '../poll';
import { CropMark, Glyph } from '../components/engrave';
import { GradeBadge, LoadGate, numCls, StateBadge, tableCls, TableScroll, tdCls, thCls } from '../components/ui';

interface Row extends ContractListRow {
  quantityKg: number;
  holdAmount: number;
  finalAmount: number | null;
  priceTerms: PriceTerms;
}

/** Every contract in one ledger — the QR and full instrument live on each detail page. */
export function ContractsPage() {
  const { data, isError, refetch } = useQuery({
    queryKey: ['contracts'],
    queryFn: () => api<{ contracts: Row[] }>('/api/contracts'),
    refetchInterval: POLL.ambient,
  });
  if (!data) return <LoadGate isError={isError} onRetry={() => void refetch()} label="contracts" />;

  return (
    <div>
      <div className="mb-4">
        <h1 className="display text-xl font-semibold tracking-[0.05em] text-[var(--ink)]">Contracts</h1>
        <p className="mt-1 text-sm text-[var(--ink-6)]">
          Every contract with its live state — open one for the escrow flow, grading, transport, and the traceability QR
        </p>
      </div>

      <div className="certificate overflow-hidden bg-[var(--paper-lift)] p-3">
        {data.contracts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14">
            <Glyph name="scale" className="mb-3 h-11 w-11 text-[var(--ink-4)]" />
            <div className="font-semibold text-[var(--ink-6)]">No contracts yet</div>
            <div className="mt-1 text-sm text-[var(--ink-6)]">They appear the moment the engine matches one of your demands</div>
          </div>
        ) : (
          <>
            {/* Phones read the ledger as stacked tickets — the whole ticket is the tap target. */}
            <div className="md:hidden">
              {data.contracts.map((c) => (
                <Link
                  key={c.id}
                  to={`/contracts/${c.id}`}
                  className="block border-b border-[var(--ink-2)] px-1 py-3 transition-colors last:border-b-0 hover:bg-[var(--paper)]"
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
                    <Link
                      className="rounded-lg border border-[var(--ink-5)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--paper-deep)]"
                      to={`/contracts/${c.id}`}
                    >
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
