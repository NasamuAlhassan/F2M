import { Link, Outlet, useNavigate } from 'react-router-dom';
import { setToken } from '../api';

export function Layout() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen">
      <header className="bg-green-900 text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link to="/demands" className="text-lg font-semibold tracking-tight">
            Farm to Market <span className="font-normal text-green-300">· Buyer</span>
          </Link>
          <nav className="flex items-center gap-5 text-sm">
            <Link to="/demands" className="hover:text-green-200">
              Demands
            </Link>
            <button
              className="rounded bg-green-800 px-3 py-1 hover:bg-green-700"
              onClick={() => {
                setToken(null);
                navigate('/login');
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
