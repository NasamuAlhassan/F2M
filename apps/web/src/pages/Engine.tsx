import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, dateTime, ghs, shortDate } from '../api';
import { btnCls, btnGhostCls, Card, StateBadge } from '../components/ui';

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

function MatchCard({
  match,
  simulateEnabled,
  highlight,
  onPreview,
  onSimulate,
  simulating,
}: {
  match: FeedMatch;
  simulateEnabled: boolean;
  highlight?: boolean;
  onPreview: () => void;
  onSimulate: () => void;
  simulating: boolean;
}) {
  return (
    <div
      className={`mb-3 rounded-lg border p-4 last:mb-0 ${
        highlight ? 'border-green-500 bg-green-50 shadow-md' : 'border-stone-200 bg-white shadow-sm'
      }`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-3">
        {highlight && (
          <span className="rounded-full bg-green-600 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-white">
            🤖 AI match found
          </span>
        )}
        {match.scorePct !== null && (
          <span className="text-lg font-bold text-green-800">{match.scorePct}% match</span>
        )}
        <StateBadge state={match.state} />
        <span className="ml-auto text-xs text-stone-400">{dateTime(match.createdAt)}</span>
      </div>
      <p className="text-sm text-stone-700">
        <span className="font-semibold">
          {match.quantityKg}kg {match.commodityName}
        </span>{' '}
        from <span className="font-medium">{match.farmerName ?? 'farmer'}</span> ({match.lotCode}) · up to{' '}
        {ghs(match.bestPricePerKg)}/kg · hold {ghs(match.holdAmount)}
        {match.distanceKm !== null && <> · route ≈ {match.distanceKm}km</>}
        {match.logisticsEstimate !== null && <> · est. logistics {ghs(match.logisticsEstimate)}</>}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {match.state === 'OFFERED' && (
          <>
            <span className="text-xs text-stone-500">Awaiting farmer acceptance (SMS + voice call sent)</span>
            {simulateEnabled && (
              <button className={btnCls} onClick={onSimulate} disabled={simulating}>
                {simulating ? 'Accepting…' : 'Accept Contract (demo: farmer presses 1)'}
              </button>
            )}
          </>
        )}
        <button className={btnGhostCls} onClick={onPreview}>
          Voice & SMS preview
        </button>
        <Link to={`/contracts/${match.contractId}`} className="text-sm text-green-700 hover:underline">
          Contract →
        </Link>
      </div>
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
      <div className="absolute inset-0 bg-black/30" />
      <aside
        className="absolute right-0 top-0 h-full w-full max-w-md overflow-y-auto bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Voice & SMS simulation</h2>
          <button className="rounded px-2 py-1 text-stone-500 hover:bg-stone-100" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="p-4">
          <p className="mb-3 text-sm text-stone-600">
            What {data?.farmerName ?? 'the farmer'}{' '}
            <span className="text-xs text-stone-400">{data?.farmerPhone}</span> receives on a basic phone when the
            engine finds this match:
          </p>

          <div className="mb-4 flex gap-1.5">
            {(data?.locales ?? [{ code: 'tw', label: 'Twi' }]).map((l) => (
              <button
                key={l.code}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  locale === l.code
                    ? 'border-green-600 bg-green-600 text-white'
                    : 'border-stone-300 text-stone-600 hover:bg-stone-100'
                }`}
                onClick={() => setLocale(l.code)}
              >
                {l.label}
              </button>
            ))}
          </div>

          {data?.reviewNote && (
            <p className="mb-3 rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Machine-drafted translation — requires native-speaker review (Khaya AI integration) before farmer-facing
              use.
            </p>
          )}

          <p className="mb-1 text-xs font-semibold uppercase text-stone-400">
            SMS {data?.smsStatus && <StateBadge state={data.smsStatus} />}
          </p>
          <div className="mb-4 rounded-2xl rounded-tl-sm bg-green-100 px-4 py-3 text-sm text-green-950 shadow-sm">
            {data?.sms ?? '…'}
          </div>

          <p className="mb-1 text-xs font-semibold uppercase text-stone-400">
            Automated IVR call {data?.callStatus && <StateBadge state={data.callStatus} />}
          </p>
          <div className="space-y-2">
            {(data?.voice ?? []).map((line, i) => (
              <div key={i} className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
                🔊 {line}
              </div>
            ))}
            <div className="flex gap-2 pl-1 text-xs text-stone-400">
              <span className="rounded border border-stone-300 px-2 py-0.5 font-mono">1</span> accept
              <span className="rounded border border-stone-300 px-2 py-0.5 font-mono">2</span> decline
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

  if (!data) return <p className="text-sm text-stone-500">Loading…</p>;
  const newestOffered = data.matches.find((m) => m.state === 'OFFERED') ?? null;
  const rest = data.matches.filter((m) => m !== newestOffered);

  return (
    <div>
      <h1 className="mb-1 text-xl font-bold">AI Intent & Auto-Matching Engine</h1>
      <p className="mb-4 text-sm text-stone-500">
        The engine evaluates every buy order against every produce listing continuously — commodity, quality band,
        distance, and delivery clock. When it finds a match it reserves the lot and alerts both sides instantly.
      </p>
      {error && (
        <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-800" onClick={() => setError(null)}>
          {error}
        </p>
      )}

      {newestOffered && (
        <MatchCard
          match={newestOffered}
          simulateEnabled={data.simulateEnabled}
          highlight
          onPreview={() => setPreview(newestOffered.contractId)}
          onSimulate={() => simulate.mutate(newestOffered.contractId)}
          simulating={simulate.isPending}
        />
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <Card title={`Active intent feed — buy orders (${data.demands.length})`}>
          {data.demands.length === 0 ? (
            <p className="text-sm text-stone-500">No open buy orders.</p>
          ) : (
            <div className="divide-y divide-stone-100">
              {data.demands.map((d, i) => (
                <div key={i} className="py-2 text-sm">
                  <p className="font-medium">
                    {d.remainingKg}kg {d.commodityName}
                    {d.mine && <span className="ml-1.5 rounded-full bg-sky-100 px-1.5 text-xs text-sky-800">mine</span>}
                  </p>
                  <p className="text-xs text-stone-500">
                    min {d.minBand} · {ghs(d.minPricePerKg)}/kg · {d.regionCode} · {shortDate(d.windowStart)}–
                    {shortDate(d.windowEnd)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title={`Active intent feed — produce listings (${data.lots.length})`}>
          {data.lots.length === 0 ? (
            <p className="text-sm text-stone-500">No open produce listings.</p>
          ) : (
            <div className="divide-y divide-stone-100">
              {data.lots.map((l) => (
                <div key={l.lotCode} className="py-2 text-sm">
                  <p className="font-medium">
                    {l.remainingKg}kg {l.commodityName}{' '}
                    <span className="text-xs font-normal text-stone-400">{l.lotCode}</span>
                  </p>
                  <p className="text-xs text-stone-500">
                    {l.farmerName} · declared {l.declaredBand} · {l.regionCode} · ready {shortDate(l.readyDate)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title="Engine matches — background pairings for your demands">
        {rest.length === 0 && !newestOffered ? (
          <p className="text-sm text-stone-500">No matches yet. Post a demand — the engine takes it from there.</p>
        ) : (
          rest.map((m) => (
            <MatchCard
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
