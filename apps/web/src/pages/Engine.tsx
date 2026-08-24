import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, dateTime, ghs, shortDate } from '../api';
import { btnCls, btnGhostCls, Card, Stat, StateBadge } from '../components/ui';

interface FeedLot {
  lotCode: string;
  commodityName: string;
  remainingKg: number;
  declaredBand: string;
  regionCode: string;
  readyDate: number;
  farmerName: string | null;
  createdAt: number;
}
interface FeedDemand {
  commodityName: string;
  remainingKg: number;
  minBand: string;
  minPricePerKg: number;
  windowStart: number;
  windowEnd: number;
  regionCode: string;
  mine: boolean;
  createdAt: number;
}
interface FeedMatch {
  contractId: string;
  state: string;
  scorePct: number | null;
  commodityName: string;
  quantityKg: number;
  bestPricePerKg: number;
  holdAmount: number;
  farmerName: string | null;
  lotCode: string | null;
  distanceKm: number | null;
  logisticsEstimate: number | null;
  createdAt: number;
}
interface Feed {
  lots: FeedLot[];
  demands: FeedDemand[];
  matches: FeedMatch[];
  simulateEnabled: boolean;
}
interface AlertPreview {
  locales: Array<{ code: string; label: string }>;
  locale: string;
  reviewNote: boolean;
  farmerName: string | null;
  farmerPhone: string | null;
  sms: string;
  voice: string[];
  smsStatus: string | null;
  callStatus: string | null;
}

/** Animated SVG score ring — the prototype's match-score dial. */
function ScoreRing({ pct }: { pct: number }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-20 w-20 flex-shrink-0">
      <svg viewBox="0 0 72 72" className="h-full w-full -rotate-90">
        <circle cx="36" cy="36" r={r} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="6" />
        <circle
          cx="36"
          cy="36"
          r={r}
          fill="none"
          stroke="#fff"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
          style={{ transition: 'stroke-dashoffset 0.8s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
        <span className="mono text-lg font-extrabold leading-none">{pct}%</span>
        <span className="text-[8px] font-bold uppercase tracking-widest opacity-80">match</span>
      </div>
    </div>
  );
}

/** Frame 06's "AI Match Found" banner — amber gradient, score ring, terms chips. */
function MatchBanner({
  match,
  simulateEnabled,
  onPreview,
  onSimulate,
  simulating,
}: {
  match: FeedMatch;
  simulateEnabled: boolean;
  onPreview: () => void;
  onSimulate: () => void;
  simulating: boolean;
}) {
  return (
    <div className="slide-in mb-5 overflow-hidden rounded-2xl shadow-lg" style={{ background: 'linear-gradient(135deg, #D97706 0%, #B45309 100%)' }}>
      <div className="flex items-center gap-2 px-5 pt-4">
        <span className="pulse-dot inline-block h-2 w-2 rounded-full bg-white" />
        <span className="text-[11px] font-extrabold uppercase tracking-widest text-white">🤖 AI Match Found</span>
        <span className="mono ml-auto text-[10px] text-amber-100">{dateTime(match.createdAt)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-5 px-5 py-4">
        {match.scorePct !== null && <ScoreRing pct={match.scorePct} />}
        <div className="min-w-48 flex-1 text-white">
          <p className="text-lg font-extrabold leading-tight">
            {match.quantityKg}kg {match.commodityName}
          </p>
          <p className="text-sm text-amber-100">
            from {match.farmerName ?? 'farmer'} <span className="mono text-[11px]">({match.lotCode})</span>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <TermChip label="up to" value={`${ghs(match.bestPricePerKg)}/kg`} />
            <TermChip label="escrow hold" value={ghs(match.holdAmount)} />
            {match.distanceKm !== null && <TermChip label="route" value={`≈ ${match.distanceKm}km`} />}
            {match.logisticsEstimate !== null && <TermChip label="logistics est." value={ghs(match.logisticsEstimate)} />}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <StateBadge state={match.state} />
          <div className="flex flex-wrap justify-end gap-2">
            {match.state === 'OFFERED' && simulateEnabled && (
              <button
                className="rounded-xl bg-white px-4 py-2 text-sm font-extrabold text-[#B45309] transition-colors hover:bg-amber-50 disabled:opacity-40"
                onClick={onSimulate}
                disabled={simulating}
              >
                {simulating ? 'Accepting…' : '✓ Accept Contract'}
              </button>
            )}
            <button
              className="rounded-xl border border-white/40 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-white/10"
              onClick={onPreview}
            >
              📞 Voice & SMS
            </button>
          </div>
          {match.state === 'OFFERED' && (
            <p className="text-right text-[10px] text-amber-100">
              {simulateEnabled ? 'demo: farmer presses 1 on the IVR call' : 'awaiting farmer acceptance (SMS + voice sent)'}
            </p>
          )}
          <Link to={`/contracts/${match.contractId}`} className="text-xs font-bold text-white underline-offset-2 hover:underline">
            View Contract →
          </Link>
        </div>
      </div>
    </div>
  );
}

function TermChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold text-white">
      <span className="opacity-70">{label}</span> <span className="mono font-extrabold">{value}</span>
    </span>
  );
}

/** Quieter row for older matches below the banner. */
function MatchRow({
  match,
  simulateEnabled,
  onPreview,
  onSimulate,
  simulating,
}: {
  match: FeedMatch;
  simulateEnabled: boolean;
  onPreview: () => void;
  onSimulate: () => void;
  simulating: boolean;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-4 rounded-xl border border-gray-100 bg-white p-4 last:mb-0 hover:bg-gray-50">
      {match.scorePct !== null && <Stat value={`${match.scorePct}%`} caption="match" accent />}
      <div className="min-w-48 flex-1">
        <p className="text-sm font-bold text-gray-900">
          {match.quantityKg}kg {match.commodityName}
          <span className="mono ml-2 text-[10px] font-medium text-gray-400">{match.lotCode}</span>
        </p>
        <p className="text-xs text-gray-500">
          {match.farmerName ?? 'farmer'} · up to <span className="mono font-bold">{ghs(match.bestPricePerKg)}/kg</span> ·
          hold <span className="mono font-bold">{ghs(match.holdAmount)}</span>
          {match.distanceKm !== null && <> · ≈ {match.distanceKm}km</>}
          {match.logisticsEstimate !== null && <> · logistics {ghs(match.logisticsEstimate)}</>}
        </p>
      </div>
      <StateBadge state={match.state} />
      {match.state === 'OFFERED' && simulateEnabled && (
        <button className={btnCls} onClick={onSimulate} disabled={simulating}>
          {simulating ? 'Accepting…' : 'Accept Contract'}
        </button>
      )}
      <button className={btnGhostCls} onClick={onPreview}>
        Voice & SMS
      </button>
      <Link to={`/contracts/${match.contractId}`} className="text-sm font-semibold text-[#1B4332] hover:underline">
        Contract →
      </Link>
    </div>
  );
}

function SimulationDrawer({ contractId, onClose }: { contractId: string; onClose: () => void }) {
  const [locale, setLocale] = useState('tw');
  const { data } = useQuery({
    queryKey: ['alert-preview', contractId, locale],
    queryFn: () => api<AlertPreview>(`/api/engine/alert-preview?contractId=${contractId}&locale=${locale}`),
  });

  return (
    <div className="fixed inset-0 z-30" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <aside
        className="slide-in absolute right-0 top-0 h-full w-full max-w-md overflow-y-auto bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between bg-[#1B4332] px-5 py-4">
          <div>
            <h2 className="text-sm font-bold text-white">Voice & SMS Simulation</h2>
            <p className="text-[11px] text-green-300">what the farmer's basic phone receives</p>
          </div>
          <button className="rounded-full bg-white/10 px-2.5 py-1 text-white hover:bg-white/20" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="p-5">
          <p className="mb-4 text-sm text-gray-600">
            When the engine finds this match, {data?.farmerName ?? 'the farmer'}{' '}
            <span className="mono text-[11px] text-gray-400">{data?.farmerPhone}</span> is alerted instantly:
          </p>

          <div className="mb-4 flex gap-1.5">
            {(data?.locales ?? [{ code: 'tw', label: 'Twi' }]).map((l) => (
              <button
                key={l.code}
                className={`rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
                  locale === l.code
                    ? 'border-[#1B4332] bg-[#1B4332] text-white'
                    : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                }`}
                onClick={() => setLocale(l.code)}
              >
                {l.label}
              </button>
            ))}
          </div>

          {data?.reviewNote && (
            <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-800">
              Machine-drafted translation — requires native-speaker review (Khaya AI integration) before farmer-facing
              use.
            </p>
          )}

          <p className="mb-1.5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-gray-400">
            💬 SMS {data?.smsStatus && <StateBadge state={data.smsStatus} />}
          </p>
          <div className="mb-5 rounded-2xl rounded-tl-sm bg-[#1B4332] px-4 py-3 text-sm leading-relaxed text-white shadow-sm">
            {data?.sms ?? '…'}
          </div>

          <p className="mb-1.5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-gray-400">
            📞 Automated IVR call {data?.callStatus && <StateBadge state={data.callStatus} />}
          </p>
          <div className="space-y-2">
            {(data?.voice ?? []).map((line, i) => (
              <div
                key={i}
                className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
              >
                <span className="mt-0.5 flex gap-0.5">
                  <span className="wave-bar inline-block w-0.5 rounded bg-[#D97706]" style={{ animationDelay: '0ms' }} />
                  <span className="wave-bar inline-block w-0.5 rounded bg-[#D97706]" style={{ animationDelay: '150ms' }} />
                  <span className="wave-bar inline-block w-0.5 rounded bg-[#D97706]" style={{ animationDelay: '300ms' }} />
                </span>
                {line}
              </div>
            ))}
            <div className="flex items-center gap-2 pl-1 text-xs text-gray-400">
              <span className="mono rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 font-bold text-gray-700">1</span>
              accept
              <span className="mono ml-2 rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 font-bold text-gray-700">2</span>
              decline
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

export function EnginePage() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['engine-feed'],
    queryFn: () => api<Feed>('/api/engine/feed'),
    refetchInterval: 5000,
  });
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const simulate = useMutation({
    mutationFn: (contractId: string) =>
      api('/api/engine/simulate-accept', { method: 'POST', body: JSON.stringify({ contractId }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['engine-feed'] }),
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed'),
  });

  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;
  const newestOffered = data.matches.find((m) => m.state === 'OFFERED') ?? null;
  const rest = data.matches.filter((m) => m !== newestOffered);

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-gray-900">AI Intent & Auto-Matching Engine</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Every buy order evaluated against every produce listing, continuously — commodity, quality band, distance,
            delivery clock. A match reserves the lot and alerts both sides instantly.
          </p>
        </div>
        <span className="ml-auto flex flex-shrink-0 items-center gap-1.5 rounded-full border border-green-300 bg-green-50 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-green-700">
          <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-green-600" />
          Engine live
        </span>
      </div>
      {error && (
        <p
          className="mb-4 cursor-pointer rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700"
          onClick={() => setError(null)}
        >
          {error}
        </p>
      )}

      {newestOffered && (
        <MatchBanner
          match={newestOffered}
          simulateEnabled={data.simulateEnabled}
          onPreview={() => setPreview(newestOffered.contractId)}
          onSimulate={() => simulate.mutate(newestOffered.contractId)}
          simulating={simulate.isPending}
        />
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <Card title={`Active Intent Feed — Buy Orders (${data.demands.length})`}>
          {data.demands.length === 0 ? (
            <p className="text-sm text-gray-400">No open buy orders.</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {data.demands.map((d, i) => (
                <div key={i} className="flex items-center gap-3 py-2.5 text-sm">
                  <div className="flex-1">
                    <p className="font-bold text-gray-900">
                      {d.remainingKg}kg {d.commodityName}
                      {d.mine && (
                        <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase text-blue-700">
                          mine
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-gray-500">
                      min {d.minBand} · <span className="mono font-semibold">{ghs(d.minPricePerKg)}/kg</span> ·{' '}
                      {d.regionCode} · {shortDate(d.windowStart)}–{shortDate(d.windowEnd)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title={`Active Intent Feed — Produce Listings (${data.lots.length})`}>
          {data.lots.length === 0 ? (
            <p className="text-sm text-gray-400">No open produce listings.</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {data.lots.map((l) => (
                <div key={l.lotCode} className="py-2.5 text-sm">
                  <p className="font-bold text-gray-900">
                    {l.remainingKg}kg {l.commodityName}
                    <span className="mono ml-2 text-[10px] font-medium text-gray-400">{l.lotCode}</span>
                  </p>
                  <p className="text-xs text-gray-500">
                    {l.farmerName} · declared {l.declaredBand} · {l.regionCode} · ready {shortDate(l.readyDate)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title="Engine Matches — background pairings for your demands">
        {rest.length === 0 && !newestOffered ? (
          <p className="text-sm text-gray-400">No matches yet. Post a demand — the engine takes it from there.</p>
        ) : (
          rest.map((m) => (
            <MatchRow
              key={m.contractId}
              match={m}
              simulateEnabled={data.simulateEnabled}
              onPreview={() => setPreview(m.contractId)}
              onSimulate={() => simulate.mutate(m.contractId)}
              simulating={simulate.isPending}
            />
          ))
        )}
      </Card>

      {preview && <SimulationDrawer contractId={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
