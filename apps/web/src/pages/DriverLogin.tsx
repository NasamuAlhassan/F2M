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
    <div className="flex min-h-screen items-center justify-center bg-[#1B4332] px-4">
      <form onSubmit={submit} className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center gap-3 bg-[#1B4332] px-6 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#D97706] text-lg">🚛</div>
          <div>
            <div className="text-sm font-bold text-white">Farm to Market — Driver</div>
            <div className="text-[11px] text-green-300">Logistics Dispatch · Middle-Mile Bridge</div>
          </div>
        </div>
        <div className="flex flex-col gap-4 p-6">
          <Field label="Phone Number">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">🇬🇭</span>
              <input
                className={`${inputCls} pl-9`}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="024 000 0000"
                autoComplete="tel"
              />
            </div>
          </Field>
          <Field label="PIN (set during USSD registration)">
            <input
              className={inputCls}
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="••••"
            />
          </Field>
          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>
          )}
          <button className={`${btnCls} w-full py-2.5`} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign In'}
          </button>
          <p className="text-center text-[11px] text-gray-400">
            No account? Dial the USSD code and choose “Register as a driver”.{' '}
            <Link to="/login" className="font-semibold text-[#1B4332] hover:underline">
              Buyer login →
            </Link>
          </p>
        </div>
      </form>
    </div>
  );
}
