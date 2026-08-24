import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, dateTime, ghs, type JobView, type Registries } from '../api';
import { CropMark, VehicleMark } from '../components/engrave';
import { LanguageSection } from '../components/LanguageSection';
import { btnCls, btnGhostCls, Card, numCls, rowOffCls, rowOnCls, Stat, StateBadge, tableCls, tdCls, thCls } from '../components/ui';

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
  locale: string;
}

/** The driver's book: identity, availability lever, vehicle, route checklist. */
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
      <div className="certificate overflow-hidden bg-[var(--paper-lift)]">
        <div className="plate flex items-center gap-3 px-5 py-4">
          <VehicleMark code={profile.vehicleClassCode} className="h-9 w-9 flex-shrink-0 text-[var(--paper)]" />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-[var(--paper)]">{profile.name}</p>
            <p className="serial text-[11px] text-[var(--ink-3)]">{profile.phone}</p>
          </div>
        </div>
        <div className="guilloche h-[10px] w-full bg-[var(--ink)] opacity-90" />

        <div className="space-y-5 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="smallcaps text-[var(--ink-6)]">Availability</p>
              <p className={`display text-sm font-semibold tracking-[0.1em] ${profile.active ? 'text-[var(--ink)]' : 'text-[var(--ink-4)]'}`}>
                {profile.active ? 'ON DUTY' : 'OFF DUTY'}
              </p>
            </div>
            <button
              aria-label="Toggle availability"
              className={`relative h-7 rounded-full border transition-colors ${
                profile.active ? 'border-[var(--ink)] bg-[var(--ink)]' : 'border-[var(--ink-4)] bg-[var(--paper)]'
              }`}
              style={{ width: 52 }}
              onClick={() => save.mutate({ active: !profile.active })}
            >
              <span
                className={`absolute top-[3px] h-5 w-5 rounded-full transition-all ${
                  profile.active ? 'bg-[var(--gold)]' : 'bg-[var(--ink-4)]'
                }`}
                style={{ left: profile.active ? 27 : 4 }}
              />
            </button>
          </div>

          <div>
            <p className="rule-double smallcaps mb-2 pb-1.5 text-[var(--ink-6)]">Vehicle Type</p>
            <div className="space-y-2">
              {vehicleClasses.map((v) => {
                const on = profile.vehicleClassCode === v.code;
                return (
                  <button
                    key={v.code}
                    className={`flex w-full items-center gap-3 border px-3 py-2 text-left transition-colors ${
                      on ? 'border-[var(--ink)] bg-[var(--gold-wash)]' : 'border-[var(--ink-2)] hover:border-[var(--ink-5)]'
                    }`}
                    onClick={() => save.mutate({ vehicleClassCode: v.code })}
                  >
                    <VehicleMark code={v.code} className="h-8 w-8 flex-shrink-0 text-[var(--ink)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-[var(--ink)]">{v.name}</span>
                      <span className="serial block text-[11px] text-[var(--ink-6)]">
                        ≤{v.capacityKg}kg · {ghs(v.baseFee)} + {ghs(v.perKmRate)}/km
                      </span>
                    </span>
                    {on && <span className="serial text-sm font-bold text-[var(--ink)]">✓</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="rule-double smallcaps mb-2 flex items-baseline justify-between pb-1.5 text-[var(--ink-6)]">
              Regional Routes
              <span className="serial text-[var(--gold-deep)]">{routes.length || 'all'}</span>
            </p>
            <div className="max-h-52 space-y-0.5 overflow-y-auto pr-1">
              {(registries?.regions ?? []).map((r) => {
                const on = routes.includes(r.code);
                return (
                  <label
                    key={r.code}
                    className={`flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm transition-colors ${
                      on ? rowOnCls : rowOffCls
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-[var(--ink)]"
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
            <p className="mt-1.5 text-[11px] text-[var(--ink-6)]">None selected = serve anywhere</p>
          </div>

          <LanguageSection current={profile.locale} saving={save.isPending} onPick={(locale) => save.mutate({ locale })} />

          {saved && <p className="text-xs font-bold text-[var(--ink)]">Saved ✓</p>}
        </div>
      </div>
    </aside>
  );
}

/** Waybill row: crop vignette, serial, typed figures. */
function JobStats({ job }: { job: JobView }) {
  return (
    <>
      <span className="hatch flex h-11 w-11 flex-shrink-0 items-center justify-center border border-[var(--ink-2)]">
        <CropMark code={job.commodityCode} className="h-7 w-7 text-[var(--ink-7)]" />
      </span>
      <div className="w-24 min-w-0">
        <p className="serial truncate text-xs font-bold text-[var(--ink)]">{job.jobCode}</p>
        <p className="smallcaps text-[var(--ink-6)]">{job.commodityCode}</p>
      </div>
      <Stat value={`${job.quantityKg} kg`} caption="cargo" />
      <Stat value={`${job.distanceKm} km`} caption="distance" />
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

  if (!data) return <p className="text-sm text-[var(--ink-6)]">Loading…</p>;
  const active = data.jobs.filter((j) => ['ASSIGNED', 'FUNDING_FAILED', 'FUNDS_HELD', 'PICKED_UP', 'DELIVERED'].includes(j.state));
  const history = data.jobs.filter((j) => !active.some((a) => a.id === j.id));

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <ProfileSidebar />

      <div className="min-w-0 flex-1">
        <div className="mb-4">
          <h1 className="display text-xl font-semibold tracking-[0.05em] text-[var(--ink)]">Dispatch Board</h1>
          <p className="mt-1 text-sm text-[var(--ink-6)]">
            Escrowed pickups on your routes — the fee is locked before you load and released when the buyer confirms
            delivery
          </p>
        </div>
        {error && (
          <p className="stamp mb-4 cursor-pointer px-3 py-2 text-[11px] text-[var(--stamp)]" onClick={() => setError(null)}>
            {error}
          </p>
        )}

        <Card title={`Pickup Offers for You (${data.offers.length})`}>
          {data.offers.length === 0 ? (
            <p className="text-sm text-[var(--ink-6)]">No offers right now. Offers arrive by SMS and appear here.</p>
          ) : (
            <div className="space-y-3">
              {data.offers.map((o) => (
                <div key={o.jobId} className="certificate seal-land flex flex-wrap items-center gap-5 bg-[var(--gold-wash)] p-4">
                  <JobStats job={o} />
                  <div className="min-w-0">
                    <p className="smallcaps text-[var(--ink-6)]">Expires</p>
                    <p className="serial text-xs font-bold text-[var(--stamp)]">{dateTime(o.expiresAt)}</p>
                  </div>
                  <div className="ml-auto flex gap-2">
                    <button className={btnCls} onClick={() => accept.mutate(o.jobId)} disabled={accept.isPending}>
                      Accept Pickup
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
            <p className="text-sm text-[var(--ink-6)]">No active job.</p>
          ) : (
            active.map((j) => (
              <div key={j.id} className="flex flex-wrap items-center gap-5 border border-[var(--ink-2)] bg-[var(--paper)] p-3.5">
                <JobStats job={j} />
                <StateBadge state={j.state} />
                <div className="ml-auto">
                  {j.state === 'FUNDS_HELD' && (
                    <button className={btnCls} onClick={() => pickup.mutate(j.id)} disabled={pickup.isPending}>
                      Confirm goods loaded
                    </button>
                  )}
                  {j.state === 'PICKED_UP' && (
                    <span className="text-sm font-bold text-[var(--gold-deep)]">Awaiting buyer delivery confirmation…</span>
                  )}
                  {j.state === 'DELIVERED' && (
                    <span className="text-sm font-semibold text-[var(--ink-6)]">Payout on the way…</span>
                  )}
                </div>
              </div>
            ))
          )}
        </Card>

        <Card title="Dispatch Queue — open requests on your routes">
          {data.openRequests.length === 0 ? (
            <p className="text-sm text-[var(--ink-6)]">No other open pickup requests match your vehicle and routes.</p>
          ) : (
            <>
              <div className="space-y-2">
                {data.openRequests.map((j) => (
                  <div key={j.id} className="flex flex-wrap items-center gap-5 border border-[var(--ink-2)] p-3 opacity-60">
                    <JobStats job={j} />
                    <span className="smallcaps ml-auto text-[var(--ink-6)]">queued for dispatch</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-[var(--ink-6)]">
                Dispatch is sequential nearest-first — these reach you automatically if drivers ahead of you decline or
                time out.
              </p>
            </>
          )}
        </Card>

        <Card title="History">
          {history.length === 0 ? (
            <p className="text-sm text-[var(--ink-6)]">No completed jobs yet.</p>
          ) : (
            <table className={tableCls}>
              <thead>
                <tr>
                  <th className={thCls}>Job №</th>
                  <th className={thCls}>Load</th>
                  <th className={thCls}>Fee</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Paid</th>
                </tr>
              </thead>
              <tbody>
                {history.map((j) => (
                  <tr key={j.id} className="hover:bg-[var(--paper)]">
                    <td className={`${tdCls} serial text-xs font-bold`}>{j.jobCode}</td>
                    <td className={tdCls}>
                      <span className="flex items-center gap-2">
                        <CropMark code={j.commodityCode} className="h-5 w-5 flex-shrink-0 text-[var(--ink-7)]" />
                        {j.quantityKg}kg {j.commodityCode}
                      </span>
                    </td>
                    <td className={`${tdCls} ${numCls} font-bold text-[var(--gold-deep)]`}>{ghs(j.quoteAmount)}</td>
                    <td className={tdCls}>
                      <StateBadge state={j.state} />
                    </td>
                    <td className={`${tdCls} serial text-[11px] text-[var(--ink-6)]`}>{dateTime(j.paidAt)}</td>
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
