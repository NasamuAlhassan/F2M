import { useQuery } from '@tanstack/react-query';
import { api, ghs, shortDate } from '../api';
import { Card } from '../components/ui';

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
  if (!data) return <p className="text-sm text-stone-500">Loading…</p>;

  const markets = [...new Set(data.prices.map((p) => p.market))];
  const commodities = [...new Map(data.prices.map((p) => [p.commodityCode, p.commodityName]))];
  const lookup = new Map(data.prices.map((p) => [`${p.commodityCode}|${p.market}`, p]));
  const latest = Math.max(...data.prices.map((p) => p.recordedAt), 0);

  return (
    <div>
      <h1 className="mb-1 text-xl font-bold">Market prices</h1>
      <p className="mb-4 text-sm text-stone-500">
        Published reference prices per kg — the same numbers farmers see on USSD before agreeing to a farm-gate offer.
        Last updated {shortDate(latest)}.
      </p>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-stone-400">
              <tr>
                <th className="py-2">Commodity</th>
                {markets.map((m) => (
                  <th key={m} className="py-2">
                    {m}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {commodities.map(([code, name]) => (
                <tr key={code}>
                  <td className="py-2 font-medium">{name}</td>
                  {markets.map((m) => {
                    const p = lookup.get(`${code}|${m}`);
                    return (
                      <td key={m} className="py-2 tabular-nums">
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
