import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, ghs, shortDate, type ContractListRow, type PriceTerms } from '../api';
import { CROP_EMOJI, GradeBadge, numCls, StateBadge, tableCls, tdCls, thCls } from '../components/ui';

interface Row extends ContractListRow {
  quantityKg: number;
  holdAmount: number;
  finalAmount: number | null;
  priceTerms: PriceTerms;
}

/** Every contract in one compact list — traceability and the QR live on each detail page. */
export function ContractsPage() {
  const { data } = useQuery({
    queryKey: ['contracts'],
    queryFn: () => api<{ contracts: Row[] }>('/api/contracts'),
    refetchInterval: 6000,
  });
  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-extrabold text-gray-900">Contracts</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Every contract with its live state — open one for the escrow flow, grading, transport, and the traceability QR
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
        {data.contracts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-gray-400">
            <div className="mb-2 text-4xl">📄</div>
            <div className="font-semibold text-gray-500">No contracts yet</div>
            <div className="mt-1 text-sm">They appear here the moment the engine matches one of your demands</div>
          </div>
        ) : (
          <table className={tableCls}>
            <thead className="border-b border-gray-100">
              <tr>
                <th className={thCls}>Commodity</th>
                <th className={thCls}>Farmer</th>
                <th className={thCls}>Lot</th>
                <th className={thCls}>Quantity</th>
                <th className={thCls}>Grade</th>
                <th className={thCls}>Amount</th>
                <th className={thCls}>Status</th>
                <th className={thCls}>Created</th>
                <th className={thCls} />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {data.contracts.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className={`${tdCls} font-bold text-gray-900`}>
                    {CROP_EMOJI[c.commodityCode] ?? '📦'} {c.commodityName}
                  </td>
                  <td className={`${tdCls} text-sm text-gray-700`}>{c.farmerName ?? '—'}</td>
                  <td className={`${tdCls} mono text-xs text-gray-500`}>{c.lotCode}</td>
                  <td className={`${tdCls} ${numCls} text-xs`}>{c.quantityKg}kg</td>
                  <td className={tdCls}>{c.finalGrade ? <GradeBadge grade={c.finalGrade} /> : <span className="text-xs text-gray-300">—</span>}</td>
                  <td className={`${tdCls} ${numCls} font-bold text-[#1B4332]`}>
                    {c.finalAmount !== null ? ghs(c.finalAmount) : ghs(c.holdAmount)}
                    <span className="ml-1 text-[9px] font-medium uppercase text-gray-400">
                      {c.finalAmount !== null ? 'final' : 'hold'}
                    </span>
                  </td>
                  <td className={tdCls}>
                    <StateBadge state={c.state} />
                  </td>
                  <td className={`${tdCls} text-xs text-gray-500`}>{shortDate(c.createdAt)}</td>
                  <td className={`${tdCls} text-right`}>
                    <Link
                      className="rounded-lg border border-[#1B4332] px-3 py-1.5 text-xs font-semibold text-[#1B4332] transition-colors hover:bg-green-50"
                      to={`/contracts/${c.id}`}
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
