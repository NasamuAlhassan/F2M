import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, dateTime, ghs, type AvailableDriver, type ContractDetail, type JobView, type TransportQuoteView } from '../api';
import { Glyph, VehicleMark } from '../components/engrave';
import { QrImage } from '../components/QrImage';
import { btnCls, btnGhostCls, Card, ErrorStamp, GradeBadge, numCls, StateBadge, tableCls, TableScroll, tdCls, thCls } from '../components/ui';

/** The escrow lifecycle as numbered engraved stations + the payout advice. */
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
      {/* Six stations need ~600px of rail; on narrow paper the strip scrolls in
          its own frame — the same rule the SVG route spine follows. */}
      <div className="overflow-x-auto">
      <div className="relative flex min-w-[600px] items-start justify-between">
        <div className="absolute left-0 right-0 top-4 h-px bg-[var(--ink-2)]">
          <div
            className="h-full bg-[var(--ink)] transition-all duration-500"
            style={{ width: `${steps.length > 1 ? (Math.max(0, doneCount - 1) / (steps.length - 1)) * 100 : 0}%` }}
          />
        </div>
        {steps.map((step, i) => {
          const done = step.at !== null;
          const active = i === activeIdx;
          return (
            <div key={step.label} className="relative z-10 flex flex-1 flex-col items-center gap-1.5">
              <div
                className={`serial flex h-8 w-8 items-center justify-center rounded-full border-[1.5px] text-xs font-bold ${
                  done
                    ? 'border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]'
                    : active
                      ? 'ember border-[var(--gold)] bg-[var(--gold-wash)] text-[var(--gold-deep)]'
                      : 'border-[var(--ink-3)] bg-[var(--paper)] text-[var(--ink-4)]'
                }`}
              >
                {done ? <Glyph name="check" className="h-3.5 w-3.5" /> : i + 1}
              </div>
              <div className="text-center">
                <div
                  className={`smallcaps ${done ? 'text-[var(--ink)]' : active ? 'text-[var(--gold-deep)]' : 'text-[var(--ink-4)]'}`}
                >
                  {step.label}
                </div>
                <div className="serial mt-0.5 max-w-[84px] text-[11px] leading-tight text-[var(--ink-6)]">
                  {step.at ? dateTime(step.at) : step.sublabel}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      </div>

      {payout && (
        <div className="certificate seal-land mt-4 overflow-hidden bg-[var(--paper)]">
          <div className="plate flex items-center gap-3 px-4 py-3">
            <div>
              <div className="display text-sm font-semibold tracking-[0.1em]">MOBILE MONEY PAYOUT</div>
              <div className="smallcaps text-[var(--ink-3)]">escrow released to {farmer?.name ?? 'the farmer'}</div>
            </div>
            <span
              className={`stamp ml-auto px-2 py-0.5 text-[11px] ${
                payout.status === 'successful' ? 'text-[var(--paper)]' : 'text-[var(--ink-3)]'
              }`}
            >
              {payout.status === 'successful' ? 'Confirmed' : payout.status}
            </span>
          </div>
          <div className="grid gap-5 p-4 md:grid-cols-2">
            <div>
              <p className="rule-double smallcaps mb-2.5 pb-1.5 text-[var(--ink-6)]">Payment Channel</p>
              <div className="flex items-center justify-between border border-[var(--ink-2)] bg-[var(--paper-lift)] p-3">
                <div>
                  <div className="stamp inline-block px-1.5 py-0.5 text-[11px] text-[var(--ink)]">MTN MoMo</div>
                  <div className="serial mt-1.5 text-xs text-[var(--ink-6)]">+{payout.counterpartyMsisdn}</div>
                </div>
                <div className="text-right">
                  <div className="serial text-lg font-bold text-[var(--gold-deep)]">{ghs(payout.amount)}</div>
                  <div className="smallcaps text-[var(--ink-6)]">
                    {payout.provider === 'mock' ? 'mock provider (demo)' : 'primary channel'}
                  </div>
                </div>
              </div>
            </div>
            <div>
              <p className="rule-double smallcaps mb-2.5 pb-1.5 text-[var(--ink-6)]">Transaction Record</p>
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
                    <span className="smallcaps flex-shrink-0 text-[var(--ink-6)]">{label}</span>
                    <span className="serial text-right text-xs font-semibold text-[var(--ink)]">{value}</span>
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

  if (!data) return <p className="text-sm text-[var(--ink-6)]">Loading…</p>;
  const { contract, lot, farmer, commodity, payments, ledger, photos, gradings, match } = data;
  const canPhoto = ['FUNDS_HELD', 'PICKUP_CONFIRMED', 'DISPUTED'].includes(contract.state);
  const canGrade = ['PICKUP_CONFIRMED', 'DISPUTED'].includes(contract.state) && photos.length > 0;
  const publicUrl = `${window.location.origin}/t/${lot.id}`;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="display text-xl font-semibold tracking-[0.05em] text-[var(--ink)]">
          {contract.quantityKg}kg {commodity.name}
        </h1>
        <span className="serial text-sm text-[var(--ink-6)]">№ {lot.lotCode}</span>
        <StateBadge state={contract.state} />
        <Link to="/contracts" className="smallcaps ml-auto text-[var(--ink-6)] hover:text-[var(--ink)]">
          ← All contracts
        </Link>
      </div>
      {error && (
        <ErrorStamp message={error} onDismiss={() => setError(null)} className="mb-4" />
      )}

      <div className="flex flex-col gap-4 xl:flex-row">
        {/* ── Main column ─────────────────────────────────────── */}
        <div className="min-w-0 flex-1">
          <TransactionFlow data={data} />

          {gradings.length > 0 && (
            <Card title="AI Grading — every grade explains itself">
              {gradings.map((g) => (
                <div key={g.id} className="certificate mb-4 bg-[var(--paper)] p-3 last:mb-0">
                  <div className="flex flex-wrap items-center gap-4">
                    <span className="seal-land inline-flex scale-[1.9] px-3 py-3">
                      <GradeBadge grade={g.gradeBand ?? '…'} />
                    </span>
                    <div className="min-w-44 flex-1">
                      {g.confidence !== null && (
                        <>
                          <div className="mb-1 flex items-baseline justify-between text-xs">
                            <span className="smallcaps text-[var(--ink-6)]">Confidence</span>
                            <span className="serial text-sm font-bold text-[var(--ink)]">
                              {(g.confidence * 100).toFixed(0)}%
                            </span>
                          </div>
                          <div className="h-[7px] border border-[var(--ink-3)] bg-[var(--paper-lift)] p-[1.5px]">
                            <div className="h-full bg-[var(--ink)]" style={{ width: `${Math.round(g.confidence * 100)}%` }} />
                          </div>
                        </>
                      )}
                      <p className="serial mt-1.5 text-[11px] text-[var(--ink-6)]">
                        attempt {g.attempt} · {g.provider}
                        {g.model ? ` · ${g.model}` : ''} · {dateTime(g.createdAt)}
                      </p>
                    </div>
                    <StateBadge state={g.status} />
                  </div>
                  <TableScroll minWidth={420}>
                  <table className="mt-3 w-full text-left text-sm">
                    <thead>
                      <tr>
                        <th className={thCls}>Criterion</th>
                        <th className={thCls}>Observation</th>
                        <th className={`${thCls} text-right`}>Band</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.reasons.map((r, i) => (
                        <tr key={i}>
                          <td className="border-b border-[var(--ink-2)] px-3 py-2 font-semibold text-[var(--ink-7)]">
                            {r.criterion}
                          </td>
                          <td className="border-b border-[var(--ink-2)] px-3 py-2 text-[var(--ink-6)]">{r.observation}</td>
                          <td className="border-b border-[var(--ink-2)] px-3 py-2 text-right">
                            <GradeBadge grade={r.bandForCriterion} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </TableScroll>
                  {contract.disputeNote && g.status === 'resolved' && (
                    <p className="stamp mt-3 px-3 py-2 text-[11px] normal-case tracking-normal text-[var(--stamp)]">
                      Farmer dispute: “{contract.disputeNote}”
                    </p>
                  )}
                </div>
              ))}
              <p className="text-[11px] text-[var(--ink-6)]">
                The farmer sees this grade, its payout, and the top reason on her phone — and can dispute it within the window.
              </p>
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
                    {uploadPhoto.isPending ? 'Uploading…' : 'Upload photo'}
                  </button>
                  {contract.state === 'FUNDS_HELD' && (
                    <button className={btnCls} onClick={() => confirmPickup.mutate()} disabled={confirmPickup.isPending}>
                      Confirm pickup
                    </button>
                  )}
                  {canGrade && (
                    <button className={btnCls} onClick={() => runGrading.mutate()} disabled={runGrading.isPending}>
                      {runGrading.isPending ? 'Grading…' : contract.state === 'DISPUTED' ? 'Run re-grade' : 'Run AI grading'}
                    </button>
                  )}
                </div>
              ) : undefined
            }
          >
            {photos.length === 0 ? (
              <p className="text-sm text-[var(--ink-6)]">
                No photos yet. {canPhoto ? 'Upload pickup photos — grading needs at least one.' : ''}
              </p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {photos.map((p) => (
                  <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="border border-[var(--ink-3)] p-1">
                    <img src={p.url} alt="pickup" className="h-24 w-24 object-cover" />
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
                    <p className="text-sm font-bold text-[var(--ink)]">{farmer?.name}</p>
                    <p className="serial text-[11px] text-[var(--ink-6)]">
                      {farmer?.phone} · {farmer?.regionCode}
                    </p>
                  </div>
                  <button
                    className="flex flex-shrink-0 items-center gap-1.5 rounded-[2px] border border-[var(--ink-4)] px-2 py-1 text-[11px] font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--paper-deep)]"
                    onClick={() => callFarmer.mutate()}
                    disabled={callFarmer.isPending}
                  >
                    <Glyph name="phone" className="h-3 w-3" />
                    {callFarmer.isSuccess ? 'Queued' : 'Call'}
                  </button>
                </div>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="serial text-xs text-[var(--ink-6)]">{lot.lotCode}</span>
                  <span className="text-[11px] text-[var(--ink-6)]">
                    declared {lot.declaredBand} · score{' '}
                    <span className="serial font-bold text-[var(--gold-deep)]">{match.score.toFixed(2)}</span>
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="border border-[var(--ink-2)] bg-[var(--paper)] p-2 text-center">
                    <div className="serial text-sm font-bold text-[var(--ink)]">{ghs(contract.holdAmount)}</div>
                    <div className="smallcaps text-[11px] text-[var(--ink-6)]">escrow hold</div>
                  </div>
                  <div className="border border-[var(--ink-2)] bg-[var(--paper)] p-2 text-center">
                    <div className="serial text-sm font-bold text-[var(--gold-deep)]">
                      {contract.finalAmount !== null ? ghs(contract.finalAmount) : '—'}
                    </div>
                    <div className="smallcaps text-[11px] text-[var(--ink-6)]">
                      {contract.finalGrade ? `final · grade ${contract.finalGrade}` : 'awaiting grade'}
                    </div>
                  </div>
                </div>
                <div>
                  <p className="rule-double smallcaps mb-2 pb-1.5 text-[var(--ink-6)]">Price per grade (frozen at offer)</p>
                  <div className="flex gap-1.5">
                    {(['A', 'B', 'C', 'REJECT'] as const).map((band) => (
                      <div
                        key={band}
                        className={`flex flex-1 flex-col items-center gap-1 border py-1.5 ${
                          contract.finalGrade === band ? 'border-[var(--gold)] bg-[var(--gold-wash)]' : 'border-[var(--ink-2)]'
                        }`}
                      >
                        <GradeBadge grade={band} />
                        <span className="serial text-[11px] font-semibold text-[var(--ink-7)]">
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
                <div className="h-24 w-24 flex-shrink-0 border-2 border-[var(--ink)] p-1.5">
                  <QrImage url={publicUrl} />
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="text-[11px] leading-snug text-[var(--ink-6)]">
                    Scans to the public, append-only chain of custody — no login, no money details.
                  </p>
                  <div className="flex flex-col gap-1">
                    <button
                      className="rounded-[2px] border border-[var(--ink-4)] px-2 py-1 text-[11px] font-semibold text-[var(--ink)] hover:bg-[var(--paper-deep)]"
                      onClick={() => {
                        navigator.clipboard.writeText(publicUrl).then(() => {
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        });
                      }}
                    >
                      {copied ? 'Copied' : 'Copy link'}
                    </button>
                    <div className="flex gap-1">
                      <Link
                        to={`/t/${lot.id}`}
                        target="_blank"
                        className="flex-1 rounded-[2px] bg-[var(--ink)] px-2 py-1 text-center text-[11px] font-semibold text-[var(--paper)] hover:bg-[var(--ink-8)]"
                      >
                        Public page
                      </Link>
                      <Link
                        to={`/lots/${lot.id}/trace`}
                        className="flex-1 rounded-[2px] border border-[var(--ink-4)] px-2 py-1 text-center text-[11px] font-semibold text-[var(--ink)] hover:bg-[var(--paper-deep)]"
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
                <p className="text-sm text-[var(--ink-6)]">The hold fires when the farmer accepts.</p>
              ) : (
                <div>
                  {payments.map((p) => (
                    <div key={p.id} className="border-b border-[var(--ink-2)] py-2 text-sm last:border-b-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="font-semibold text-[var(--ink)]">
                          {p.direction === 'collection' ? 'Hold (buyer)' : p.jobId ? 'Driver payout' : 'Farmer payout'}
                        </p>
                        <span className={`${numCls} flex-shrink-0 font-bold text-[var(--gold-deep)]`}>{ghs(p.amount)}</span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2">
                        <p className="serial text-[11px] text-[var(--ink-6)]">{dateTime(p.createdAt)}</p>
                        <StateBadge state={p.status} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {ledger.length > 0 && (
                <details className="mt-3 border-t border-[var(--ink-2)] pt-2">
                  <summary className="smallcaps cursor-pointer text-[var(--ink-6)] hover:text-[var(--ink)]">
                    Ledger — every journal sums to zero
                  </summary>
                  <div className="mt-2 border border-[var(--ink-2)]">
                    <TableScroll minWidth={430}>
                    <table className="w-full text-left text-[11px]">
                      <tbody>
                        {ledger.map((l) => (
                          <tr key={l.id} className="border-b border-[var(--ink-2)] last:border-b-0">
                            <td className="serial max-w-32 truncate px-2 py-1 text-[var(--ink-7)]">{l.account}</td>
                            <td className="serial px-2 py-1 text-right text-[var(--stamp)]">{l.debit ? `DR ${ghs(l.debit)}` : ''}</td>
                            <td className="serial px-2 py-1 text-right text-[var(--ink)]">{l.credit ? `CR ${ghs(l.credit)}` : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </TableScroll>
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
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border border-[var(--ink-2)] bg-[var(--paper)] p-3">
          <span className="serial text-sm font-bold text-[var(--ink)]">{job.jobCode}</span>
          <StateBadge state={job.state} />
          <span className="flex items-center gap-2 text-sm text-[var(--ink-7)]">
            <VehicleMark code={job.vehicleClassCode} className="h-6 w-6" />
            {job.vehicleClassName}
          </span>
          <span className="serial text-sm text-[var(--ink-7)]">{job.distanceKm} km</span>
          <span className="serial text-sm font-bold text-[var(--gold-deep)]">{ghs(job.quoteAmount)}</span>
          {job.driver && (
            <span className="text-sm">
              <span className="font-bold text-[var(--ink)]">{job.driver.name}</span>{' '}
              <span className="serial text-[11px] text-[var(--ink-6)]">{job.driver.phone}</span>
            </span>
          )}
          <div className="ml-auto">
            {job.state === 'NO_DRIVER' && (
              <button className={btnGhostCls} onClick={() => retry.mutate(job.id)} disabled={retry.isPending}>
                Retry dispatch
              </button>
            )}
            {job.state === 'PICKED_UP' && (
              <button className={btnCls} onClick={() => deliver.mutate(job.id)} disabled={deliver.isPending}>
                Confirm delivery received
              </button>
            )}
            {job.state === 'DELIVERED' && (
              <span className="text-sm font-semibold text-[var(--ink-6)]">Driver payout on the way…</span>
            )}
            {job.state === 'PAID' && <span className="text-sm font-bold text-[var(--ink)]">Driver paid</span>}
          </div>
        </div>
      ) : canRequest && quoteData ? (
        <div>
          {farmerSuggested && (
            <div className="mb-3 flex flex-wrap items-center gap-2 border border-[var(--gold)] bg-[var(--gold-wash)] px-3 py-2.5">
              <span className="ember inline-block h-2 w-2 rounded-full bg-[var(--gold-deep)]" />
              <p className="text-sm font-semibold text-[var(--ink)]">
                {farmerName} has asked for a driver — approve by requesting one below; the fee escrows from your account.
              </p>
            </div>
          )}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-[var(--ink-6)]">
              Instant quotes for every vehicle that fits the load. The fee is held in escrow when a driver accepts and
              released on your delivery confirmation.
            </p>
            <button
              className="rounded-[2px] border border-[var(--ink-4)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--paper-deep)]"
              onClick={() => setShowDrivers((v) => !v)}
            >
              {showDrivers ? 'Hide drivers' : 'Choose a driver'}
            </button>
          </div>
          {showDrivers && (
            <div className="mb-3 space-y-2 border border-[var(--ink-2)] bg-[var(--paper)] p-3">
              {!driverData ? (
                <p className="text-sm text-[var(--ink-6)]">Loading drivers…</p>
              ) : driverData.drivers.length === 0 ? (
                <p className="text-sm text-[var(--ink-6)]">No drivers are online right now — auto-dispatch below still works.</p>
              ) : (
                driverData.drivers.map((d) => (
                  <div key={d.id} className="flex flex-wrap items-center gap-3 border-b border-[var(--ink-2)] pb-2 last:border-b-0 last:pb-0">
                    <VehicleMark code={d.vehicleClassCode} className="h-7 w-7 text-[var(--ink)]" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-[var(--ink)]">
                        {d.name}
                        {d.busy && <span className="stamp ml-2 px-1.5 py-0.5 text-[11px] text-[var(--ink-6)]">on a job</span>}
                      </p>
                      <p className="text-[11px] text-[var(--ink-6)]">
                        {d.vehicleClassName} · ≤{d.capacityKg}kg ·{' '}
                        {d.routeRegions.length
                          ? `${d.routeRegions.length} route region${d.routeRegions.length > 1 ? 's' : ''}`
                          : 'serves anywhere'}
                      </p>
                    </div>
                    <a
                      href={`tel:${d.phone}`}
                      className="flex items-center gap-1 rounded-[2px] border border-[var(--ink-4)] px-2.5 py-1 text-xs font-semibold text-[var(--ink)] hover:bg-[var(--paper-deep)]"
                    >
                      <Glyph name="phone" className="h-3 w-3" /> Call
                    </a>
                    <button
                      className="rounded-[2px] bg-[var(--ink)] px-3 py-1 text-xs font-semibold text-[var(--paper)] transition-colors hover:bg-[var(--ink-8)] disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={d.busy || request.isPending}
                      onClick={() => request.mutate({ preferredDriverId: d.id })}
                    >
                      Hire
                    </button>
                  </div>
                ))
              )}
              <p className="text-[11px] text-[var(--ink-6)]">
                Hiring offers the job to your chosen driver first at their vehicle's rate — if they decline, dispatch
                falls back to nearest-first.
              </p>
            </div>
          )}
          <TableScroll minWidth={520}>
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
            <tbody>
              {quoteData.quotes.map((q, i) => (
                <tr key={q.vehicleClassCode} className="hover:bg-[var(--paper)]">
                  <td className={`${tdCls} font-bold`}>
                    <span className="flex items-center gap-2">
                      <VehicleMark code={q.vehicleClassCode} className="h-6 w-6 flex-shrink-0 text-[var(--ink-7)]" />
                      {q.vehicleClassName}
                      {i === 0 && <span className="stamp px-1.5 py-0.5 text-[11px] text-[var(--ink)]">cheapest</span>}
                    </span>
                  </td>
                  <td className={`${tdCls} ${numCls} text-xs`}>{q.capacityKg} kg</td>
                  <td className={`${tdCls} ${numCls} text-xs`}>{q.distanceKm} km</td>
                  <td className={`${tdCls} serial text-[11px] text-[var(--ink-6)]`}>
                    {ghs(q.baseFee)} + {ghs(q.perKmRate)}/km
                  </td>
                  <td className={`${tdCls} serial font-bold text-[var(--gold-deep)]`}>{ghs(q.quoteAmount)}</td>
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
          </TableScroll>
        </div>
      ) : (
        <p className="text-sm text-[var(--ink-6)]">
          {job ? 'Previous transport was cancelled.' : 'No transport requested for this contract.'}
        </p>
      )}
    </Card>
  );
}
