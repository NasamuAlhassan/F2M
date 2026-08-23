import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, dateTime, ghs, type ContractDetail, type JobView, type TransportQuoteView } from '../api';
import { btnCls, btnGhostCls, Card, numCls, StateBadge, tableCls, tdCls, thCls } from '../components/ui';

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

  if (!data) return <p className="text-sm text-ink-soft">Loading…</p>;
  const { contract, lot, farmer, commodity, payments, ledger, photos, gradings, match } = data;
  const canPhoto = ['FUNDS_HELD', 'PICKUP_CONFIRMED', 'DISPUTED'].includes(contract.state);
  const canGrade = ['PICKUP_CONFIRMED', 'DISPUTED'].includes(contract.state) && photos.length > 0;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-bold uppercase tracking-widest">
          {contract.quantityKg}kg {commodity.name}
        </h1>
        <StateBadge state={contract.state} />
        <Link to={`/lots/${lot.id}/trace`} className="ml-auto text-sm font-bold uppercase text-accent underline">
          Full trace timeline
        </Link>
      </div>
      {error && (
        <p className="mb-3 border-2 border-err px-3 py-2 text-sm font-bold text-err" onClick={() => setError(null)}>
          {error}
        </p>
      )}

      <Card title="Parties & terms">
        <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-ink-soft">Farmer</p>
            <p className="font-bold">{farmer?.name}</p>
            <p className={`text-xs text-ink-soft ${numCls}`}>
              {farmer?.phone} · {farmer?.regionCode}
              {farmer?.district ? ` · ${farmer.district}` : ''}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-ink-soft">Lot</p>
            <p className={`font-bold ${numCls}`}>{lot.lotCode}</p>
            <p className={`text-xs text-ink-soft ${numCls}`}>declared {lot.declaredBand} · match score {match.score.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-ink-soft">Hold</p>
            <p className={`font-bold ${numCls}`}>{ghs(contract.holdAmount)}</p>
            <p className="text-xs text-ink-soft">held at acceptance</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-ink-soft">Final</p>
            <p className={`font-bold ${numCls}`}>{contract.finalAmount !== null ? ghs(contract.finalAmount) : '—'}</p>
            <p className="text-xs text-ink-soft">{contract.finalGrade ? `graded ${contract.finalGrade}` : 'awaiting grade'}</p>
          </div>
        </div>

        <div className="mt-4">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-ink-soft">Price per grade (frozen at offer)</p>
          <div className="flex flex-wrap gap-2">
            {(['A', 'B', 'C', 'REJECT'] as const).map((band) => (
              <div
                key={band}
                className={`border-2 px-3 py-1.5 text-sm ${numCls} ${
                  contract.finalGrade === band ? 'border-ink bg-ink font-bold text-paper' : 'border-ink'
                }`}
              >
                {band}: {ghs(contract.priceTerms[band])}/kg
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Card
        title={`Pickup photos (${photos.length})`}
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
                  {runGrading.isPending ? 'Grading…' : contract.state === 'DISPUTED' ? 'Run re-grade' : 'Run grading'}
                </button>
              )}
            </div>
          ) : undefined
        }
      >
        {photos.length === 0 ? (
          <p className="text-sm text-ink-soft">
            No photos yet. {canPhoto ? 'Upload pickup photos — grading needs at least one.' : ''}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {photos.map((p) => (
              <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="border-2 border-ink">
                <img src={p.url} alt="pickup" className="h-28 w-28 object-cover" />
              </a>
            ))}
          </div>
        )}
      </Card>

      {gradings.length > 0 && (
        <Card title="Grading">
          {gradings.map((g) => (
            <div key={g.id} className="mb-3 border-2 border-ink p-3 last:mb-0">
              <div className="mb-2 flex flex-wrap items-center gap-3">
                <span className={`border-2 border-ink bg-ink px-2 py-0.5 text-lg font-bold text-paper ${numCls}`}>
                  {g.gradeBand ?? '…'}
                </span>
                {g.confidence !== null && (
                  <div className="flex items-center gap-2 text-xs text-ink-soft">
                    <span className="uppercase tracking-wide">confidence</span>
                    <div className="h-3 w-28 border border-ink bg-paper">
                      <div className="h-full bg-ink" style={{ width: `${Math.round(g.confidence * 100)}%` }} />
                    </div>
                    <span className={numCls}>{(g.confidence * 100).toFixed(0)}%</span>
                  </div>
                )}
                <span className={`text-xs text-ink-soft ${numCls}`}>
                  attempt {g.attempt} · {g.provider}
                  {g.model ? ` · ${g.model}` : ''} · {dateTime(g.createdAt)}
                </span>
                <StateBadge state={g.status} />
              </div>
              <ul className="space-y-1 text-sm">
                {g.reasons.map((r, i) => (
                  <li key={i} className="flex gap-2 border-b border-ink-soft/30 pb-1 last:border-0">
                    <span className="w-32 shrink-0 font-bold">{r.criterion}</span>
                    <span>{r.observation}</span>
                    <span className={`ml-auto shrink-0 text-xs font-bold ${numCls}`}>{r.bandForCriterion}</span>
                  </li>
                ))}
              </ul>
              {contract.disputeNote && g.status === 'resolved' && (
                <p className="mt-2 border border-warn px-2 py-1 text-xs font-bold text-warn">
                  Farmer dispute: “{contract.disputeNote}”
                </p>
              )}
            </div>
          ))}
          <p className="text-xs text-ink-soft">
            The farmer sees this grade, its payout, and the top reason on her phone — and can dispute it within the window.
          </p>
        </Card>
      )}

      {['FUNDS_HELD', 'PICKUP_CONFIRMED', 'GRADED', 'DISPUTED', 'SETTLED'].includes(contract.state) && (
        <TransportSection contractId={contract.id} contractState={contract.state} onError={onError} />
      )}

      <Card title="Payments & ledger">
        {payments.length === 0 ? (
          <p className="text-sm text-ink-soft">No payments yet — the hold fires when the farmer accepts.</p>
        ) : (
          <div className="mb-3 overflow-x-auto">
            <table className={tableCls}>
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
              <tbody>
                {payments.map((p, i) => (
                  <tr key={p.id} className={i % 2 ? 'bg-paper-dim' : ''}>
                    <td className={`${tdCls} font-bold`}>{p.direction === 'collection' ? 'Hold (buyer)' : 'Payout (farmer)'}</td>
                    <td className={`${tdCls} ${numCls}`}>{ghs(p.amount)}</td>
                    <td className={`${tdCls} ${numCls} text-xs`}>{p.counterpartyMsisdn}</td>
                    <td className={`${tdCls} text-xs`}>{p.provider}</td>
                    <td className={tdCls}>
                      <StateBadge state={p.status} />
                    </td>
                    <td className={`${tdCls} text-xs`}>{dateTime(p.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {ledger.length > 0 && (
          <>
            <p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-ink-soft">
              Ledger — produce and transport money in one book (every journal sums to zero)
            </p>
            <div className="overflow-x-auto">
              <table className={tableCls}>
                <tbody>
                  {ledger.map((l, i) => (
                    <tr key={l.id} className={i % 2 ? 'bg-paper-dim' : ''}>
                      <td className={`${tdCls} font-mono text-xs`}>{l.account}</td>
                      <td className={`${tdCls} ${numCls} text-right text-xs`}>{l.debit ? `DR ${ghs(l.debit)}` : ''}</td>
                      <td className={`${tdCls} ${numCls} text-right text-xs`}>{l.credit ? `CR ${ghs(l.credit)}` : ''}</td>
                      <td className={`${tdCls} text-xs text-ink-soft`}>{l.memoKey?.replace('ledger.', '')}</td>
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
    queryFn: () => api<{ quote: TransportQuoteView }>(`/api/contracts/${contractId}/transport-quote`),
    enabled: canRequest,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['transport', contractId] });
  const request = useMutation({
    mutationFn: () => api(`/api/contracts/${contractId}/transport`, { method: 'POST' }),
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
    <Card
      title="Transport — the middle-mile bridge"
      actions={
        canRequest ? (
          <button className={btnCls} onClick={() => request.mutate()} disabled={request.isPending || !quoteData}>
            {request.isPending ? 'Requesting…' : 'Request transport'}
          </button>
        ) : undefined
      }
    >
      {job && !['CANCELLED', 'CANCELLED_REFUNDED'].includes(job.state) ? (
        <div className="flex flex-wrap items-center gap-4">
          <span className={`${numCls} text-lg font-bold`}>{job.jobCode}</span>
          <StateBadge state={job.state} />
          <span className={numCls}>
            {job.vehicleClassName} · {job.distanceKm}km · fee {ghs(job.quoteAmount)}
          </span>
          {job.driver && (
            <span>
              Driver: <b>{job.driver.name}</b> <span className={`${numCls} text-xs`}>{job.driver.phone}</span>
            </span>
          )}
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
          {job.state === 'DELIVERED' && <span className="text-sm font-bold uppercase">Driver payout on the way</span>}
          {job.state === 'PAID' && <span className="text-sm font-bold uppercase">Driver paid</span>}
        </div>
      ) : canRequest && quoteData ? (
        <p className={`text-sm ${numCls}`}>
          Quote: <b>{quoteData.quote.vehicleClassName}</b> ({quoteData.quote.capacityKg}kg cap) ·{' '}
          {quoteData.quote.distanceKm}km · base {ghs(quoteData.quote.baseFee)} + {ghs(quoteData.quote.perKmRate)}/km ={' '}
          <b>{ghs(quoteData.quote.quoteAmount)}</b> — held in escrow when a driver accepts, released on your delivery
          confirmation.
        </p>
      ) : (
        <p className="text-sm text-ink-soft">
          {job ? 'Previous transport was cancelled.' : 'No transport requested for this contract.'}
        </p>
      )}
    </Card>
  );
}
