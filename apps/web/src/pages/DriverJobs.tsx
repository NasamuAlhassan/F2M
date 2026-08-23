import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, dateTime, ghs, type JobView, type Registries } from '../api';
import { btnCls, btnGhostCls, Card, Field, inputCls, StateBadge } from '../components/ui';

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

/** Driver dashboard: vehicle type, ONLINE/OFFLINE toggle, regional routes. */
function ProfileCard() {
  const queryClient = useQueryClient();
  const { data: registries } = useQuery({ queryKey: ['registries'], queryFn: () => api<Registries>('/api/registries') });
  const { data } = useQuery({
    queryKey: ['driver-profile'],
    queryFn: () => api<{ profile: DriverProfile }>('/api/driver/profile'),
  });
  const [vehicle, setVehicle] = useState<string>('');
  const [routes, setRoutes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data && routes === null) {
      setVehicle(data.profile.vehicleClassCode);
      setRoutes(data.profile.routeRegions);
    }
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
    <Card
      title="My vehicle & routes"
      actions={
        <button
          className={`rounded px-3 py-1.5 text-sm font-semibold text-white ${
            profile.active ? 'bg-green-600 hover:bg-green-700' : 'bg-stone-400 hover:bg-stone-500'
          }`}
          onClick={() => save.mutate({ active: !profile.active })}
        >
          {profile.active ? '● ONLINE — taking jobs' : '○ OFFLINE — tap to go online'}
        </button>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Vehicle type">
          <select
            className={inputCls}
            value={vehicle}
            onChange={(e) => {
              setVehicle(e.target.value);
              save.mutate({ vehicleClassCode: e.target.value });
            }}
          >
            {vehicleClasses.map((v) => (
              <option key={v.code} value={v.code}>
                {v.name} — up to {v.capacityKg}kg · {ghs(v.baseFee)} + {ghs(v.perKmRate)}/km
              </option>
            ))}
          </select>
        </Field>
        <div>
          <p className="mb-1 block text-sm font-medium text-stone-600">
            Regional routes <span className="font-normal text-stone-400">(none selected = serve anywhere)</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {(registries?.regions ?? []).map((r) => {
              const on = routes.includes(r.code);
              return (
                <button
                  key={r.code}
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                    on ? 'border-green-600 bg-green-50 text-green-800' : 'border-stone-300 text-stone-500 hover:bg-stone-100'
                  }`}
                  onClick={() => {
                    const next = on ? routes.filter((c) => c !== r.code) : [...routes, r.code];
                    setRoutes(next);
                    save.mutate({ routeRegions: next });
                  }}
                >
                  {r.name}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {saved && <p className="mt-2 text-xs text-green-700">Saved ✓</p>}
    </Card>
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

  if (!data) return <p className="text-sm text-stone-500">Loading…</p>;
  const active = data.jobs.filter((j) => ['ASSIGNED', 'FUNDING_FAILED', 'FUNDS_HELD', 'PICKED_UP', 'DELIVERED'].includes(j.state));
  const history = data.jobs.filter((j) => !active.some((a) => a.id === j.id));

  return (
    <div>
      <h1 className="mb-4 text-xl font-bold">Driver dashboard</h1>
      {error && (
        <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-800" onClick={() => setError(null)}>
          {error}
        </p>
      )}

      <ProfileCard />

      <Card title={`Logistics dispatch board — offers for you (${data.offers.length})`}>
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

      <Card title="Dispatch queue — open requests on your routes">
        {data.openRequests.length === 0 ? (
          <p className="text-sm text-stone-500">No other open pickup requests match your vehicle and routes.</p>
        ) : (
          <>
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-stone-400">
                <tr>
                  <th className="py-2">Job</th>
                  <th>Cargo</th>
                  <th>Distance</th>
                  <th>Escrow payout</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {data.openRequests.map((j) => (
                  <tr key={j.id} className="text-stone-500">
                    <td className="py-2">{j.jobCode}</td>
                    <td>
                      {j.quantityKg}kg {j.commodityCode}
                    </td>
                    <td>{j.distanceKm}km</td>
                    <td>{ghs(j.quoteAmount)}</td>
                    <td className="text-xs italic">queued for dispatch</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-stone-400">
              Dispatch is sequential nearest-first — these reach you automatically if drivers ahead of you decline or time
              out.
            </p>
          </>
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
