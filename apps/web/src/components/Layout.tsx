import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { api, dateTime, getRole, setToken } from '../api';

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
        className={`rounded px-3 py-1 hover:bg-green-700 ${open ? 'bg-green-700' : 'bg-green-800'}`}
        onClick={() => setOpen((v) => !v)}
      >
        Alerts
        {unread > 0 && (
          <span className="ml-1.5 rounded-full bg-amber-400 px-1.5 text-xs font-bold text-green-950">{unread}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-96 rounded-lg border border-stone-200 bg-white text-stone-900 shadow-xl">
          <div className="flex items-center justify-between border-b border-stone-100 px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">Notifications</span>
            {unread > 0 && (
              <button
                className="rounded border border-stone-300 px-2 py-0.5 text-xs font-medium hover:bg-stone-100"
                onClick={() => markRead.mutate()}
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {!data?.notifications.length ? (
              <p className="px-3 py-2 text-sm text-stone-500">Nothing yet — alerts appear as the engine works.</p>
            ) : (
              data.notifications.map((n) => (
                <div
                  key={n.id}
                  className={`border-b border-stone-100 px-3 py-2 text-sm last:border-b-0 ${n.readAt ? 'text-stone-400' : ''}`}
                >
                  <p>{n.message}</p>
                  <p className="mt-0.5 flex items-baseline justify-between text-xs text-stone-400">
                    <span>{dateTime(n.createdAt)}</span>
                    {n.contractId && (
                      <Link
                        to={`/contracts/${n.contractId}`}
                        className="text-green-700 hover:underline"
                        onClick={() => setOpen(false)}
                      >
                        Contract →
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
    <div className="min-h-screen">
      <header className="bg-green-900 text-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <Link to={role === 'driver' ? '/driver/jobs' : '/demands'} className="text-lg font-semibold tracking-tight">
            Farm to Market <span className="font-normal text-green-300">· {role === 'driver' ? 'Driver' : 'Buyer'}</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            {role === 'driver' ? (
              <Link to="/driver/jobs" className="hover:text-green-200">
                Jobs
              </Link>
            ) : (
              <>
                <Link to="/demands" className="hover:text-green-200">
                  Demands
                </Link>
                <Link to="/prices" className="hover:text-green-200">
                  Market prices
                </Link>
                <NotificationBell />
              </>
            )}
            <button
              className="rounded bg-green-800 px-3 py-1 hover:bg-green-700"
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
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
