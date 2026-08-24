import { useQuery } from '@tanstack/react-query';
import { api, ghs, shortDate } from '../api';
import { CropMark } from '../components/engrave';
import { Card, tableCls, tdCls, thCls } from '../components/ui';

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
  if (!data) return <p className="text-sm text-[var(--ink-6)]">Loading…</p>;

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
      <h1 className="display text-xl font-semibold tracking-[0.05em] text-[var(--ink)]">Price Intelligence</h1>
      <p className="mb-4 mt-1 text-sm text-[var(--ink-6)]">
        Published reference prices per kg — the same numbers farmers hear on USSD before agreeing to a farm-gate offer.
      </p>

      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi label="Commodities Tracked" value={String(commodities.length)} sub="registered crops" />
        <Kpi label="Markets Reporting" value={String(markets.length)} sub={markets.join(' · ')} />
        <Kpi
          label="Widest Spread"
          value={widest ? ghs(Math.round(widest.spread)) : '—'}
          sub={widest ? `${widest.name} — best arbitrage` : ''}
          accent
        />
        <Kpi label="Last Updated" value={shortDate(latest)} sub="latest reference feed" />
      </div>

      <Card title="Regional Price Matrix — vs cross-market average">
        <div className="overflow-x-auto">
          <table className={tableCls}>
            <thead>
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
            <tbody>
              {commodities.map(([code, name]) => {
                const mean = avg.get(code) ?? 0;
                return (
                  <tr key={code} className="hover:bg-[var(--paper)]">
                    <td className={`${tdCls} font-bold`}>
                      <span className="flex items-center gap-2">
                        <CropMark code={code} className="h-5 w-5 flex-shrink-0 text-[var(--ink-7)]" />
                        {name}
                      </span>
                    </td>
                    {markets.map((m) => {
                      const p = lookup.get(`${code}|${m}`);
                      if (!p) return <td key={m} className={`${tdCls} text-[var(--ink-3)]`}>—</td>;
                      const below = p.pricePerKg <= mean;
                      return (
                        <td key={m} className={tdCls}>
                          <span
                            className={`serial text-sm font-bold ${below ? 'text-[var(--ink)]' : 'text-[var(--stamp)]'}`}
                          >
                            {ghs(p.pricePerKg)}
                          </span>
                          <span className={`ml-1 text-[11px] ${below ? 'text-[var(--ink-6)]' : 'text-[var(--stamp)]'}`}>
                            {below ? '▼' : '▲'}
                          </span>
                        </td>
                      );
                    })}
                    <td className={`${tdCls} serial text-xs font-semibold text-[var(--ink-6)]`}>{ghs(Math.round(mean))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-[var(--ink-6)]">
          <span className="font-bold text-[var(--ink)]">▼ ink</span> = at or below the commodity's cross-market average
          (buyer-favourable) · <span className="font-bold text-[var(--stamp)]">▲ red</span> = above average.
        </p>
      </Card>
    </div>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <div className="certificate bg-[var(--paper-lift)] p-4">
      <p className="smallcaps text-[var(--ink-6)]">{label}</p>
      <p className={`serial mt-1.5 text-2xl font-bold ${accent ? 'text-[var(--gold-deep)]' : 'text-[var(--ink)]'}`}>{value}</p>
      <p className="mt-0.5 truncate text-[11px] text-[var(--ink-6)]">{sub}</p>
    </div>
  );
}
