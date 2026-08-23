import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, dateTime, ghs, type JobView } from '../api';
import { btnCls, btnGhostCls, Card, numCls, StateBadge, tableCls, tdCls, thCls } from '../components/ui';

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

  if (!data) return <p className="text-sm text-ink-soft">Loading…</p>;
  const active = data.jobs.filter((j) => ['ASSIGNED', 'FUNDING_FAILED', 'FUNDS_HELD', 'PICKED_UP', 'DELIVERED'].includes(j.state));
  const history = data.jobs.filter((j) => !active.some((a) => a.id === j.id));

  return (
    <div>
      <h1 className="mb-4 text-lg font-bold uppercase tracking-widest">Driver jobs</h1>
      {error && (
        <p className="mb-3 border-2 border-err px-3 py-2 text-sm font-bold text-err" onClick={() => setError(null)}>
          {error}
        </p>
      )}

      <Card title={`Job offers (${data.offers.length})`}>
        {data.offers.length === 0 ? (
          <p className="text-sm text-ink-soft">No offers right now. Offers arrive by SMS and appear here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className={tableCls}>
              <thead>
                <tr>
                  <th className={thCls}>Job</th>
                  <th className={thCls}>Load</th>
                  <th className={thCls}>Distance</th>
                  <th className={thCls}>Fee</th>
                  <th className={thCls}>Expires</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody>
                {data.offers.map((o) => (
                  <tr key={o.jobId}>
                    <td className={`${tdCls} ${numCls} font-bold`}>{o.jobCode}</td>
                    <td className={`${tdCls} ${numCls}`}>
                      {o.quantityKg}kg {o.commodityCode}
                    </td>
                    <td className={`${tdCls} ${numCls}`}>{o.distanceKm}km</td>
                    <td className={`${tdCls} ${numCls} font-bold`}>{ghs(o.quoteAmount)}</td>
                    <td className={`${tdCls} ${numCls} text-xs`}>{dateTime(o.expiresAt)}</td>
                    <td className={`${tdCls}`}>
                      <div className="flex gap-2">
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
          </div>
        )}
      </Card>

      <Card title="Active job">
        {active.length === 0 ? (
          <p className="text-sm text-ink-soft">No active job.</p>
        ) : (
          active.map((j) => (
            <div key={j.id} className="flex flex-wrap items-center gap-4">
              <span className={`${numCls} text-lg font-bold`}>{j.jobCode}</span>
              <StateBadge state={j.state} />
              <span className={numCls}>
                {j.quantityKg}kg {j.commodityCode} · {j.distanceKm}km · {ghs(j.quoteAmount)}
              </span>
              {j.state === 'FUNDS_HELD' && (
                <button className={btnCls} onClick={() => pickup.mutate(j.id)} disabled={pickup.isPending}>
                  Confirm goods loaded
                </button>
              )}
              {j.state === 'PICKED_UP' && (
                <span className="text-sm font-bold uppercase text-warn">Awaiting buyer delivery confirmation</span>
              )}
              {j.state === 'DELIVERED' && <span className="text-sm font-bold uppercase">Payout on the way</span>}
            </div>
          ))
        )}
      </Card>

      <Card title="History">
        {history.length === 0 ? (
          <p className="text-sm text-ink-soft">No completed jobs yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className={tableCls}>
              <thead>
                <tr>
                  <th className={thCls}>Job</th>
                  <th className={thCls}>Load</th>
                  <th className={thCls}>Fee</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Paid</th>
                </tr>
              </thead>
              <tbody>
                {history.map((j, i) => (
                  <tr key={j.id} className={i % 2 ? 'bg-paper-dim' : ''}>
                    <td className={`${tdCls} ${numCls}`}>{j.jobCode}</td>
                    <td className={`${tdCls} ${numCls}`}>
                      {j.quantityKg}kg {j.commodityCode}
                    </td>
                    <td className={`${tdCls} ${numCls}`}>{ghs(j.quoteAmount)}</td>
                    <td className={tdCls}>
                      <StateBadge state={j.state} />
                    </td>
                    <td className={`${tdCls} text-xs`}>{dateTime(j.paidAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
