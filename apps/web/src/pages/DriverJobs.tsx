import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, dateTime, ghs, type JobView, type Registries } from '../api';
import { btnCls, btnGhostCls, Card, CROP_EMOJI, numCls, Stat, StateBadge, tableCls, tdCls, thCls, VEHICLE_EMOJI } from '../components/ui';

interface OfferView extends JobView {
  jobId: string;
  expiresAt: number;
}

interface DriverProfile {
  name: string;
  phone: string;
  regionCode: string;
  vehicleClassCode: string;
  active: boolean;
  routeRegions: string[];
}

/** Frame 05's sidebar: identity, ONLINE toggle switch, vehicle icon buttons, route checklist. */
function ProfileSidebar() {
  const queryClient = useQueryClient();
  const { data: registries } = useQuery({ queryKey: ['registries'], queryFn: () => api<Registries>('/api/registries') });
  const { data } = useQuery({
    queryKey: ['driver-profile'],
    queryFn: () => api<{ profile: DriverProfile }>('/api/driver/profile'),
  });
  const [routes, setRoutes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data && routes === null) setRoutes(data.profile.routeRegions);
  }, [data, routes]);

  const save = useMutation({
    mutationFn: (body: Partial<DriverProfile> & { routeRegions?: string[] }) =>
      api('/api/driver/profile', { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['driver-profile'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  if (!data || routes === null) return null;
  const profile = data.profile;
  const vehicleClasses = registries?.vehicleClasses ?? [];

  return (
    <aside className="w-full flex-shrink-0 lg:w-72">
      <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
        <div className="bg-[#1B4332] px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#D97706] text-lg">
              {VEHICLE_EMOJI[profile.vehicleClassCode] ?? '🚚'}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-white">{profile.name}</p>
              <p className="mono text-[10px] text-green-300">{profile.phone}</p>
            </div>
          </div>
        </div>

        <div className="space-y-5 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400">Availability</p>
              <p className={`text-sm font-extrabold ${profile.active ? 'text-green-700' : 'text-gray-400'}`}>
                {profile.active ? 'ONLINE' : 'OFFLINE'}
              </p>
            </div>
            <button
              aria-label="Toggle availability"
              className={`relative h-7 w-13 rounded-full transition-colors ${profile.active ? 'bg-green-600' : 'bg-gray-300'}`}
              style={{ width: 52 }}
              onClick={() => save.mutate({ active: !profile.active })}
            >
              <span
                className="absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all"
                style={{ left: profile.active ? 26 : 4 }}
              />
            </button>
          </div>

          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-gray-400">Vehicle Type</p>
            <div className="space-y-2">
              {vehicleClasses.map((v) => {
                const on = profile.vehicleClassCode === v.code;
                return (
                  <button
                    key={v.code}
                    className={`flex w-full items-center gap-3 rounded-xl border-2 px-3 py-2 text-left transition-colors ${
                      on ? 'border-[#1B4332] bg-green-50' : 'border-gray-100 hover:border-gray-300'
                    }`}
                    onClick={() => save.mutate({ vehicleClassCode: v.code })}
                  >
                    <span className="text-xl">{VEHICLE_EMOJI[v.code] ?? '🚚'}</span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm font-bold ${on ? 'text-[#1B4332]' : 'text-gray-700'}`}>{v.name}</span>
                      <span className="mono block text-[10px] text-gray-400">
                        ≤{v.capacityKg}kg · {ghs(v.baseFee)} + {ghs(v.perKmRate)}/km
                      </span>
                    </span>
                    {on && <span className="text-sm font-extrabold text-[#1B4332]">✓</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="mb-2 flex items-baseline justify-between text-[11px] font-bold uppercase tracking-widest text-gray-400">
              Regional Routes
              <span className="mono text-[#D97706]">{routes.length || 'all'}</span>
            </p>
            <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
              {(registries?.regions ?? []).map((r) => {
                const on = routes.includes(r.code);
                return (
                  <label
                    key={r.code}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors ${
                      on ? 'bg-green-50 font-semibold text-[#1B4332]' : 'text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[#1B4332]"
                      checked={on}
                      onChange={() => {
                        const next = on ? routes.filter((c) => c !== r.code) : [...routes, r.code];
                        setRoutes(next);
                        save.mutate({ routeRegions: next });
                      }}
                    />
                    {r.name}
                  </label>
                );
              })}
            </div>
            <p className="mt-1.5 text-[10px] text-gray-400">None selected = serve anywhere</p>
          </div>

          {saved && <p className="text-xs font-bold text-green-700">Saved ✓</p>}
        </div>
      </div>
    </aside>
  );
}

/** Dispatch-board row: emoji cargo tile, big stat numbers, from↓to route, action buttons. */
function JobStats({ job }: { job: JobView }) {
  return (
    <>
      <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-green-50 text-xl">
        {CROP_EMOJI[job.commodityCode] ?? '📦'}
      </div>
      <div className="w-24 min-w-0">
        <p className="mono truncate text-xs font-extrabold text-gray-900">{job.jobCode}</p>
        <p className="text-[10px] text-gray-400">{job.commodityCode}</p>
      </div>
      <Stat value={`${job.quantityKg}kg`} caption="cargo" />
      <Stat value={`${job.distanceKm}km`} caption="distance" />
      <Stat value={ghs(job.quoteAmount)} caption="escrow payout" accent />
    </>
  );
}

export function DriverJobsPage() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['driver-jobs'],
    queryFn: () => api<{ offers: OfferView[]; openRequests: JobView[]; jobs: JobView[] }>('/api/driver/jobs'),
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

  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;
  const active = data.jobs.filter((j) => ['ASSIGNED', 'FUNDING_FAILED', 'FUNDS_HELD', 'PICKED_UP', 'DELIVERED'].includes(j.state));
  const history = data.jobs.filter((j) => !active.some((a) => a.id === j.id));

  return (
    <div className="flex flex-col gap-5 lg:flex-row">
      <ProfileSidebar />

      <div className="min-w-0 flex-1">
        <div className="mb-5">
          <h1 className="text-xl font-extrabold text-gray-900">Logistics Dispatch Board</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Escrowed pickups on your routes — the fee is locked before you load and released when the buyer confirms
            delivery
          </p>
        </div>
        {error && (
          <p
            className="mb-4 cursor-pointer rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700"
            onClick={() => setError(null)}
          >
            {error}
          </p>
        )}

        <Card title={`Pickup Offers for You (${data.offers.length})`}>
          {data.offers.length === 0 ? (
            <p className="text-sm text-gray-400">No offers right now. Offers arrive by SMS and appear here.</p>
          ) : (
            <div className="space-y-3">
              {data.offers.map((o) => (
                <div
                  key={o.jobId}
                  className="slide-in flex flex-wrap items-center gap-5 rounded-xl border-2 border-amber-300 bg-amber-50/50 p-4"
                >
                  <JobStats job={o} />
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Expires</p>
                    <p className="mono text-xs font-bold text-red-600">{dateTime(o.expiresAt)}</p>
                  </div>
                  <div className="ml-auto flex gap-2">
                    <button className={btnCls} onClick={() => accept.mutate(o.jobId)} disabled={accept.isPending}>
                      ✓ Accept Pickup
                    </button>
                    <button className={btnGhostCls} onClick={() => decline.mutate(o.jobId)} disabled={decline.isPending}>
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Active Job">
          {active.length === 0 ? (
            <p className="text-sm text-gray-400">No active job.</p>
          ) : (
            active.map((j) => (
              <div key={j.id} className="flex flex-wrap items-center gap-5 rounded-xl border border-gray-100 bg-gray-50 p-4">
                <JobStats job={j} />
                <StateBadge state={j.state} />
                <div className="ml-auto">
                  {j.state === 'FUNDS_HELD' && (
                    <button className={btnCls} onClick={() => pickup.mutate(j.id)} disabled={pickup.isPending}>
                      📦 Confirm goods loaded
                    </button>
                  )}
                  {j.state === 'PICKED_UP' && (
                    <span className="text-sm font-bold text-amber-700">Awaiting buyer delivery confirmation…</span>
                  )}
                  {j.state === 'DELIVERED' && <span className="text-sm font-semibold text-gray-500">Payout on the way…</span>}
                </div>
              </div>
            ))
          )}
        </Card>

        <Card title="Dispatch Queue — open requests on your routes">
          {data.openRequests.length === 0 ? (
            <p className="text-sm text-gray-400">No other open pickup requests match your vehicle and routes.</p>
          ) : (
            <>
              <div className="space-y-2">
                {data.openRequests.map((j) => (
                  <div key={j.id} className="flex flex-wrap items-center gap-5 rounded-xl border border-gray-100 p-3 opacity-70">
                    <JobStats job={j} />
                    <span className="ml-auto text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                      queued for dispatch
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[10px] text-gray-400">
                Dispatch is sequential nearest-first — these reach you automatically if drivers ahead of you decline or
                time out.
              </p>
            </>
          )}
        </Card>

        <Card title="History">
          {history.length === 0 ? (
            <p className="text-sm text-gray-400">No completed jobs yet.</p>
          ) : (
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
              <tbody className="divide-y divide-gray-50">
                {history.map((j) => (
                  <tr key={j.id} className="hover:bg-gray-50">
                    <td className={`${tdCls} mono text-xs font-bold text-gray-900`}>{j.jobCode}</td>
                    <td className={tdCls}>
                      {CROP_EMOJI[j.commodityCode] ?? '📦'} {j.quantityKg}kg {j.commodityCode}
                    </td>
                    <td className={`${tdCls} ${numCls} font-bold text-[#1B4332]`}>{ghs(j.quoteAmount)}</td>
                    <td className={tdCls}>
                      <StateBadge state={j.state} />
                    </td>
                    <td className={`${tdCls} mono text-[11px] text-gray-500`}>{dateTime(j.paidAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
