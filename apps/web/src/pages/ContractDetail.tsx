import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, dateTime, ghs, type ContractDetail } from '../api';
import { btnCls, btnGhostCls, Card, StateBadge } from '../components/ui';

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

  if (!data) return <p className="text-sm text-stone-500">Loading…</p>;
  const { contract, lot, farmer, commodity, payments, ledger, photos, gradings, match } = data;
  const canPhoto = ['FUNDS_HELD', 'PICKUP_CONFIRMED', 'DISPUTED'].includes(contract.state);
  const canGrade = ['PICKUP_CONFIRMED', 'DISPUTED'].includes(contract.state) && photos.length > 0;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">
          {contract.quantityKg}kg {commodity.name}
        </h1>
        <StateBadge state={contract.state} />
        <Link to={`/lots/${lot.id}/trace`} className="ml-auto text-sm text-green-700 hover:underline">
          Full trace timeline →
        </Link>
      </div>
      {error && (
        <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-800" onClick={() => setError(null)}>
          {error}
        </p>
      )}

      <Card title="Parties & terms">
        <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
          <div>
            <p className="text-xs uppercase text-stone-400">Farmer</p>
            <p className="font-medium">{farmer?.name}</p>
            <p className="text-xs text-stone-500">
              {farmer?.phone} · {farmer?.regionCode}
              {farmer?.district ? ` · ${farmer.district}` : ''}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase text-stone-400">Lot</p>
            <p className="font-medium">{lot.lotCode}</p>
            <p className="text-xs text-stone-500">declared {lot.declaredBand} · match score {match.score.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-stone-400">Hold</p>
            <p className="font-medium">{ghs(contract.holdAmount)}</p>
            <p className="text-xs text-stone-500">held at acceptance</p>
          </div>
          <div>
            <p className="text-xs uppercase text-stone-400">Final</p>
            <p className="font-medium">{contract.finalAmount !== null ? ghs(contract.finalAmount) : '—'}</p>
            <p className="text-xs text-stone-500">{contract.finalGrade ? `graded ${contract.finalGrade}` : 'awaiting grade'}</p>
          </div>
        </div>

        <div className="mt-4">
          <p className="mb-1 text-xs font-semibold uppercase text-stone-400">Price per grade (frozen at offer)</p>
          <div className="flex gap-2">
            {(['A', 'B', 'C', 'REJECT'] as const).map((band) => (
              <div
                key={band}
                className={`rounded border px-3 py-1.5 text-sm ${
                  contract.finalGrade === band ? 'border-green-600 bg-green-50 font-semibold' : 'border-stone-200'
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
            <div className="flex gap-2">
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
          <p className="text-sm text-stone-500">
            No photos yet. {canPhoto ? 'Upload pickup photos — grading needs at least one.' : ''}
          </p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {photos.map((p) => (
              <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                <img src={p.url} alt="pickup" className="h-28 w-28 rounded object-cover shadow-sm" />
              </a>
            ))}
          </div>
        )}
      </Card>

      {gradings.length > 0 && (
        <Card title="Grading">
          {gradings.map((g) => (
            <div key={g.id} className="mb-3 rounded border border-stone-200 p-3 last:mb-0">
              <div className="mb-2 flex flex-wrap items-center gap-3">
                <span className="text-lg font-bold">{g.gradeBand ?? '…'}</span>
                {g.confidence !== null && (
                  <div className="flex items-center gap-2 text-xs text-stone-500">
                    confidence
                    <div className="h-1.5 w-28 overflow-hidden rounded bg-stone-200">
                      <div className="h-full bg-teal-600" style={{ width: `${Math.round(g.confidence * 100)}%` }} />
                    </div>
                    {(g.confidence * 100).toFixed(0)}%
                  </div>
                )}
                <span className="text-xs text-stone-400">
                  attempt {g.attempt} · {g.provider}
                  {g.model ? ` · ${g.model}` : ''} · {dateTime(g.createdAt)}
                </span>
                <StateBadge state={g.status} />
              </div>
              <ul className="space-y-1 text-sm">
                {g.reasons.map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="w-32 shrink-0 font-medium text-stone-600">{r.criterion}</span>
                    <span className="text-stone-700">{r.observation}</span>
                    <span className="ml-auto shrink-0 text-xs font-semibold text-stone-400">{r.bandForCriterion}</span>
                  </li>
                ))}
              </ul>
              {contract.disputeNote && g.status === 'resolved' && (
                <p className="mt-2 text-xs text-orange-700">Farmer dispute: “{contract.disputeNote}”</p>
              )}
            </div>
          ))}
          <p className="text-xs text-stone-400">
            The farmer sees this grade, its payout, and the top reason on her phone — and can dispute it within the window.
          </p>
        </Card>
      )}

      <Card title="Payments & ledger">
        {payments.length === 0 ? (
          <p className="text-sm text-stone-500">No payments yet — the hold fires when the farmer accepts.</p>
        ) : (
          <table className="mb-3 w-full text-left text-sm">
            <thead className="text-xs uppercase text-stone-400">
              <tr>
                <th className="py-1">Direction</th>
                <th>Amount</th>
                <th>Counterparty</th>
                <th>Provider</th>
                <th>Status</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="py-1.5 font-medium">{p.direction === 'collection' ? 'Hold (buyer)' : 'Payout (farmer)'}</td>
                  <td>{ghs(p.amount)}</td>
                  <td className="text-xs">{p.counterpartyMsisdn}</td>
                  <td className="text-xs">{p.provider}</td>
                  <td>
                    <StateBadge state={p.status === 'successful' ? 'SETTLED' : p.status === 'failed' ? 'CANCELLED' : 'OFFERED'} />
                    <span className="ml-1 text-xs text-stone-400">{p.status}</span>
                  </td>
                  <td className="text-xs">{dateTime(p.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {ledger.length > 0 && (
          <>
            <p className="mb-1 text-xs font-semibold uppercase text-stone-400">Ledger (every journal sums to zero)</p>
            <table className="w-full text-left text-xs">
              <tbody className="divide-y divide-stone-100">
                {ledger.map((l) => (
                  <tr key={l.id}>
                    <td className="py-1 font-mono">{l.account}</td>
                    <td className="text-right tabular-nums">{l.debit ? `DR ${ghs(l.debit)}` : ''}</td>
                    <td className="text-right tabular-nums">{l.credit ? `CR ${ghs(l.credit)}` : ''}</td>
                    <td className="pl-3 text-stone-400">{l.memoKey?.replace('ledger.', '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Card>
    </div>
  );
}
