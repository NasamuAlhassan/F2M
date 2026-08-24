import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate, useSearchParams } from 'react-router-dom';
import { api, dateTime, getRole, setToken, type LocaleInfo, type MarketLot, type Me } from '../api';
import { F2MSeal, Glyph } from './engrave';

interface NotificationRow {
  id: string;
  message: string;
  contractId: string | null;
  readAt: number | null;
  createdAt: number;
}

// The language legend, driven by the server's locale registry (D-040): a
// language lights up the moment its catalog is reviewed (or the owner's
// draft-live flag is on); the rest stay visibly present but disabled — the
// D-029 convention. The buyer product itself remains English.
function LangLegend() {
  const { data } = useQuery({
    queryKey: ['locales'],
    queryFn: () => api<{ locales: LocaleInfo[] }>('/api/i18n/locales'),
    staleTime: 60_000,
  });
  return (
    <div className="hidden items-center gap-3 lg:flex">
      {(data?.locales ?? [{ code: 'en', label: 'English', endonym: 'English', reviewed: true, live: true }]).map((l) =>
        l.live ? (
          <span key={l.code} className="smallcaps border-b-2 border-[var(--gold)] pb-0.5 text-[var(--paper)]">
            {l.label}
          </span>
        ) : (
          <span
            key={l.code}
            className="smallcaps cursor-not-allowed text-[var(--ink-4)]"
            title="Machine-drafted only — awaiting native-speaker review (Khaya AI)"
          >
            {l.label}
          </span>
        ),
      )}
    </div>
  );
}

/** The engine's alerts, filed like incoming correspondence. */
function NotificationBell() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Escape and outside-click both file the tray away — same manners as a dialog.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);
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
    <div className="relative" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="true"
        className={`smallcaps flex min-h-11 items-center gap-1.5 transition-colors lg:min-h-0 ${
          open ? 'text-[var(--paper)]' : 'text-[var(--ink-3)] hover:text-[var(--paper)]'
        }`}
        onClick={() => setOpen((v) => !v)}
      >
        <Glyph name="bell" className="h-3.5 w-3.5" />
        Alerts
        {unread > 0 && (
          <span className="serial flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--gold)] px-1 text-[11px] font-bold text-[var(--ink)]">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="certificate absolute right-0 z-30 mt-3 w-96 overflow-hidden bg-[var(--paper-lift)] text-[var(--ink)]">
          <div className="plate flex items-center justify-between px-5 py-3">
            <div>
              <div className="display text-sm font-semibold tracking-[0.06em]">NOTICES</div>
              <div className="smallcaps text-[var(--ink-3)]">the engine, reporting in</div>
            </div>
            {unread > 0 && (
              <button
                className="stamp px-2 py-0.5 text-[11px] text-[var(--paper)] hover:bg-[var(--ink-8)]"
                onClick={() => markRead.mutate()}
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {!data?.notifications.length ? (
              <p className="px-5 py-4 text-sm text-[var(--ink-6)]">Nothing filed yet — alerts land as the engine works.</p>
            ) : (
              data.notifications.map((n) => (
                <div
                  key={n.id}
                  className={`border-b border-[var(--ink-2)] px-5 py-3 text-sm last:border-b-0 ${
                    n.readAt ? 'text-[var(--ink-6)]' : 'text-[var(--ink)]'
                  }`}
                >
                  <p className="leading-snug">{n.message}</p>
                  <p className="mt-1 flex items-baseline justify-between">
                    <span className="serial text-[11px] text-[var(--ink-6)]">{dateTime(n.createdAt)}</span>
                    {n.contractId && (
                      <Link
                        to={`/contracts/${n.contractId}`}
                        className="text-xs font-semibold text-[var(--gold-deep)] underline decoration-[var(--gold)] decoration-1 underline-offset-2 hover:text-[var(--gold)]"
                        onClick={() => setOpen(false)}
                      >
                        View contract
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

function navCls({ isActive }: { isActive: boolean }): string {
  // pt-3 below lg grows the tap target toward 44px without moving the gold
  // underline away from the letterforms.
  return `smallcaps pt-3 pb-1 transition-colors border-b-2 lg:pt-0 ${
    isActive
      ? 'border-[var(--gold)] text-[var(--paper)]'
      : 'border-transparent text-[var(--ink-3)] hover:text-[var(--paper)]'
  }`;
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
  const { data: farmerDash } = useQuery({
    queryKey: ['farmer-dashboard'],
    queryFn: () => api<{ profile: { name: string } }>('/api/farmer/dashboard'),
    enabled: role === 'farmer',
    staleTime: 60 * 1000,
  });
  const { data: market } = useQuery({
    queryKey: ['market-lots'],
    queryFn: () => api<{ lots: MarketLot[] }>('/api/market/lots'),
    enabled: role === 'buyer',
    refetchInterval: 15000,
  });

  const displayName =
    role === 'driver'
      ? (driverProfile?.profile.name ?? 'Driver')
      : role === 'farmer'
        ? (farmerDash?.profile.name ?? 'Farmer')
        : (me?.name ?? 'Buyer');
  const lotCount = market?.lots.length ?? null;
  const homePath = role === 'driver' ? '/driver/jobs' : role === 'farmer' ? '/farmer/dashboard' : '/market';

  return (
    <div className="min-h-screen bg-[var(--paper)]">
      <header className="plate">
        <div className="mx-auto flex min-h-[72px] max-w-[1400px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2 sm:px-6">
          <Link to={homePath} className="flex flex-shrink-0 items-center gap-3">
            <F2MSeal className="h-11 w-11" dark />
            <div>
              <div className="display text-lg font-semibold leading-tight tracking-[0.1em]">FARM TO MARKET</div>
              <div className="smallcaps leading-tight text-[var(--ink-3)]">Agritech Marketplace · Ghana</div>
            </div>
          </Link>

          {role === 'buyer' && (
            <div className="relative order-last w-full basis-full md:order-none md:w-auto md:max-w-lg md:flex-1 md:basis-auto">
              <Glyph
                name="search"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-4)]"
              />
              <input
                className="w-full rounded-[2px] border border-[var(--ink-7)] bg-[var(--paper-lift)] py-2 pl-9 pr-4 text-sm text-[var(--ink)] outline-none focus:border-[var(--gold)]"
                placeholder="Search crops, regions…"
                value={searchParams.get('q') ?? ''}
                onChange={(e) => {
                  const q = e.target.value;
                  navigate(q ? `/market?q=${encodeURIComponent(q)}` : '/market', { replace: true });
                }}
              />
            </div>
          )}

          <div className="ml-auto flex flex-shrink-0 items-center gap-5">
            {role === 'buyer' && <LangLegend />}
            <div className="flex items-center gap-3">
              <div className="hidden text-right sm:block">
                <div className="text-sm font-semibold text-[var(--paper)]">{displayName}</div>
                <div className="smallcaps text-[var(--ink-3)]">
                  {role === 'driver'
                    ? 'Verified Driver'
                    : role === 'farmer'
                      ? 'Verified Farmer'
                      : `Verified Buyer${me?.regionCode ? ` · ${prettyRegion(me.regionCode)}` : ''}`}
                </div>
              </div>
              <span className="display flex h-10 w-10 items-center justify-center rounded-full border-[1.5px] border-[var(--gold)] text-sm font-semibold text-[var(--gold)] shadow-[inset_0_0_0_2.5px_var(--ink),inset_0_0_0_3.5px_var(--gold)]">
                {initials(displayName)}
              </span>
            </div>
          </div>
        </div>

        <div className="guilloche h-[10px] w-full opacity-90" />

        <div className="border-t border-[var(--ink-8)]">
          <div className="mx-auto flex min-h-11 max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-1.5 sm:gap-x-6 sm:px-6">
            {role === 'driver' ? (
              <NavLink to="/driver/jobs" className={navCls}>
                Dispatch Board
              </NavLink>
            ) : role === 'farmer' ? (
              <>
                <NavLink to="/farmer/dashboard" className={navCls}>
                  Seller Desk
                </NavLink>
                <NavLink to="/prices" className={navCls}>
                  Prices
                </NavLink>
              </>
            ) : (
              <>
                <NavLink to="/market" className={navCls}>
                  Marketplace
                </NavLink>
                <NavLink to="/orders" className={navCls}>
                  Orders
                </NavLink>
                <NavLink to="/contracts" className={navCls}>
                  Contracts
                </NavLink>
                <NavLink to="/prices" className={navCls}>
                  Prices
                </NavLink>
                <NotificationBell />
              </>
            )}
            <div className="ml-auto flex items-center gap-5">
              {role === 'buyer' && lotCount !== null && (
                <span className="smallcaps flex items-center gap-1.5 text-[var(--ink-3)]">
                  <span className="ember inline-block h-1.5 w-1.5 rounded-full bg-[var(--gold)]" />
                  {lotCount} lot{lotCount === 1 ? '' : 's'} live
                </span>
              )}
              <button
                className="smallcaps text-[var(--ink-3)] transition-colors hover:text-[var(--paper)]"
                onClick={() => {
                  setToken(null);
                  navigate(role === 'driver' ? '/driver/login' : role === 'farmer' ? '/farmer/login' : '/login');
                }}
              >
                Log out
              </button>
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}
