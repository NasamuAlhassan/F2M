import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, setToken } from '../api';
import { F2MSeal } from '../components/engrave';
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
    <div className="plate flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="certificate w-full max-w-md bg-[var(--paper)] p-8">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <F2MSeal className="h-16 w-16" />
          <div>
            <h1 className="display text-xl font-semibold tracking-[0.12em] text-[var(--ink)]">FARM TO MARKET</h1>
            <p className="smallcaps mt-1 text-[var(--ink-6)]">Buyer Portal · Agritech Marketplace Ghana</p>
          </div>
          <div className="guilloche-ink h-[10px] w-40" />
        </div>
        <div className="flex flex-col gap-4">
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
            <p className="stamp px-3 py-2 text-[11px] text-[var(--stamp)]">{error}</p>
          )}
          <button className={`${btnCls} w-full py-2.5`} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign In'}
          </button>
          <p className="text-center text-xs text-[var(--ink-6)]">
            Demo account: buyer@demo.ftm ·{' '}
            <Link to="/farmer/login" className="font-semibold text-[var(--gold-deep)] hover:underline">
              Farmer login
            </Link>{' '}
            ·{' '}
            <Link to="/driver/login" className="font-semibold text-[var(--gold-deep)] hover:underline">
              Driver login
            </Link>
          </p>
        </div>
      </form>
    </div>
  );
}
