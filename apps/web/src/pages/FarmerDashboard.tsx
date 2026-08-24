import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ghs, shortDate, type FarmerDashboard, type Registries } from '../api';
import { btnCls, btnGhostCls, CROP_EMOJI, Field, GradeBadge, inputCls, numCls, StateBadge, tableCls, tdCls, thCls } from '../components/ui';

interface PriceRow {
  commodityCode: string;
  pricePerKg: number;
}

/** Frame 07's sidebar: "List a New Lot". Same registerLot the USSD tree calls. */
function ListLotForm({ registries, momoMsisdn }: { registries: Registries; momoMsisdn: string }) {
  const queryClient = useQueryClient();
  const { data: priceData } = useQuery({
    queryKey: ['market-prices'],
    queryFn: () => api<{ prices: PriceRow[] }>('/api/market-prices'),
  });
  const [commodityCode, setCommodityCode] = useState(registries.commodities[0]?.code ?? '');
  const commodity = registries.commodities.find((c) => c.code === commodityCode);
  const units = commodity?.units ?? [];
  const [unitCode, setUnitCode] = useState('');
  const activeUnit = units.find((u) => u.code === unitCode) ?? units[0];
  const [unitQty, setUnitQty] = useState('10');
  const [declaredBand, setDeclaredBand] = useState<'A' | 'B' | 'C'>('B');
  const [askPerUnit, setAskPerUnit] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Fair-price pip: the ask vs the cross-market reference for this crop.
  const refRows = (priceData?.prices ?? []).filter((p) => p.commodityCode === commodityCode);
  const refPerKg = refRows.length ? refRows.reduce((s, p) => s + p.pricePerKg, 0) / refRows.length : null;
  const askPerKg = activeUnit && askPerUnit ? Math.round((Number(askPerUnit) * 100) / activeUnit.kgPerUnit) : null;
  const fair = askPerKg !== null && refPerKg !== null ? askPerKg <= refPerKg * 1.05 : null;

  const list = useMutation({
    mutationFn: async () => {
      const res = await api<{ lot: { id: string } }>('/api/farmer/lots', {
        method: 'POST',
        body: JSON.stringify({
          commodityCode,
          unitCode: activeUnit?.code,
          unitQty: Number(unitQty),
          declaredBand,
          askingPricePerKg: askPerKg ?? undefined,
        }),
      });
      // Card art: upload the chosen produce photos onto the fresh listing.
      for (const file of files.slice(0, 3)) {
        const form = new FormData();
        form.append('photo', file);
        await api(`/api/farmer/lots/${res.lot.id}/photos`, { method: 'POST', body: form });
      }
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['farmer-dashboard'] });
      setAskPerUnit('');
      setFiles([]);
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed'),
  });

  const kg = activeUnit ? Math.round(activeUnit.kgPerUnit * Number(unitQty) * 10) / 10 : 0;

  return (
    <aside className="w-full flex-shrink-0 lg:w-72">
      <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
        <div className="bg-[#1B4332] px-5 py-4">
          <div className="text-base font-extrabold text-white">List a New Lot</div>
          <div className="mt-0.5 text-[11px] text-green-300">Add your produce to the marketplace</div>
        </div>
        <div className="flex flex-col gap-4 p-5">
          <Field label="Crop">
            <select
              className={inputCls}
              value={commodityCode}
              onChange={(e) => {
                setCommodityCode(e.target.value);
                setUnitCode('');
              }}
            >
              {registries.commodities.map((c) => (
                <option key={c.code} value={c.code}>
                  {CROP_EMOJI[c.code] ?? ''} {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Declared Grade">
            <div className="flex gap-2">
              {(['A', 'B', 'C'] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setDeclaredBand(g)}
                  className={`flex-1 rounded-lg border-2 py-1.5 text-sm font-bold transition-colors ${
                    declaredBand === g
                      ? g === 'A'
                        ? 'border-green-700 bg-green-700 text-white'
                        : g === 'B'
                          ? 'border-amber-600 bg-amber-600 text-white'
                          : 'border-red-600 bg-red-600 text-white'
                      : 'border-gray-200 text-gray-500 hover:border-gray-400'
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
            <span className="mt-1 block text-[10px] text-gray-400">Soft signal — the AI grade at pickup decides the payout</span>
          </Field>
          <Field label="Quantity">
            <div className="flex gap-2">
              <input className={inputCls} type="number" min="1" value={unitQty} onChange={(e) => setUnitQty(e.target.value)} />
              <select className={inputCls} value={activeUnit?.code} onChange={(e) => setUnitCode(e.target.value)}>
                {units.map((u) => (
                  <option key={u.code} value={u.code}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <span className="mono mt-1 block text-[10px] text-gray-400">= {kg} kg</span>
          </Field>
          <Field label={`Ask Price (GHS / ${activeUnit?.name ?? 'unit'}) — optional`}>
            <input
              className={inputCls}
              type="number"
              min="0"
              step="0.5"
              value={askPerUnit}
              onChange={(e) => setAskPerUnit(e.target.value)}
              placeholder="leave empty for market price"
            />
            {fair !== null && (
              <span
                className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  fair ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-800'
                }`}
              >
                {fair ? '✓ Fair Price — at or near the market reference' : '▲ Above the market reference — may match slower'}
              </span>
            )}
          </Field>
          <Field label="Produce Photos (up to 3)">
            <input
              type="file"
              accept="image/*"
              multiple
              className="block w-full text-xs text-gray-500 file:mr-2 file:rounded-lg file:border-0 file:bg-green-50 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-[#1B4332] hover:file:bg-green-100"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 3))}
            />
            {files.length > 0 && (
              <span className="mt-1 block text-[10px] font-semibold text-green-700">
                {files.length} photo{files.length > 1 ? 's' : ''} ready — buyers see them on your card
              </span>
            )}
          </Field>
          <Field label="MoMo Payout Number">
            <input className={`${inputCls} mono bg-gray-50 text-gray-500`} value={`+${momoMsisdn}`} readOnly />
            <span className="mt-1 block text-[10px] text-gray-400">Set at USSD registration — payouts land here</span>
          </Field>
          {error && (
            <p
              className="cursor-pointer rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700"
              onClick={() => setError(null)}
            >
              {error}
            </p>
          )}
          <button
            className={`${btnCls} w-full py-2.5 ${done ? '!bg-green-600' : ''}`}
            onClick={() => list.mutate()}
            disabled={list.isPending}
          >
            {done ? '✓ Lot Listed!' : list.isPending ? 'Listing…' : 'List Lot'}
          </button>
        </div>
      </div>
    </aside>
  );
}

export function FarmerDashboardPage() {
  const queryClient = useQueryClient();
  const { data: registries } = useQuery({ queryKey: ['registries'], queryFn: () => api<Registries>('/api/registries') });
  const { data } = useQuery({
    queryKey: ['farmer-dashboard'],
    queryFn: () => api<FarmerDashboard>('/api/farmer/dashboard'),
    refetchInterval: 5000,
  });
  const [error, setError] = useState<string | null>(null);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['farmer-dashboard'] });
  const onError = (err: unknown) => setError(err instanceof Error ? err.message : 'Action failed');

  const accept = useMutation({
    mutationFn: (id: string) => api(`/api/farmer/contracts/${id}/accept`, { method: 'POST' }),
    onSuccess: invalidate,
    onError,
  });
  const decline = useMutation({
    mutationFn: (id: string) => api(`/api/farmer/contracts/${id}/decline`, { method: 'POST' }),
    onSuccess: invalidate,
    onError,
  });
  const [suggested, setSuggested] = useState<Set<string>>(new Set());
  const suggest = useMutation({
    mutationFn: (id: string) => api(`/api/farmer/contracts/${id}/suggest-transport`, { method: 'POST' }),
    onSuccess: (_data, id) => setSuggested((prev) => new Set(prev).add(id)),
    onError,
  });

  if (!data || !registries) return <p className="text-sm text-gray-400">Loading…</p>;
  const { stats, offers, contracts, lots, payouts, profile } = data;

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <ListLotForm registries={registries} momoMsisdn={profile.momoMsisdn} />

      <div className="min-w-0 flex-1">
        {error && (
          <p
            className="mb-4 cursor-pointer rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700"
            onClick={() => setError(null)}
          >
            {error}
          </p>
        )}

        {/* KPI row */}
        <div className="mb-6 grid grid-cols-3 gap-4">
          <div className="rounded-xl border border-green-100 bg-white p-4 shadow-sm">
            <div className="text-2xl font-extrabold text-gray-900">{stats.activeListings}</div>
            <div className="text-xs font-medium text-gray-500">Active Listings</div>
          </div>
          <div className="rounded-xl border border-amber-100 bg-white p-4 shadow-sm">
            <div className="text-2xl font-extrabold text-gray-900">{stats.matchedContracts}</div>
            <div className="text-xs font-medium text-gray-500">Live Contracts</div>
          </div>
          <div className="rounded-xl border border-blue-100 bg-white p-4 shadow-sm">
            <div className="mono text-2xl font-extrabold text-gray-900">{ghs(stats.totalEarned)}</div>
            <div className="text-xs font-medium text-gray-500">Total Earned</div>
          </div>
        </div>

        {/* Incoming bids = OFFERED contracts, accept/decline via the same domain calls as USSD */}
        <h2 className="mb-3 flex items-center gap-2 text-base font-extrabold text-gray-900">
          Incoming Bids
          {offers.length > 0 && <span className="pulse-dot h-2 w-2 rounded-full bg-amber-500" />}
        </h2>
        <div className="mb-6 flex flex-col gap-2">
          {offers.length === 0 ? (
            <p className="rounded-xl border border-gray-100 bg-white p-4 text-sm text-gray-400 shadow-sm">
              No open bids. When a buyer's demand matches your lot, the offer appears here — and on your phone by SMS
              and voice call.
            </p>
          ) : (
            offers.map((o) => (
              <div key={o.id} className="slide-in flex flex-wrap items-center gap-4 rounded-xl border border-amber-200 bg-white p-4 shadow-sm">
                <div className="min-w-44 flex-1">
                  <div className="text-sm font-bold text-gray-900">{o.buyerName}</div>
                  <div className="mt-0.5 text-xs text-gray-500">
                    {CROP_EMOJI[o.commodityCode] ?? ''} {o.quantityKg}kg {o.commodityName} · up to{' '}
                    <span className="mono font-bold">{ghs(o.bestPricePerKg)}/kg</span>
                    {o.expiresAt && <> · expires {shortDate(o.expiresAt)}</>}
                  </div>
                </div>
                <div className="text-right">
                  <div className="mono text-lg font-extrabold text-[#1B4332]">{ghs(o.holdAmount)}</div>
                  <div className="text-[10px] text-gray-400">held in escrow on accept</div>
                </div>
                <div className="flex flex-shrink-0 gap-2">
                  <button className={btnGhostCls} onClick={() => decline.mutate(o.id)} disabled={decline.isPending}>
                    Decline
                  </button>
                  <button className={btnCls} onClick={() => accept.mutate(o.id)} disabled={accept.isPending}>
                    {accept.isPending ? 'Accepting…' : '✓ Accept'}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Live contracts */}
        {contracts.length > 0 && (
          <>
            <h2 className="mb-3 text-base font-extrabold text-gray-900">My Contracts</h2>
            <div className="mb-6 flex flex-col gap-2">
              {contracts.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center gap-4 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                  <div className="min-w-44 flex-1">
                    <div className="flex items-center gap-2 text-sm font-bold text-gray-900">
                      {CROP_EMOJI[c.commodityCode] ?? ''} {c.quantityKg}kg {c.commodityName}
                      {c.finalGrade && <GradeBadge grade={c.finalGrade} />}
                      <StateBadge state={c.state} />
                    </div>
                    <div className="mt-0.5 text-xs text-gray-500">
                      {c.buyerName} · {shortDate(c.createdAt)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="mono text-lg font-extrabold text-[#1B4332]">
                      {c.finalAmount !== null ? ghs(c.finalAmount) : ghs(c.holdAmount)}
                    </div>
                    <div className="text-[10px] text-gray-400">{c.finalAmount !== null ? 'final payout' : 'escrow hold'}</div>
                  </div>
                  {c.state === 'FUNDS_HELD' && (
                    <button
                      className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                        suggested.has(c.id)
                          ? 'bg-green-50 text-green-700'
                          : 'border border-[#1B4332] text-[#1B4332] hover:bg-green-50'
                      }`}
                      disabled={suggested.has(c.id) || suggest.isPending}
                      onClick={() => suggest.mutate(c.id)}
                      title="Ask the buyer to send a driver — they approve and the fee escrows from their account"
                    >
                      {suggested.has(c.id) ? '✓ Buyer asked to approve' : '🚚 Arrange delivery'}
                    </button>
                  )}
                  <Link to={`/t/${c.lotId}`} className="text-xs font-semibold text-[#1B4332] hover:underline">
                    Trace →
                  </Link>
                </div>
              ))}
            </div>
          </>
        )}

        {/* My listings */}
        <h2 className="mb-3 text-base font-extrabold text-gray-900">My Active Listings</h2>
        <div className="mb-6 flex flex-col gap-2">
          {lots.filter((l) => ['registered', 'matched'].includes(l.status)).length === 0 ? (
            <p className="rounded-xl border border-gray-100 bg-white p-4 text-sm text-gray-400 shadow-sm">
              Nothing listed right now — use the form to put produce on the marketplace.
            </p>
          ) : (
            lots
              .filter((l) => ['registered', 'matched'].includes(l.status))
              .map((l) => (
                <div key={l.id} className="flex flex-wrap items-center gap-4 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                  {l.photoUrl ? (
                    <img src={l.photoUrl} alt="" className="h-12 w-12 flex-shrink-0 rounded-lg object-cover" />
                  ) : (
                    <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-green-50 text-xl">
                      {CROP_EMOJI[l.commodityCode] ?? '📦'}
                    </div>
                  )}
                  <div className="min-w-44 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-gray-900">
                        {CROP_EMOJI[l.commodityCode] ?? ''} {l.commodityName}
                      </span>
                      <GradeBadge grade={l.declaredBand} />
                      <StateBadge state={l.status} />
                    </div>
                    <div className="mt-0.5 text-xs text-gray-500">
                      {l.remainingKg}kg of {l.quantityKg}kg left · {l.bids} bid{l.bids !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="mono text-lg font-extrabold text-[#1B4332]">
                      {l.askingPricePerKg !== null ? ghs(l.askingPricePerKg) : 'market'}
                    </div>
                    <div className="text-[10px] text-gray-400">{l.askingPricePerKg !== null ? 'ask /kg' : 'reference priced'}</div>
                  </div>
                  <span className="mono text-[10px] text-gray-400">{l.lotCode}</span>
                </div>
              ))
          )}
        </div>

        {/* Payout history */}
        <h2 className="mb-3 text-base font-extrabold text-gray-900">Payout History</h2>
        <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
          {payouts.length === 0 ? (
            <p className="p-4 text-sm text-gray-400">No payouts yet — they land here (and on your MoMo) at settlement.</p>
          ) : (
            <table className={tableCls}>
              <thead className="border-b border-gray-100">
                <tr>
                  <th className={thCls}>Lot</th>
                  <th className={thCls}>Amount</th>
                  <th className={thCls}>MoMo</th>
                  <th className={thCls}>Date</th>
                  <th className={thCls}>Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {payouts.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className={`${tdCls} mono text-xs font-bold text-gray-700`}>{p.lotCode}</td>
                    <td className={`${tdCls} ${numCls} font-extrabold text-[#1B4332]`}>{ghs(p.amount)}</td>
                    <td className={`${tdCls} mono text-xs text-gray-500`}>{p.counterpartyMsisdn}</td>
                    <td className={`${tdCls} text-xs text-gray-500`}>{shortDate(p.createdAt)}</td>
                    <td className={tdCls}>
                      <StateBadge state={p.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
