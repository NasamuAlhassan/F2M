import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, setToken } from '../api';
import { btnCls, Field, inputCls } from '../components/ui';

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('buyer@demo.ftm');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ token: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setToken(res.token);
      navigate('/market');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#1B4332] px-4">
      <form onSubmit={submit} className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center gap-3 bg-[#1B4332] px-6 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#D97706] text-sm font-extrabold text-white">
            F2M
          </div>
          <div>
            <div className="text-sm font-bold text-white">Farm to Market</div>
            <div className="text-[11px] text-green-300">Buyer Portal · Agritech Marketplace Ghana</div>
          </div>
        </div>
        <div className="flex flex-col gap-4 p-6">
          <Field label="Email">
            <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </Field>
          <Field label="Password">
            <input
              className={inputCls}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </Field>
          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>
          )}
          <button className={`${btnCls} w-full py-2.5`} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign In'}
          </button>
          <p className="text-center text-[11px] text-gray-400">
            Demo account: buyer@demo.ftm ·{' '}
            <Link to="/farmer/login" className="font-semibold text-[#1B4332] hover:underline">
              Farmer login
            </Link>{' '}
            ·{' '}
            <Link to="/driver/login" className="font-semibold text-[#1B4332] hover:underline">
              Driver login
            </Link>
          </p>
        </div>
      </form>
    </div>
  );
}
