import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
      navigate('/demands');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-green-950">
      <form onSubmit={submit} className="w-80 rounded-xl bg-white p-6 shadow-2xl">
        <h1 className="mb-1 text-xl font-bold text-green-900">Farm to Market</h1>
        <p className="mb-5 text-sm text-stone-500">Buyer portal</p>
        <div className="space-y-3">
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
          {error && <p className="text-sm text-red-700">{error}</p>}
          <button className={`${btnCls} w-full`} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="text-xs text-stone-400">Demo account: buyer@demo.ftm (password printed by the seed script)</p>
        </div>
      </form>
    </div>
  );
}
