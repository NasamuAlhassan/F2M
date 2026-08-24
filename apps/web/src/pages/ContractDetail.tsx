import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, dateTime, ghs, type ContractDetail, type JobView, type TransportQuoteView } from '../api';
import { btnCls, btnGhostCls, Card, CROP_EMOJI, GradeBadge, numCls, Stat, StateBadge, tableCls, tdCls, thCls, VEHICLE_EMOJI } from '../components/ui';

const GRADE_TILE: Record<string, string> = {
  A: 'bg-green-700',
  B: 'bg-amber-600',
  C: 'bg-red-600',
  REJECT: 'bg-gray-800',
};

/** Frame 03: the escrow lifecycle as a numbered stepper + the MoMo payout card. */
function TransactionFlow({ data }: { data: ContractDetail }) {
  const { contract, lot, farmer } = data;
  const payout = data.payments.find((p) => p.direction === 'disbursement' && p.jobId === null);
  const steps = [
    { label: 'Accepted', sublabel: 'farmer consented', at: contract.acceptedAt },
    { label: 'Escrow Funded', sublabel: 'hold secured', at: contract.fundedAt },
    { label: 'Picked Up', sublabel: 'goods collected', at: contract.pickupConfirmedAt },
    { label: 'AI Graded', sublabel: contract.finalGrade ? `grade ${contract.finalGrade}` : 'quality checked', at: contract.gradedAt },
    { label: 'MoMo Payout', sublabel: 'escrow released', at: payout ? payout.createdAt : null },
    { label: 'Settled', sublabel: 'books balanced', at: contract.settledAt },
  ];
  const doneCount = steps.filter((s) => s.at !== null).length;
  const activeIdx = steps.findIndex((s) => s.at === null);
  const refund = contract.finalAmount !== null ? contract.holdAmount - contract.finalAmount : null;

  return (
    <Card title="Transaction Flow — Mobile Money Escrow">
      <div className="relative flex items-start justify-between">
        <div className="absolute left-0 right-0 top-6 h-0.5 bg-gray-100">
          <div
            className="h-full bg-[#1B4332] transition-all duration-500"
            style={{ width: `${steps.length > 1 ? (Math.max(0, doneCount - 1) / (steps.length - 1)) * 100 : 0}%` }}
          />
        </div>
        {steps.map((step, i) => {
          const done = step.at !== null;
          const active = i === activeIdx;
          return (
            <div key={step.label} className="relative z-10 flex flex-1 flex-col items-center gap-2.5">
              <div
                className={`flex h-12 w-12 items-center justify-center rounded-full border-4 text-sm font-extrabold transition-all ${
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
                  className={`text-xs font-extrabold uppercase tracking-wide ${
                    done ? 'text-gray-700' : active ? 'text-[#D97706]' : 'text-gray-400'
                  }`}
                >
                  {step.label}
                </div>
                <div className="mt-0.5 max-w-[90px] text-[10px] leading-tight text-gray-400">
                  {step.at ? dateTime(step.at) : step.sublabel}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {payout && (
        <div className="mt-6 overflow-hidden rounded-2xl border border-green-200">
          <div className="flex items-center gap-3 bg-[#1B4332] px-5 py-3.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#D97706] text-base">📱</div>
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
          <div className="grid gap-6 p-5 md:grid-cols-2">
            <div>
              <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-gray-400">Payment Channel</p>
              <div className="flex items-center justify-between rounded-xl border border-yellow-200 bg-yellow-50 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-yellow-400 text-[10px] font-extrabold text-blue-900">
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
              <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-gray-400">Transaction Record</p>
              <div className="flex flex-col gap-2">
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
              <div className="mt-4 border-t border-gray-100 pt-3">
                <Link
                  to={`/lots/${lot.id}/trace`}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#1B4332] py-2 text-sm font-bold text-white transition-colors hover:bg-green-900"
                >
                  🔗 View append-only trace
                </Link>
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

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-extrabold text-gray-900">
          {CROP_EMOJI[commodity.code] ?? '📦'} {contract.quantityKg}kg {commodity.name}
        </h1>
        <StateBadge state={contract.state} />
        <Link to={`/lots/${lot.id}/trace`} className="ml-auto text-sm font-semibold text-[#1B4332] hover:underline">
          Full trace timeline →
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

      <Card title="Parties & Terms">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400">Farmer</p>
            <p className="mt-1 text-sm font-bold text-gray-900">{farmer?.name}</p>
            <p className="mono text-[11px] text-gray-500">
              {farmer?.phone} · {farmer?.regionCode}
              {farmer?.district ? ` · ${farmer.district}` : ''}
            </p>
            <button
              className="mt-1.5 rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-semibold text-gray-600 transition-colors hover:bg-gray-50"
              onClick={() => callFarmer.mutate()}
              disabled={callFarmer.isPending}
            >
              {callFarmer.isSuccess ? '📞 Call queued ✓' : '📞 Request call'}
            </button>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400">Lot</p>
            <p className="mono mt-1 text-sm font-bold text-gray-900">{lot.lotCode}</p>
            <p className="text-[11px] text-gray-500">
              declared {lot.declaredBand} · match score{' '}
              <span className="mono font-bold text-[#D97706]">{match.score.toFixed(2)}</span>
            </p>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400">Escrow Hold</p>
            <p className="mono mt-1 text-lg font-extrabold text-[#1B4332]">{ghs(contract.holdAmount)}</p>
            <p className="text-[11px] text-gray-500">held at acceptance</p>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400">Final Amount</p>
            <p className="mono mt-1 text-lg font-extrabold text-gray-900">
              {contract.finalAmount !== null ? ghs(contract.finalAmount) : '—'}
            </p>
            <p className="text-[11px] text-gray-500">
              {contract.finalGrade ? `graded ${contract.finalGrade}` : 'awaiting grade'}
            </p>
          </div>
        </div>

        <div className="mt-5">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-gray-400">
            Price per grade — frozen at offer
          </p>
          <div className="flex flex-wrap gap-2">
            {(['A', 'B', 'C', 'REJECT'] as const).map((band) => (
              <div
                key={band}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
                  contract.finalGrade === band
                    ? 'border-[#1B4332] bg-green-50 font-bold text-[#1B4332]'
                    : 'border-gray-100 bg-white text-gray-600'
                }`}
              >
                <GradeBadge grade={band} />
                <span className={numCls}>{ghs(contract.priceTerms[band])}</span>
                <span className="text-[10px] text-gray-400">/kg</span>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <TransactionFlow data={data} />

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
                  className="h-28 w-28 rounded-xl border border-gray-100 object-cover shadow-sm transition-shadow hover:shadow-md"
                />
              </a>
            ))}
          </div>
        )}
      </Card>

      {gradings.length > 0 && (
        <Card title="AI Grading — every grade explains itself">
          {gradings.map((g) => (
            <div key={g.id} className="mb-4 rounded-xl border border-gray-100 p-4 last:mb-0">
              <div className="flex flex-wrap items-center gap-4">
                <div
                  className={`flex h-16 w-16 flex-shrink-0 flex-col items-center justify-center rounded-xl text-white ${
                    GRADE_TILE[g.gradeBand ?? ''] ?? 'bg-gray-300'
                  }`}
                >
                  <span className="text-2xl font-extrabold leading-none">
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
              <table className="mt-4 w-full text-left text-sm">
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
          <p className="text-[10px] text-gray-400">
            The farmer sees this grade, its payout, and the top reason on her phone — and can dispute it within the window.
          </p>
        </Card>
      )}

      {['FUNDS_HELD', 'PICKUP_CONFIRMED', 'GRADED', 'DISPUTED', 'SETTLED'].includes(contract.state) && (
        <TransportSection contractId={contract.id} contractState={contract.state} onError={onError} />
      )}

      <Card title="Payments & Ledger">
        {payments.length === 0 ? (
          <p className="text-sm text-gray-400">No payments yet — the hold fires when the farmer accepts.</p>
        ) : (
          <table className={`${tableCls} mb-4`}>
            <thead>
              <tr>
                <th className={thCls}>Direction</th>
                <th className={thCls}>Amount</th>
                <th className={thCls}>Counterparty</th>
                <th className={thCls}>Provider</th>
                <th className={thCls}>Status</th>
                <th className={thCls}>When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className={`${tdCls} font-semibold text-gray-800`}>
                    {p.direction === 'collection' ? 'Hold (buyer)' : 'Payout'}
                  </td>
                  <td className={`${tdCls} ${numCls} font-bold text-[#1B4332]`}>{ghs(p.amount)}</td>
                  <td className={`${tdCls} ${numCls} text-xs text-gray-500`}>{p.counterpartyMsisdn}</td>
                  <td className={`${tdCls} text-xs text-gray-500`}>{p.provider}</td>
                  <td className={tdCls}>
                    <StateBadge state={p.status} />
                  </td>
                  <td className={`${tdCls} mono text-[11px] text-gray-500`}>{dateTime(p.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {ledger.length > 0 && (
          <>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-gray-400">
              Ledger — produce and transport money in one book (every journal sums to zero)
            </p>
            <div className="overflow-hidden rounded-lg border border-gray-100">
              <table className="w-full text-left text-xs">
                <tbody className="divide-y divide-gray-50">
                  {ledger.map((l) => (
                    <tr key={l.id} className="hover:bg-gray-50">
                      <td className="mono px-3 py-1.5 text-gray-700">{l.account}</td>
                      <td className="mono px-3 py-1.5 text-right text-red-600">{l.debit ? `DR ${ghs(l.debit)}` : ''}</td>
                      <td className="mono px-3 py-1.5 text-right text-green-700">{l.credit ? `CR ${ghs(l.credit)}` : ''}</td>
                      <td className="px-3 py-1.5 text-gray-400">{l.memoKey?.replace('ledger.', '')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

/** The middle-mile bridge: quote → request → live job status → confirm delivery. */
function TransportSection({
  contractId,
  contractState,
  onError,
}: {
  contractId: string;
  contractState: string;
  onError: (err: unknown) => void;
}) {
  const queryClient = useQueryClient();
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

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['transport', contractId] });
  const request = useMutation({
    mutationFn: (vehicleClassCode?: string) =>
      api(`/api/contracts/${contractId}/transport`, { method: 'POST', body: JSON.stringify({ vehicleClassCode }) }),
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
        <div className="flex flex-wrap items-center gap-5 rounded-xl border border-gray-100 bg-gray-50 p-4">
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
          <p className="mb-3 text-sm text-gray-500">
            Instant quotes for every vehicle that fits the load. The fee is held in escrow when a driver accepts and
            released on your delivery confirmation.
          </p>
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
                      onClick={() => request.mutate(q.vehicleClassCode)}
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
