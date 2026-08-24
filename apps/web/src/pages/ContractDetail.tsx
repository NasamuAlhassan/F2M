import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, dateTime, ghs, type AvailableDriver, type ContractDetail, type JobView, type TransportQuoteView } from '../api';
import { QrImage } from '../components/QrImage';
import { btnCls, btnGhostCls, Card, CROP_EMOJI, GradeBadge, numCls, Stat, StateBadge, tableCls, tdCls, thCls, VEHICLE_EMOJI } from '../components/ui';

const GRADE_TILE: Record<string, string> = {
  A: 'bg-green-700',
  B: 'bg-amber-600',
  C: 'bg-red-600',
  REJECT: 'bg-gray-800',
};

/** Frame 03, compacted: the escrow lifecycle stepper + the MoMo payout card. */
function TransactionFlow({ data }: { data: ContractDetail }) {
  const { contract, lot, farmer } = data;
  const payout = data.payments.find((p) => p.direction === 'disbursement' && p.jobId === null);
  const steps = [
    { label: 'Accepted', sublabel: 'farmer consented', at: contract.acceptedAt },
    { label: 'Escrow', sublabel: 'hold secured', at: contract.fundedAt },
    { label: 'Picked Up', sublabel: 'goods collected', at: contract.pickupConfirmedAt },
    { label: 'Graded', sublabel: contract.finalGrade ? `grade ${contract.finalGrade}` : 'quality checked', at: contract.gradedAt },
    { label: 'Payout', sublabel: 'escrow released', at: payout ? payout.createdAt : null },
    { label: 'Settled', sublabel: 'books balanced', at: contract.settledAt },
  ];
  const doneCount = steps.filter((s) => s.at !== null).length;
  const activeIdx = steps.findIndex((s) => s.at === null);
  const refund = contract.finalAmount !== null ? contract.holdAmount - contract.finalAmount : null;

  return (
    <Card title="Transaction Flow — Mobile Money Escrow">
      <div className="relative flex items-start justify-between">
        <div className="absolute left-0 right-0 top-4 h-0.5 bg-gray-100">
          <div
            className="h-full bg-[#1B4332] transition-all duration-500"
            style={{ width: `${steps.length > 1 ? (Math.max(0, doneCount - 1) / (steps.length - 1)) * 100 : 0}%` }}
          />
        </div>
        {steps.map((step, i) => {
          const done = step.at !== null;
          const active = i === activeIdx;
          return (
            <div key={step.label} className="relative z-10 flex flex-1 flex-col items-center gap-1.5">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full border-[3px] text-xs font-extrabold transition-all ${
                  done
                    ? 'border-[#1B4332] bg-[#1B4332] text-white'
                    : active
                      ? 'step-active border-[#D97706] bg-amber-50 text-[#D97706]'
                      : 'border-gray-200 bg-white text-gray-400'
                }`}
              >
                {done ? '✓' : i + 1}
              </div>
              <div className="text-center">
                <div
                  className={`text-[10px] font-extrabold uppercase tracking-wide ${
                    done ? 'text-gray-700' : active ? 'text-[#D97706]' : 'text-gray-400'
                  }`}
                >
                  {step.label}
                </div>
                <div className="mt-0.5 max-w-[80px] text-[9px] leading-tight text-gray-400">
                  {step.at ? dateTime(step.at) : step.sublabel}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {payout && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-green-200">
          <div className="flex items-center gap-3 bg-[#1B4332] px-4 py-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#D97706] text-sm">📱</div>
            <div>
              <div className="text-sm font-bold text-white">Mobile Money Payout</div>
              <div className="text-[11px] text-green-300">Escrow released to {farmer?.name ?? 'the farmer'}</div>
            </div>
            <div
              className={`ml-auto rounded-full border px-3 py-1 text-[10px] font-bold ${
                payout.status === 'successful'
                  ? 'border-green-500/30 bg-green-500/20 text-green-300'
                  : 'border-amber-500/30 bg-amber-500/20 text-amber-300'
              }`}
            >
              {payout.status === 'successful' ? 'CONFIRMED ✓' : payout.status.toUpperCase()}
            </div>
          </div>
          <div className="grid gap-5 p-4 md:grid-cols-2">
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-gray-400">Payment Channel</p>
              <div className="flex items-center justify-between rounded-xl border border-yellow-200 bg-yellow-50 p-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-yellow-400 text-[10px] font-extrabold text-blue-900">
                    MTN
                  </div>
                  <div>
                    <div className="text-sm font-bold text-gray-800">MTN MoMo</div>
                    <div className="mono text-[11px] text-gray-500">+{payout.counterpartyMsisdn}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="mono text-base font-extrabold text-green-700">{ghs(payout.amount)}</div>
                  <div className="text-[10px] text-gray-400">
                    {payout.provider === 'mock' ? 'mock provider (demo)' : 'primary channel'}
                  </div>
                </div>
              </div>
            </div>
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-gray-400">Transaction Record</p>
              <div className="flex flex-col gap-1.5">
                {(
                  [
                    ['Lot', lot.lotCode],
                    ['Escrow held', ghs(contract.holdAmount)],
                    ['Farmer payout', contract.finalAmount !== null ? ghs(contract.finalAmount) : ghs(payout.amount)],
                    ['Refund to buyer', refund !== null ? ghs(refund) : '—'],
                    ['Timestamp', dateTime(payout.createdAt)],
                    ['Payment ref', `${payout.providerRef.slice(0, 13)}…`],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="flex items-start justify-between gap-3">
                    <span className="flex-shrink-0 text-[11px] font-medium text-gray-400">{label}</span>
                    <span className={`mono text-right text-xs font-semibold ${label === 'Payment ref' ? 'text-[#1B4332]' : 'text-gray-800'}`}>
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

export function ContractDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['contract', id],
    queryFn: () => api<ContractDetail>(`/api/contracts/${id}`),
    refetchInterval: 4000, // payments + grading move live during a demo
  });
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['contract', id] });
  const onError = (err: unknown) => setError(err instanceof Error ? err.message : 'Action failed');

  const confirmPickup = useMutation({
    mutationFn: () => api(`/api/contracts/${id}/confirm-pickup`, { method: 'POST' }),
    onSuccess: invalidate,
    onError,
  });
  const runGrading = useMutation({
    mutationFn: () => api(`/api/contracts/${id}/grade`, { method: 'POST' }),
    onSuccess: invalidate,
    onError,
  });
  const uploadPhoto = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('photo', file);
      return api(`/api/contracts/${id}/photos`, { method: 'POST', body: form });
    },
    onSuccess: invalidate,
    onError,
  });
  const callFarmer = useMutation({
    mutationFn: () => api(`/api/contracts/${id}/call-farmer`, { method: 'POST' }),
    onError,
  });

  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;
  const { contract, lot, farmer, commodity, payments, ledger, photos, gradings, match } = data;
  const canPhoto = ['FUNDS_HELD', 'PICKUP_CONFIRMED', 'DISPUTED'].includes(contract.state);
  const canGrade = ['PICKUP_CONFIRMED', 'DISPUTED'].includes(contract.state) && photos.length > 0;
  const publicUrl = `${window.location.origin}/t/${lot.id}`;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-extrabold text-gray-900">
          {CROP_EMOJI[commodity.code] ?? '📦'} {contract.quantityKg}kg {commodity.name}
        </h1>
        <StateBadge state={contract.state} />
        <Link to="/contracts" className="ml-auto text-sm font-semibold text-gray-400 hover:text-gray-600">
          ← All contracts
        </Link>
      </div>
      {error && (
        <p
          className="mb-4 cursor-pointer rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700"
          onClick={() => setError(null)}
        >
          {error}
        </p>
      )}

      <div className="flex flex-col gap-4 xl:flex-row">
        {/* ── Main column ─────────────────────────────────────── */}
        <div className="min-w-0 flex-1">
          <TransactionFlow data={data} />

          {gradings.length > 0 && (
            <Card title="AI Grading — every grade explains itself">
              {gradings.map((g) => (
                <div key={g.id} className="mb-4 rounded-xl border border-gray-100 p-3 last:mb-0">
                  <div className="flex flex-wrap items-center gap-4">
                    <div
                      className={`flex h-14 w-14 flex-shrink-0 flex-col items-center justify-center rounded-xl text-white ${
                        GRADE_TILE[g.gradeBand ?? ''] ?? 'bg-gray-300'
                      }`}
                    >
                      <span className="text-xl font-extrabold leading-none">
                        {g.gradeBand === 'REJECT' ? 'R' : (g.gradeBand ?? '…')}
                      </span>
                      <span className="text-[8px] font-bold uppercase tracking-widest opacity-80">Grade</span>
                    </div>
                    <div className="min-w-44 flex-1">
                      {g.confidence !== null && (
                        <>
                          <div className="mb-1 flex items-baseline justify-between text-xs">
                            <span className="font-bold uppercase tracking-wide text-gray-400">Confidence</span>
                            <span className="mono text-sm font-extrabold text-gray-900">
                              {(g.confidence * 100).toFixed(0)}%
                            </span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                            <div
                              className="h-full rounded-full bg-[#1B4332]"
                              style={{ width: `${Math.round(g.confidence * 100)}%` }}
                            />
                          </div>
                        </>
                      )}
                      <p className="mono mt-1.5 text-[10px] text-gray-400">
                        attempt {g.attempt} · {g.provider}
                        {g.model ? ` · ${g.model}` : ''} · {dateTime(g.createdAt)}
                      </p>
                    </div>
                    <StateBadge state={g.status} />
                  </div>
                  <table className="mt-3 w-full text-left text-sm">
                    <thead>
                      <tr>
                        <th className={thCls}>Criterion</th>
                        <th className={thCls}>Observation</th>
                        <th className={`${thCls} text-right`}>Band</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {g.reasons.map((r, i) => (
                        <tr key={i}>
                          <td className="px-4 py-2 font-semibold text-gray-700">{r.criterion}</td>
                          <td className="px-4 py-2 text-gray-600">{r.observation}</td>
                          <td className="px-4 py-2 text-right">
                            <GradeBadge grade={r.bandForCriterion} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {contract.disputeNote && g.status === 'resolved' && (
                    <p className="mt-3 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-medium text-orange-700">
                      Farmer dispute: “{contract.disputeNote}”
                    </p>
                  )}
                </div>
              ))}
            </Card>
          )}

          {['FUNDS_HELD', 'PICKUP_CONFIRMED', 'GRADED', 'DISPUTED', 'SETTLED'].includes(contract.state) && (
            <TransportSection
              contractId={contract.id}
              contractState={contract.state}
              farmerSuggested={(() => {
                const suggest = [...data.trace].reverse().find((e) => e.type === 'TRANSPORT_SUGGESTED');
                const request = [...data.trace].reverse().find((e) => e.type === 'TRANSPORT_REQUESTED');
                return !!suggest && (!request || suggest.seq > request.seq);
              })()}
              farmerName={farmer?.name ?? 'The farmer'}
              onError={onError}
            />
          )}

          <Card
            title={`Pickup Photos (${photos.length})`}
            actions={
              canPhoto ? (
                <div className="flex flex-wrap gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) uploadPhoto.mutate(file);
                      e.target.value = '';
                    }}
                  />
                  <button className={btnGhostCls} onClick={() => fileRef.current?.click()} disabled={uploadPhoto.isPending}>
                    {uploadPhoto.isPending ? 'Uploading…' : '📷 Upload photo'}
                  </button>
                  {contract.state === 'FUNDS_HELD' && (
                    <button className={btnCls} onClick={() => confirmPickup.mutate()} disabled={confirmPickup.isPending}>
                      Confirm pickup
                    </button>
                  )}
                  {canGrade && (
                    <button className={btnCls} onClick={() => runGrading.mutate()} disabled={runGrading.isPending}>
                      {runGrading.isPending ? 'Grading…' : contract.state === 'DISPUTED' ? '🔬 Run re-grade' : '🔬 Run AI grading'}
                    </button>
                  )}
                </div>
              ) : undefined
            }
          >
            {photos.length === 0 ? (
              <p className="text-sm text-gray-400">
                No photos yet. {canPhoto ? 'Upload pickup photos — grading needs at least one.' : ''}
              </p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {photos.map((p) => (
                  <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                    <img
                      src={p.url}
                      alt="pickup"
                      className="h-24 w-24 rounded-xl border border-gray-100 object-cover shadow-sm transition-shadow hover:shadow-md"
                    />
                  </a>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* ── Right rail ──────────────────────────────────────── */}
        <aside className="w-full flex-shrink-0 xl:w-80">
          <div className="xl:sticky xl:top-4">
            <Card title="Parties & Terms">
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-gray-900">👨🏾‍🌾 {farmer?.name}</p>
                    <p className="mono text-[11px] text-gray-500">
                      {farmer?.phone} · {farmer?.regionCode}
                    </p>
                  </div>
                  <button
                    className="flex-shrink-0 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 transition-colors hover:bg-gray-50"
                    onClick={() => callFarmer.mutate()}
                    disabled={callFarmer.isPending}
                  >
                    {callFarmer.isSuccess ? '📞 Queued ✓' : '📞 Call'}
                  </button>
                </div>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="mono text-xs text-gray-400">{lot.lotCode}</span>
                  <span className="text-[11px] text-gray-500">
                    declared {lot.declaredBand} · score{' '}
                    <span className="mono font-bold text-[#D97706]">{match.score.toFixed(2)}</span>
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-gray-50 p-2 text-center">
                    <div className="mono text-sm font-extrabold text-[#1B4332]">{ghs(contract.holdAmount)}</div>
                    <div className="text-[9px] uppercase tracking-wide text-gray-400">escrow hold</div>
                  </div>
                  <div className="rounded-lg bg-gray-50 p-2 text-center">
                    <div className="mono text-sm font-extrabold text-gray-900">
                      {contract.finalAmount !== null ? ghs(contract.finalAmount) : '—'}
                    </div>
                    <div className="text-[9px] uppercase tracking-wide text-gray-400">
                      {contract.finalGrade ? `final · grade ${contract.finalGrade}` : 'awaiting grade'}
                    </div>
                  </div>
                </div>
                <div>
                  <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                    Price per grade (frozen at offer)
                  </p>
                  <div className="flex gap-1.5">
                    {(['A', 'B', 'C', 'REJECT'] as const).map((band) => (
                      <div
                        key={band}
                        className={`flex flex-1 flex-col items-center gap-0.5 rounded-lg border py-1.5 ${
                          contract.finalGrade === band ? 'border-[#1B4332] bg-green-50' : 'border-gray-100'
                        }`}
                      >
                        <GradeBadge grade={band} />
                        <span className="mono text-[10px] font-semibold text-gray-600">
                          {(contract.priceTerms[band] / 100).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Card>

            <Card title="Traceability QR">
              <div className="flex items-center gap-3">
                <div className="h-24 w-24 flex-shrink-0 overflow-hidden rounded-lg border-2 border-[#1B4332] p-1">
                  <QrImage url={publicUrl} />
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="text-[11px] leading-snug text-gray-500">
                    Scans to the public, append-only chain of custody — no login, no money details.
                  </p>
                  <div className="flex flex-col gap-1">
                    <button
                      className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50"
                      onClick={() => {
                        navigator.clipboard.writeText(publicUrl).then(() => {
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        });
                      }}
                    >
                      {copied ? '✓ Copied' : 'Copy link'}
                    </button>
                    <div className="flex gap-1">
                      <Link
                        to={`/t/${lot.id}`}
                        target="_blank"
                        className="flex-1 rounded-lg bg-[#1B4332] px-2 py-1 text-center text-[11px] font-bold text-white hover:bg-green-900"
                      >
                        Public page ↗
                      </Link>
                      <Link
                        to={`/lots/${lot.id}/trace`}
                        className="flex-1 rounded-lg border border-gray-200 px-2 py-1 text-center text-[11px] font-semibold text-gray-600 hover:bg-gray-50"
                      >
                        Full trace
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            </Card>

            <Card title={`Payments (${payments.length})`}>
              {payments.length === 0 ? (
                <p className="text-sm text-gray-400">The hold fires when the farmer accepts.</p>
              ) : (
                <div className="space-y-2">
                  {payments.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-gray-800">
                          {p.direction === 'collection' ? 'Hold (buyer)' : p.jobId ? 'Driver payout' : 'Farmer payout'}
                        </p>
                        <p className="mono text-[10px] text-gray-400">{dateTime(p.createdAt)}</p>
                      </div>
                      <span className={`${numCls} flex-shrink-0 font-bold text-[#1B4332]`}>{ghs(p.amount)}</span>
                      <StateBadge state={p.status} />
                    </div>
                  ))}
                </div>
              )}
              {ledger.length > 0 && (
                <details className="mt-3 border-t border-gray-100 pt-2">
                  <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:text-gray-600">
                    Ledger — every journal sums to zero
                  </summary>
                  <div className="mt-2 overflow-hidden rounded-lg border border-gray-100">
                    <table className="w-full text-left text-[10px]">
                      <tbody className="divide-y divide-gray-50">
                        {ledger.map((l) => (
                          <tr key={l.id}>
                            <td className="mono max-w-32 truncate px-2 py-1 text-gray-700">{l.account}</td>
                            <td className="mono px-2 py-1 text-right text-red-600">{l.debit ? `DR ${ghs(l.debit)}` : ''}</td>
                            <td className="mono px-2 py-1 text-right text-green-700">{l.credit ? `CR ${ghs(l.credit)}` : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </Card>
          </div>
        </aside>
      </div>
    </div>
  );
}

/** The middle-mile bridge: quote → request or direct-hire → live job → confirm delivery. */
function TransportSection({
  contractId,
  contractState,
  farmerSuggested,
  farmerName,
  onError,
}: {
  contractId: string;
  contractState: string;
  farmerSuggested: boolean;
  farmerName: string;
  onError: (err: unknown) => void;
}) {
  const queryClient = useQueryClient();
  const [showDrivers, setShowDrivers] = useState(false);
  const { data: jobData } = useQuery({
    queryKey: ['transport', contractId],
    queryFn: () => api<{ job: JobView | null }>(`/api/contracts/${contractId}/transport`),
    refetchInterval: 4000,
  });
  const job = jobData?.job ?? null;
  const canRequest = contractState === 'FUNDS_HELD' && (!job || ['CANCELLED', 'CANCELLED_REFUNDED'].includes(job.state));
  const { data: quoteData } = useQuery({
    queryKey: ['transport-quote', contractId],
    queryFn: () => api<{ quotes: TransportQuoteView[] }>(`/api/contracts/${contractId}/transport-quote`),
    enabled: canRequest,
  });
  const { data: driverData } = useQuery({
    queryKey: ['drivers-available'],
    queryFn: () => api<{ drivers: AvailableDriver[] }>('/api/drivers/available'),
    enabled: canRequest && showDrivers,
    refetchInterval: 10000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['transport', contractId] });
  const request = useMutation({
    mutationFn: (body: { vehicleClassCode?: string; preferredDriverId?: string }) =>
      api(`/api/contracts/${contractId}/transport`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: invalidate,
    onError,
  });
  const retry = useMutation({
    mutationFn: (jobId: string) => api(`/api/jobs/${jobId}/retry-dispatch`, { method: 'POST' }),
    onSuccess: invalidate,
    onError,
  });
  const deliver = useMutation({
    mutationFn: (jobId: string) => api(`/api/jobs/${jobId}/deliver`, { method: 'POST' }),
    onSuccess: invalidate,
    onError,
  });

  return (
    <Card title="Transport — the middle-mile bridge">
      {job && !['CANCELLED', 'CANCELLED_REFUNDED'].includes(job.state) ? (
        <div className="flex flex-wrap items-center gap-5 rounded-xl border border-gray-100 bg-gray-50 p-3">
          <span className="mono text-sm font-extrabold text-gray-900">{job.jobCode}</span>
          <StateBadge state={job.state} />
          <Stat value={job.vehicleClassName} caption="vehicle" />
          <Stat value={`${job.distanceKm}km`} caption="distance" />
          <Stat value={ghs(job.quoteAmount)} caption="escrowed fee" accent />
          {job.driver && (
            <div className="text-sm">
              <p className="font-bold text-gray-900">🧑🏾‍✈️ {job.driver.name}</p>
              <p className="mono text-[10px] text-gray-400">{job.driver.phone}</p>
            </div>
          )}
          <div className="ml-auto">
            {job.state === 'NO_DRIVER' && (
              <button className={btnGhostCls} onClick={() => retry.mutate(job.id)} disabled={retry.isPending}>
                Retry dispatch
              </button>
            )}
            {job.state === 'PICKED_UP' && (
              <button className={btnCls} onClick={() => deliver.mutate(job.id)} disabled={deliver.isPending}>
                ✓ Confirm delivery received
              </button>
            )}
            {job.state === 'DELIVERED' && (
              <span className="text-sm font-semibold text-gray-500">Driver payout on the way…</span>
            )}
            {job.state === 'PAID' && <span className="text-sm font-bold text-green-700">Driver paid ✓</span>}
          </div>
        </div>
      ) : canRequest && quoteData ? (
        <div>
          {farmerSuggested && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5">
              <span className="pulse-dot inline-block h-2 w-2 rounded-full bg-amber-500" />
              <p className="text-sm font-semibold text-amber-900">
                {farmerName} has asked for a driver — approve by requesting one below; the fee escrows from your
                account.
              </p>
            </div>
          )}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-gray-500">
              Instant quotes for every vehicle that fits the load. The fee is held in escrow when a driver accepts and
              released on your delivery confirmation.
            </p>
            <button
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-bold text-gray-600 transition-colors hover:bg-gray-50"
              onClick={() => setShowDrivers((v) => !v)}
            >
              {showDrivers ? 'Hide drivers' : '🧑🏾‍✈️ Choose a driver'}
            </button>
          </div>
          {showDrivers && (
            <div className="mb-3 space-y-2 rounded-xl border border-gray-100 bg-gray-50 p-3">
              {!driverData ? (
                <p className="text-sm text-gray-400">Loading drivers…</p>
              ) : driverData.drivers.length === 0 ? (
                <p className="text-sm text-gray-400">No drivers are online right now — auto-dispatch below still works.</p>
              ) : (
                driverData.drivers.map((d) => (
                  <div key={d.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-white p-2.5 shadow-sm">
                    <span className="text-xl">{VEHICLE_EMOJI[d.vehicleClassCode] ?? '🚚'}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-gray-900">
                        {d.name}
                        {d.busy && (
                          <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[9px] font-bold uppercase text-gray-500">
                            on a job
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] text-gray-500">
                        {d.vehicleClassName} · ≤{d.capacityKg}kg ·{' '}
                        {d.routeRegions.length ? `${d.routeRegions.length} route region${d.routeRegions.length > 1 ? 's' : ''}` : 'serves anywhere'}
                      </p>
                    </div>
                    <a
                      href={`tel:${d.phone}`}
                      className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                    >
                      📞 Call
                    </a>
                    <button
                      className="rounded-lg bg-[#1B4332] px-3 py-1 text-xs font-bold text-white transition-colors hover:bg-green-900 disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={d.busy || request.isPending}
                      onClick={() => request.mutate({ preferredDriverId: d.id })}
                    >
                      Hire
                    </button>
                  </div>
                ))
              )}
              <p className="text-[10px] text-gray-400">
                Hiring offers the job to your chosen driver first at their vehicle's rate — if they decline, dispatch
                falls back to nearest-first.
              </p>
            </div>
          )}
          <table className={tableCls}>
            <thead>
              <tr>
                <th className={thCls}>Vehicle</th>
                <th className={thCls}>Capacity</th>
                <th className={thCls}>Distance</th>
                <th className={thCls}>Rate</th>
                <th className={thCls}>Quote</th>
                <th className={thCls} />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {quoteData.quotes.map((q, i) => (
                <tr key={q.vehicleClassCode} className="hover:bg-gray-50">
                  <td className={`${tdCls} font-bold text-gray-900`}>
                    <span className="mr-1.5 text-lg">{VEHICLE_EMOJI[q.vehicleClassCode] ?? '🚚'}</span>
                    {q.vehicleClassName}
                    {i === 0 && (
                      <span className="ml-2 rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-bold uppercase text-green-700">
                        cheapest
                      </span>
                    )}
                  </td>
                  <td className={`${tdCls} ${numCls} text-xs`}>{q.capacityKg}kg</td>
                  <td className={`${tdCls} ${numCls} text-xs`}>{q.distanceKm}km</td>
                  <td className={`${tdCls} mono text-[11px] text-gray-500`}>
                    {ghs(q.baseFee)} + {ghs(q.perKmRate)}/km
                  </td>
                  <td className={`${tdCls} mono font-extrabold text-[#D97706]`}>{ghs(q.quoteAmount)}</td>
                  <td className={`${tdCls} text-right`}>
                    <button
                      className={btnCls}
                      onClick={() => request.mutate({ vehicleClassCode: q.vehicleClassCode })}
                      disabled={request.isPending}
                    >
                      {request.isPending ? 'Requesting…' : 'Request Driver'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-gray-400">
          {job ? 'Previous transport was cancelled.' : 'No transport requested for this contract.'}
        </p>
      )}
    </Card>
  );
}
