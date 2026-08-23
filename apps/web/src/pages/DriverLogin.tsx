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
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <form onSubmit={submit} className="w-96 border-2 border-ink bg-paper">
        <div className="border-b-2 border-ink px-4 py-3">
          <h1 className="text-base font-bold uppercase tracking-widest">Farm to Market</h1>
          <p className="text-[11px] uppercase tracking-wide text-ink-soft">Driver terminal</p>
        </div>
        <div className="space-y-3 p-4">
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
          {error && <p className="border border-err px-2 py-1.5 text-sm text-err">{error}</p>}
          <button className={`${btnCls} w-full`} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="text-[11px] text-ink-soft">
            No account? Dial the USSD code and choose “Register as a driver”.{' '}
            <Link to="/login" className="underline">
              Buyer login
            </Link>
          </p>
        </div>
      </form>
    </div>
  );
}
