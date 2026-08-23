import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { getRole, setToken } from '../api';

function navCls({ isActive }: { isActive: boolean }): string {
  return `border-2 border-ink px-3 py-1.5 text-[12px] font-bold uppercase tracking-wide ${
    isActive ? 'bg-ink text-paper' : 'bg-paper text-ink hover:bg-ink hover:text-paper'
  }`;
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
