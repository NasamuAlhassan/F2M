import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, dateTime, ghs, type JobView } from '../api';
import { btnCls, btnGhostCls, Card, StateBadge } from '../components/ui';

interface OfferView extends JobView {
  jobId: string;
  expiresAt: number;
}

export function DriverJobsPage() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['driver-jobs'],
    queryFn: () => api<{ offers: OfferView[]; jobs: JobView[] }>('/api/driver/jobs'),
    refetchInterval: 5000,
  });
  const [error, setError] = useState<string | null>(null);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['driver-jobs'] });
  const onError = (err: unknown) => setError(err instanceof Error ? err.message : 'Action failed');

  const accept = useMutation({
    mutationFn: (id: string) => api(`/api/jobs/${id}/accept`, { method: 'POST' }),
    onSuccess: invalidate,
    onError,
  });
  const decline = useMutation({
    mutationFn: (id: string) => api(`/api/jobs/${id}/decline`, { method: 'POST' }),
    onSuccess: invalidate,
    onError,
  });
  const pickup = useMutation({
    mutationFn: (id: string) => api(`/api/jobs/${id}/pickup`, { method: 'POST' }),
    onSuccess: invalidate,
    onError,
  });

  if (!data) return <p className="text-sm text-stone-500">Loading…</p>;
  const active = data.jobs.filter((j) => ['ASSIGNED', 'FUNDING_FAILED', 'FUNDS_HELD', 'PICKED_UP', 'DELIVERED'].includes(j.state));
  const history = data.jobs.filter((j) => !active.some((a) => a.id === j.id));

  return (
    <div>
      <h1 className="mb-4 text-xl font-bold">Driver jobs</h1>
      {error && (
        <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-800" onClick={() => setError(null)}>
          {error}
        </p>
      )}

      <Card title={`Job offers (${data.offers.length})`}>
        {data.offers.length === 0 ? (
          <p className="text-sm text-stone-500">No offers right now. Offers arrive by SMS and appear here.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-stone-400">
              <tr>
                <th className="py-2">Job</th>
                <th>Load</th>
                <th>Distance</th>
                <th>Fee</th>
                <th>Expires</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {data.offers.map((o) => (
                <tr key={o.jobId}>
                  <td className="py-2 font-medium">{o.jobCode}</td>
                  <td>
                    {o.quantityKg}kg {o.commodityCode}
                  </td>
                  <td>{o.distanceKm}km</td>
                  <td className="font-medium">{ghs(o.quoteAmount)}</td>
                  <td className="text-xs">{dateTime(o.expiresAt)}</td>
                  <td className="py-1.5 text-right">
                    <div className="flex justify-end gap-2">
                      <button className={btnCls} onClick={() => accept.mutate(o.jobId)} disabled={accept.isPending}>
                        Accept
                      </button>
                      <button className={btnGhostCls} onClick={() => decline.mutate(o.jobId)} disabled={decline.isPending}>
                        Decline
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Active job">
        {active.length === 0 ? (
          <p className="text-sm text-stone-500">No active job.</p>
        ) : (
          active.map((j) => (
            <div key={j.id} className="flex flex-wrap items-center gap-4 text-sm">
              <span className="text-base font-semibold">{j.jobCode}</span>
              <StateBadge state={j.state} />
              <span className="text-stone-600">
                {j.quantityKg}kg {j.commodityCode} · {j.distanceKm}km · {ghs(j.quoteAmount)}
              </span>
              {j.state === 'FUNDS_HELD' && (
                <button className={btnCls} onClick={() => pickup.mutate(j.id)} disabled={pickup.isPending}>
                  Confirm goods loaded
                </button>
              )}
              {j.state === 'PICKED_UP' && (
                <span className="font-medium text-amber-700">Awaiting buyer delivery confirmation…</span>
              )}
              {j.state === 'DELIVERED' && <span className="font-medium text-stone-500">Payout on the way…</span>}
            </div>
          ))
        )}
      </Card>

      <Card title="History">
        {history.length === 0 ? (
          <p className="text-sm text-stone-500">No completed jobs yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-stone-400">
              <tr>
                <th className="py-2">Job</th>
                <th>Load</th>
                <th>Fee</th>
                <th>Status</th>
                <th>Paid</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {history.map((j) => (
                <tr key={j.id}>
                  <td className="py-2">{j.jobCode}</td>
                  <td>
                    {j.quantityKg}kg {j.commodityCode}
                  </td>
                  <td>{ghs(j.quoteAmount)}</td>
                  <td>
                    <StateBadge state={j.state} />
                  </td>
                  <td className="text-xs">{dateTime(j.paidAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
