import { useQuery } from '@tanstack/react-query';
import { api, ghs, shortDate } from '../api';
import { Card, CROP_EMOJI, tableCls, tdCls, thCls } from '../components/ui';

interface PriceRow {
  commodityCode: string;
  commodityName: string;
  market: string;
  regionCode: string;
  pricePerKg: number;
  recordedAt: number;
}

export function PricesPage() {
  const { data } = useQuery({
    queryKey: ['market-prices'],
    queryFn: () => api<{ prices: PriceRow[] }>('/api/market-prices'),
  });
  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;

  const markets = [...new Set(data.prices.map((p) => p.market))];
  const commodities = [...new Map(data.prices.map((p) => [p.commodityCode, p.commodityName]))];
  const lookup = new Map(data.prices.map((p) => [`${p.commodityCode}|${p.market}`, p]));
  const latest = Math.max(...data.prices.map((p) => p.recordedAt), 0);

  // Cross-market average per commodity — the reference each cell is judged against.
  const avg = new Map<string, number>();
  for (const [code] of commodities) {
    const rows = data.prices.filter((p) => p.commodityCode === code);
    avg.set(code, rows.reduce((s, p) => s + p.pricePerKg, 0) / rows.length);
  }
  const spreads = commodities
    .map(([code, name]) => {
      const rows = data.prices.filter((p) => p.commodityCode === code).map((p) => p.pricePerKg);
      return { code, name, spread: Math.max(...rows) - Math.min(...rows) };
    })
    .sort((a, b) => b.spread - a.spread);
  const widest = spreads[0];

  return (
    <div>
      <h1 className="text-xl font-extrabold text-gray-900">Price Intelligence</h1>
      <p className="mb-5 mt-0.5 text-sm text-gray-500">
        Published reference prices per kg — the same numbers farmers hear on USSD before agreeing to a farm-gate offer.
      </p>

      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi label="Commodities Tracked" value={String(commodities.length)} sub="registered crops" />
        <Kpi label="Markets Reporting" value={String(markets.length)} sub={markets.join(' · ')} />
        <Kpi
          label="Widest Spread"
          value={widest ? ghs(Math.round(widest.spread)) : '—'}
          sub={widest ? `${CROP_EMOJI[widest.code] ?? ''} ${widest.name} — best arbitrage` : ''}
          accent
        />
        <Kpi label="Last Updated" value={shortDate(latest)} sub="latest reference feed" />
      </div>

      <Card title="Regional Price Matrix — vs cross-market average">
        <div className="overflow-x-auto">
          <table className={tableCls}>
            <thead className="border-b border-gray-100">
              <tr>
                <th className={thCls}>Commodity</th>
                {markets.map((m) => (
                  <th key={m} className={thCls}>
                    {m}
                  </th>
                ))}
                <th className={thCls}>Average</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {commodities.map(([code, name]) => {
                const mean = avg.get(code) ?? 0;
                return (
                  <tr key={code} className="hover:bg-gray-50">
                    <td className={`${tdCls} font-bold text-gray-900`}>
                      {CROP_EMOJI[code] ?? '📦'} {name}
                    </td>
                    {markets.map((m) => {
                      const p = lookup.get(`${code}|${m}`);
                      if (!p) return <td key={m} className={`${tdCls} text-gray-300`}>—</td>;
                      const below = p.pricePerKg <= mean;
                      return (
                        <td key={m} className={tdCls}>
                          <span
                            className={`mono inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${
                              below ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
                            }`}
                          >
                            {ghs(p.pricePerKg)}
                            <span className="text-[9px]">{below ? '▼' : '▲'}</span>
                          </span>
                        </td>
                      );
                    })}
                    <td className={`${tdCls} mono text-xs font-semibold text-gray-500`}>{ghs(Math.round(mean))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[10px] text-gray-400">
          <span className="font-bold text-green-700">▼ green</span> = at or below the commodity's cross-market average
          (buyer-favourable) · <span className="font-bold text-red-600">▲ red</span> = above average.
        </p>
      </Card>
    </div>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400">{label}</p>
      <p className={`mono mt-1 text-2xl font-extrabold ${accent ? 'text-[#D97706]' : 'text-gray-900'}`}>{value}</p>
      <p className="mt-0.5 truncate text-[10px] text-gray-400">{sub}</p>
    </div>
  );
}
