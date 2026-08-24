import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate, useSearchParams } from 'react-router-dom';
import { api, dateTime, getRole, setToken, type MarketLot, type Me } from '../api';

interface NotificationRow {
  id: string;
  message: string;
  contractId: string | null;
  readAt: number | null;
  createdAt: number;
}

// The prototype's language switcher. Only English is farmer/buyer-ready today:
// tw/ee/dag are machine-drafted simulation subsets (D-029) and ha doesn't exist
// yet, so the rest stay visibly present but disabled until native review.
const LANGS: Array<{ code: string; label: string; ready: boolean }> = [
  { code: 'en', label: 'English', ready: true },
  { code: 'tw', label: 'Twi', ready: false },
  { code: 'ee', label: 'Ewe', ready: false },
  { code: 'dag', label: 'Dagbani', ready: false },
  { code: 'ha', label: 'Hausa', ready: false },
];

/** The autonomous engine's voice to the buyer: alerts land here as they happen. */
function NotificationBell() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ unread: number; notifications: NotificationRow[] }>('/api/notifications'),
    refetchInterval: 6000,
  });
  const markRead = useMutation({
    mutationFn: () => api('/api/notifications/read', { method: 'POST', body: JSON.stringify({}) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const unread = data?.unread ?? 0;

  return (
    <div className="relative">
      <button
        className={`flex items-center gap-1.5 font-medium transition-colors ${open ? 'text-white' : 'text-green-400 hover:text-white'}`}
        onClick={() => setOpen((v) => !v)}
      >
        Alerts
        {unread > 0 && (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[#D97706] px-1 text-[9px] font-bold text-white">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-96 overflow-hidden rounded-2xl border border-gray-100 bg-white text-gray-900 shadow-2xl">
          <div className="flex items-center justify-between bg-[#1B4332] px-5 py-3">
            <div>
              <div className="text-sm font-bold text-white">Notifications</div>
              <div className="text-[11px] text-green-300">The engine, reporting in</div>
            </div>
            {unread > 0 && (
              <button
                className="rounded-full bg-white/10 px-3 py-1 text-[10px] font-bold text-white hover:bg-white/20"
                onClick={() => markRead.mutate()}
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {!data?.notifications.length ? (
              <p className="px-5 py-4 text-sm text-gray-400">Nothing yet — alerts appear as the engine works.</p>
            ) : (
              data.notifications.map((n) => (
                <div
                  key={n.id}
                  className={`border-b border-gray-50 px-5 py-3 text-sm last:border-b-0 ${n.readAt ? 'text-gray-400' : 'text-gray-700'}`}
                >
                  <p className="leading-snug">{n.message}</p>
                  <p className="mono mt-1 flex items-baseline justify-between text-[10px] text-gray-400">
                    <span>{dateTime(n.createdAt)}</span>
                    {n.contractId && (
                      <Link
                        to={`/contracts/${n.contractId}`}
                        className="font-semibold text-[#1B4332] hover:underline"
                        onClick={() => setOpen(false)}
                      >
                        View contract →
                      </Link>
                    )}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function subNavCls({ isActive }: { isActive: boolean }): string {
  return `font-medium transition-colors ${isActive ? 'border-b-2 border-[#D97706] pb-0.5 text-[#D97706]' : 'text-green-400 hover:text-white'}`;
}

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

const prettyRegion = (code: string | null): string =>
  code ? code.toLowerCase().split('_').map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ') : '';

export function Layout() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const role = getRole() ?? 'buyer';

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => api<Me>('/api/auth/me'),
    enabled: role === 'buyer',
    staleTime: 5 * 60 * 1000,
  });
  const { data: driverProfile } = useQuery({
    queryKey: ['driver-profile'],
    queryFn: () => api<{ profile: { name: string; phone: string } }>('/api/driver/profile'),
    enabled: role === 'driver',
    staleTime: 5 * 60 * 1000,
  });
  const { data: market } = useQuery({
    queryKey: ['market-lots'],
    queryFn: () => api<{ lots: MarketLot[] }>('/api/market/lots'),
    enabled: role === 'buyer',
    refetchInterval: 15000,
  });

  const displayName = role === 'driver' ? (driverProfile?.profile.name ?? 'Driver') : (me?.name ?? 'Buyer');
  const lotCount = market?.lots.length ?? null;

  return (
    <div className="min-h-screen bg-[#F3F4F6]">
      <header className="flex-shrink-0 bg-[#1B4332] text-white shadow-lg">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-5 px-6">
          <Link to={role === 'driver' ? '/driver/jobs' : '/market'} className="flex flex-shrink-0 items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#D97706] text-sm font-extrabold text-white">
              F2M
            </div>
            <div>
              <div className="text-base font-extrabold leading-tight">Farm to Market</div>
              <div className="text-[10px] leading-tight text-green-300">Agritech Marketplace · Ghana</div>
            </div>
          </Link>

          {role === 'buyer' && (
            <div className="relative hidden max-w-xl flex-1 md:block">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-green-300">🔍</span>
              <input
                className="w-full rounded-full bg-white/10 py-2 pl-10 pr-4 text-sm text-white placeholder-green-300/80 outline-none transition-colors focus:bg-white/15 focus:ring-2 focus:ring-[#D97706]"
                placeholder="Search crops, regions…"
                value={searchParams.get('q') ?? ''}
                onChange={(e) => {
                  const q = e.target.value;
                  navigate(q ? `/market?q=${encodeURIComponent(q)}` : '/market', { replace: true });
                }}
              />
            </div>
          )}

          <div className="ml-auto flex flex-shrink-0 items-center gap-4">
            {role === 'buyer' && (
              <div className="hidden items-center gap-1 lg:flex">
                {LANGS.map((l) =>
                  l.ready ? (
                    <span key={l.code} className="rounded-md bg-[#D97706] px-2.5 py-1 text-xs font-bold text-white">
                      {l.label}
                    </span>
                  ) : (
                    <span
                      key={l.code}
                      className="cursor-not-allowed px-2 py-1 text-xs font-medium text-green-400/70"
                      title="Machine-drafted only — awaiting native-speaker review (Khaya AI integration)"
                    >
                      {l.label}
                    </span>
                  ),
                )}
              </div>
            )}
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-xs font-semibold">{displayName}</div>
                <div className="text-[10px] text-green-400">
                  {role === 'driver'
                    ? 'Verified Driver'
                    : `Verified Buyer${me?.regionCode ? ` · ${prettyRegion(me.regionCode)}` : ''}`}
                </div>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#D97706] text-sm font-bold">
                {initials(displayName)}
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-green-900 bg-[#14532d]">
          <div className="mx-auto flex h-10 max-w-[1440px] items-center gap-6 px-6 text-sm">
            {role === 'driver' ? (
              <NavLink to="/driver/jobs" className={subNavCls}>
                Dispatch Board
              </NavLink>
            ) : (
              <>
                <NavLink to="/market" className={subNavCls}>
                  Active Lots
                </NavLink>
                <NavLink to="/demands" className={subNavCls}>
                  My Demands
                </NavLink>
                <NavLink to="/engine" className={subNavCls}>
                  Intent Engine
                </NavLink>
                <NavLink to="/prices" className={subNavCls}>
                  Price Intelligence
                </NavLink>
                <NotificationBell />
              </>
            )}
            <div className="ml-auto flex items-center gap-5">
              {role === 'buyer' && lotCount !== null && (
                <span className="flex items-center gap-1.5 text-xs text-green-400">
                  <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-green-400" />
                  {lotCount} lot{lotCount === 1 ? '' : 's'}
                </span>
              )}
              <button
                className="font-medium text-green-400 transition-colors hover:text-white"
                onClick={() => {
                  setToken(null);
                  navigate(role === 'driver' ? '/driver/login' : '/login');
                }}
              >
                Log out
              </button>
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1440px] px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}
