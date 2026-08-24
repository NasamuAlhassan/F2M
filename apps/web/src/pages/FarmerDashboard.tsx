import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ghs, shortDate, type FarmerDashboard, type Registries } from '../api';
import { CropMark, Glyph } from '../components/engrave';
import { btnCls, btnGhostCls, Field, GradeBadge, inputCls, numCls, StateBadge, tableCls, tdCls, thCls } from '../components/ui';

interface PriceRow {
  commodityCode: string;
  pricePerKg: number;
}

// The picker's "No file chosen" text and its button pseudo-element are
// separate surfaces; the button is an ink chip on paper.
const filePickerCls =
  'block w-full text-xs text-[var(--ink-6)] ' +
  'file:mr-2 file:rounded-[2px] file:border-0 file:bg-[var(--ink)] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-[var(--paper)] hover:file:bg-[var(--ink-8)]';

/** The manifest desk: "List a New Lot". Same registerLot the USSD tree calls. */
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
      <div className="certificate overflow-hidden bg-[var(--paper-lift)]">
        <div className="plate px-5 py-4">
          <div className="display text-base font-semibold tracking-[0.08em]">LIST A NEW LOT</div>
          <div className="smallcaps mt-0.5 text-[var(--ink-3)]">add your produce to the marketplace</div>
        </div>
        <div className="guilloche h-[10px] w-full bg-[var(--ink)] opacity-90" />
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
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Declared Grade">
            <div className="flex items-center gap-2 py-1">
              {(['A', 'B', 'C'] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setDeclaredBand(g)}
                  className={`flex flex-1 items-center justify-center py-1 transition-opacity ${
                    declaredBand === g ? '' : 'opacity-30 hover:opacity-60'
                  }`}
                  aria-pressed={declaredBand === g}
                >
                  <GradeBadge grade={g} />
                </button>
              ))}
            </div>
            <span className="block text-[11px] text-[var(--ink-6)]">Soft signal — the AI grade at pickup decides the payout</span>
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
            <span className="serial mt-1 block text-[11px] text-[var(--ink-6)]">= {kg} kg</span>
          </Field>
          <Field label={`Ask Price (GHS / ${activeUnit?.name ?? 'unit'}) — optional`}>
            <input
              className={`${inputCls} serial`}
              type="number"
              min="0"
              step="0.5"
              value={askPerUnit}
              onChange={(e) => setAskPerUnit(e.target.value)}
              placeholder="leave empty for market price"
            />
            {fair !== null && (
              <span
                className={`stamp mt-1.5 inline-block px-1.5 py-0.5 text-[11px] ${
                  fair ? 'text-[var(--ink)]' : 'text-[var(--gold-deep)]'
                }`}
              >
                {fair ? 'Fair price — near the market reference' : 'Above the market reference — may match slower'}
              </span>
            )}
          </Field>
          <Field label="Produce Photos (up to 3)">
            <input
              type="file"
              accept="image/*"
              multiple
              className={filePickerCls}
              onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 3))}
            />
            {files.length > 0 && (
              <span className="mt-1 block text-[11px] font-semibold text-[var(--ink)]">
                {files.length} photo{files.length > 1 ? 's' : ''} ready — buyers see them on your certificate
              </span>
            )}
          </Field>
          <Field label="MoMo Payout Number">
            <input className={`${inputCls} serial bg-[var(--paper-deep)] text-[var(--ink-6)]`} value={`+${momoMsisdn}`} readOnly />
            <span className="mt-1 block text-[11px] text-[var(--ink-6)]">Set at USSD registration — payouts land here</span>
          </Field>
          {error && (
            <p className="stamp cursor-pointer px-3 py-2 text-[11px] text-[var(--stamp)]" onClick={() => setError(null)}>
              {error}
            </p>
          )}
          <button className={`${btnCls} w-full py-2.5`} onClick={() => list.mutate()} disabled={list.isPending}>
            {done ? 'Lot listed ✓' : list.isPending ? 'Listing…' : 'List Lot'}
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

  if (!data || !registries) return <p className="text-sm text-[var(--ink-6)]">Loading…</p>;
  const { stats, offers, contracts, lots, payouts, profile } = data;

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <ListLotForm registries={registries} momoMsisdn={profile.momoMsisdn} />

      <div className="min-w-0 flex-1">
        {error && (
          <p className="stamp mb-4 cursor-pointer px-3 py-2 text-[11px] text-[var(--stamp)]" onClick={() => setError(null)}>
            {error}
          </p>
        )}

        {/* Standing figures */}
        <div className="mb-4 grid grid-cols-3 gap-4">
          <div className="certificate bg-[var(--paper-lift)] p-4">
            <div className="serial text-2xl font-bold text-[var(--ink)]">{stats.activeListings}</div>
            <div className="smallcaps text-[var(--ink-6)]">Active Listings</div>
          </div>
          <div className="certificate bg-[var(--paper-lift)] p-4">
            <div className="serial text-2xl font-bold text-[var(--ink)]">{stats.matchedContracts}</div>
            <div className="smallcaps text-[var(--ink-6)]">Live Contracts</div>
          </div>
          <div className="certificate bg-[var(--paper-lift)] p-4">
            <div className="serial text-2xl font-bold text-[var(--gold-deep)]">{ghs(stats.totalEarned)}</div>
            <div className="smallcaps text-[var(--ink-6)]">Total Earned</div>
          </div>
        </div>

        {/* Incoming bids = OFFERED contracts, the same domain calls as USSD */}
        <h2 className="rule-double mb-3 flex items-center gap-2 pb-1.5 text-base font-bold text-[var(--ink)]">
          Incoming Bids
          {offers.length > 0 && <span className="ember h-2 w-2 rounded-full bg-[var(--gold)]" />}
        </h2>
        <div className="mb-5 flex flex-col gap-2">
          {offers.length === 0 ? (
            <p className="certificate bg-[var(--paper-lift)] p-4 text-sm text-[var(--ink-6)]">
              No open bids. When a buyer's demand matches your lot, the offer appears here — and on your phone by SMS
              and voice call.
            </p>
          ) : (
            offers.map((o) => (
              <div key={o.id} className="certificate seal-land flex flex-wrap items-center gap-4 bg-[var(--gold-wash)] p-4">
                <div className="min-w-44 flex-1">
                  <div className="text-sm font-bold text-[var(--ink)]">{o.buyerName}</div>
                  <div className="mt-0.5 text-xs text-[var(--ink-6)]">
                    {o.quantityKg}kg {o.commodityName} · up to{' '}
                    <span className="serial font-bold">{ghs(o.bestPricePerKg)}/kg</span>
                    {o.expiresAt && <> · expires {shortDate(o.expiresAt)}</>}
                  </div>
                </div>
                <div className="text-right">
                  <div className="serial text-lg font-bold text-[var(--gold-deep)]">{ghs(o.holdAmount)}</div>
                  <div className="smallcaps text-[var(--ink-6)]">held in escrow on accept</div>
                </div>
                <div className="flex flex-shrink-0 gap-2">
                  <button className={btnGhostCls} onClick={() => decline.mutate(o.id)} disabled={decline.isPending}>
                    Decline
                  </button>
                  <button className={btnCls} onClick={() => accept.mutate(o.id)} disabled={accept.isPending}>
                    {accept.isPending ? 'Accepting…' : 'Accept'}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Live contracts */}
        {contracts.length > 0 && (
          <>
            <h2 className="rule-double mb-3 pb-1.5 text-base font-bold text-[var(--ink)]">My Contracts</h2>
            <div className="mb-5 flex flex-col gap-2">
              {contracts.map((c) => (
                <div key={c.id} className="certificate flex flex-wrap items-center gap-4 bg-[var(--paper-lift)] p-4">
                  <div className="min-w-44 flex-1">
                    <div className="flex items-center gap-2 text-sm font-bold text-[var(--ink)]">
                      <CropMark code={c.commodityCode} className="h-5 w-5 text-[var(--ink-7)]" />
                      {c.quantityKg}kg {c.commodityName}
                      {c.finalGrade && <GradeBadge grade={c.finalGrade} />}
                      <StateBadge state={c.state} />
                    </div>
                    <div className="mt-0.5 text-xs text-[var(--ink-6)]">
                      {c.buyerName} · {shortDate(c.createdAt)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="serial text-lg font-bold text-[var(--gold-deep)]">
                      {c.finalAmount !== null ? ghs(c.finalAmount) : ghs(c.holdAmount)}
                    </div>
                    <div className="smallcaps text-[var(--ink-6)]">{c.finalAmount !== null ? 'final payout' : 'escrow hold'}</div>
                  </div>
                  {c.state === 'FUNDS_HELD' && (
                    <button
                      className={`rounded-[2px] px-3 py-1.5 text-xs font-semibold transition-colors ${
                        suggested.has(c.id)
                          ? 'bg-[var(--gold-wash)] text-[var(--ink)]'
                          : 'border border-[var(--ink-5)] text-[var(--ink)] hover:bg-[var(--paper-deep)]'
                      }`}
                      disabled={suggested.has(c.id) || suggest.isPending}
                      onClick={() => suggest.mutate(c.id)}
                      title="Ask the buyer to send a driver — they approve and the fee escrows from their account"
                    >
                      {suggested.has(c.id) ? 'Buyer asked to approve' : 'Arrange delivery'}
                    </button>
                  )}
                  <Link to={`/t/${c.lotId}`} className="text-xs font-semibold text-[var(--gold-deep)] hover:underline">
                    Trace
                  </Link>
                </div>
              ))}
            </div>
          </>
        )}

        {/* My listings */}
        <h2 className="rule-double mb-3 pb-1.5 text-base font-bold text-[var(--ink)]">My Active Listings</h2>
        <div className="mb-5 flex flex-col gap-2">
          {lots.filter((l) => ['registered', 'matched'].includes(l.status)).length === 0 ? (
            <p className="certificate bg-[var(--paper-lift)] p-4 text-sm text-[var(--ink-6)]">
              Nothing listed right now — use the form to put produce on the marketplace.
            </p>
          ) : (
            lots
              .filter((l) => ['registered', 'matched'].includes(l.status))
              .map((l) => (
                <div key={l.id} className="certificate flex flex-wrap items-center gap-4 bg-[var(--paper-lift)] p-4">
                  {l.photoUrl ? (
                    <span className="border border-[var(--ink-3)] p-0.5">
                      <img src={l.photoUrl} alt="" className="h-11 w-11 object-cover" />
                    </span>
                  ) : (
                    <span className="hatch flex h-12 w-12 flex-shrink-0 items-center justify-center border border-[var(--ink-2)]">
                      <CropMark code={l.commodityCode} className="h-7 w-7 text-[var(--ink-7)]" />
                    </span>
                  )}
                  <div className="min-w-44 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-[var(--ink)]">{l.commodityName}</span>
                      <GradeBadge grade={l.declaredBand} />
                      <StateBadge state={l.status} />
                    </div>
                    <div className="mt-0.5 text-xs text-[var(--ink-6)]">
                      {l.remainingKg}kg of {l.quantityKg}kg left · {l.bids} bid{l.bids !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="serial text-lg font-bold text-[var(--gold-deep)]">
                      {l.askingPricePerKg !== null ? ghs(l.askingPricePerKg) : 'market'}
                    </div>
                    <div className="smallcaps text-[var(--ink-6)]">
                      {l.askingPricePerKg !== null ? 'ask /kg' : 'reference priced'}
                    </div>
                  </div>
                  <span className="serial text-[11px] text-[var(--ink-6)]">{l.lotCode}</span>
                </div>
              ))
          )}
        </div>

        {/* Payout history */}
        <h2 className="rule-double mb-3 pb-1.5 text-base font-bold text-[var(--ink)]">Payout History</h2>
        <div className="certificate overflow-hidden bg-[var(--paper-lift)] p-3">
          {payouts.length === 0 ? (
            <p className="p-2 text-sm text-[var(--ink-6)]">No payouts yet — they land here (and on your MoMo) at settlement.</p>
          ) : (
            <table className={tableCls}>
              <thead>
                <tr>
                  <th className={thCls}>Lot №</th>
                  <th className={thCls}>Amount</th>
                  <th className={thCls}>MoMo</th>
                  <th className={thCls}>Date</th>
                  <th className={thCls}>Status</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id} className="hover:bg-[var(--paper)]">
                    <td className={`${tdCls} serial text-xs font-bold`}>{p.lotCode}</td>
                    <td className={`${tdCls} ${numCls} font-bold text-[var(--gold-deep)]`}>{ghs(p.amount)}</td>
                    <td className={`${tdCls} serial text-xs text-[var(--ink-6)]`}>{p.counterpartyMsisdn}</td>
                    <td className={`${tdCls} text-xs text-[var(--ink-6)]`}>{shortDate(p.createdAt)}</td>
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
