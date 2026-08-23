import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api, dateTime, getRole, setToken } from '../api';

function navCls({ isActive }: { isActive: boolean }): string {
  return `border-2 border-ink px-3 py-1.5 text-[12px] font-bold uppercase tracking-wide ${
    isActive ? 'bg-ink text-paper' : 'bg-paper text-ink hover:bg-ink hover:text-paper'
  }`;
}

interface NotificationRow {
  id: string;
  message: string;
  contractId: string | null;
  readAt: number | null;
  createdAt: number;
}

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
        className={`border-2 border-ink px-3 py-1.5 text-[12px] font-bold uppercase tracking-wide ${
          open ? 'bg-ink text-paper' : 'bg-paper hover:bg-ink hover:text-paper'
        }`}
        onClick={() => setOpen((v) => !v)}
      >
        Alerts{unread > 0 ? ` [${unread}]` : ''}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-96 border-2 border-ink bg-paper">
          <div className="flex items-center justify-between border-b-2 border-ink px-3 py-2">
            <span className="text-[11px] font-bold uppercase tracking-widest">Notifications</span>
            {unread > 0 && (
              <button
                className="border border-ink px-2 py-0.5 text-[10px] font-bold uppercase hover:bg-ink hover:text-paper"
                onClick={() => markRead.mutate()}
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {!data?.notifications.length ? (
              <p className="px-3 py-2 text-sm text-ink-soft">Nothing yet — alerts appear as the engine works.</p>
            ) : (
              data.notifications.map((n) => (
                <div key={n.id} className={`border-b border-ink px-3 py-2 text-sm last:border-b-0 ${n.readAt ? 'text-ink-soft' : ''}`}>
                  <p>{n.message}</p>
                  <p className="mt-0.5 flex items-baseline justify-between font-mono text-[10px] uppercase text-ink-soft">
                    <span>{dateTime(n.createdAt)}</span>
                    {n.contractId && (
                      <Link to={`/contracts/${n.contractId}`} className="underline" onClick={() => setOpen(false)}>
                        Contract
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

export function Layout() {
  const navigate = useNavigate();
  const role = getRole() ?? 'buyer';
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b-2 border-ink bg-paper">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <NavLink to={role === 'driver' ? '/driver/jobs' : '/demands'} className="text-base font-bold uppercase tracking-widest">
            Farm to Market <span className="font-normal text-ink-soft">/ {role === 'driver' ? 'Driver' : 'Buyer'}</span>
          </NavLink>
          <nav className="flex items-center gap-2">
            {role === 'driver' ? (
              <NavLink to="/driver/jobs" className={navCls}>
                Jobs
              </NavLink>
            ) : (
              <>
                <NavLink to="/demands" className={navCls}>
                  Demands
                </NavLink>
                <NavLink to="/prices" className={navCls}>
                  Prices
                </NavLink>
                <NotificationBell />
              </>
            )}
            <button
              className="border-2 border-ink bg-paper px-3 py-1.5 text-[12px] font-bold uppercase tracking-wide hover:bg-ink hover:text-paper"
              onClick={() => {
                setToken(null);
                navigate(role === 'driver' ? '/driver/login' : '/login');
              }}
            >
              Log out
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-5">
        <Outlet />
      </main>
    </div>
  );
}
