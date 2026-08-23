import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, setToken } from '../api';
import { btnCls, Field, inputCls } from '../components/ui';

export function DriverLoginPage() {
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ token: string }>('/api/auth/driver-login', {
        method: 'POST',
        body: JSON.stringify({ phone, pin }),
      });
      setToken(res.token, 'driver');
      navigate('/driver/jobs');
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
        <p className="mb-5 text-sm text-stone-500">Driver portal</p>
        <div className="space-y-3">
          <Field label="Phone number">
            <input
              className={inputCls}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="024 000 0000"
              autoComplete="tel"
            />
          </Field>
          <Field label="PIN (set during USSD registration)">
            <input
              className={inputCls}
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
            />
          </Field>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <button className={`${btnCls} w-full`} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="text-xs text-stone-400">
            No account? Dial the USSD code and choose “Register as a driver”.{' '}
            <Link to="/login" className="text-green-700 hover:underline">
              Buyer login
            </Link>
          </p>
        </div>
      </form>
    </div>
  );
}
