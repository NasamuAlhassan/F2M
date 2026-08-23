import { useQuery } from '@tanstack/react-query';
import { api, ghs, shortDate } from '../api';
import { Card, numCls, tableCls, tdCls, thCls } from '../components/ui';

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
  if (!data) return <p className="text-sm text-ink-soft">Loading…</p>;

  const markets = [...new Set(data.prices.map((p) => p.market))];
  const commodities = [...new Map(data.prices.map((p) => [p.commodityCode, p.commodityName]))];
  const lookup = new Map(data.prices.map((p) => [`${p.commodityCode}|${p.market}`, p]));
  const latest = Math.max(...data.prices.map((p) => p.recordedAt), 0);

  return (
    <div>
      <h1 className="mb-1 text-lg font-bold uppercase tracking-widest">Market prices</h1>
      <p className="mb-4 text-sm text-ink-soft">
        Published reference prices per kg — the same numbers farmers see on USSD before agreeing to a farm-gate offer.
        Last updated {shortDate(latest)}.
      </p>
      <Card>
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
              </tr>
            </thead>
            <tbody>
              {commodities.map(([code, name], i) => (
                <tr key={code} className={i % 2 ? 'bg-paper-dim' : ''}>
                  <td className={`${tdCls} font-bold`}>{name}</td>
                  {markets.map((m) => {
                    const p = lookup.get(`${code}|${m}`);
                    return (
                      <td key={m} className={`${tdCls} ${numCls}`}>
                        {p ? ghs(p.pricePerKg) : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
