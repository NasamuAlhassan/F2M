import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, setToken } from '../api';
import { F2MSeal, VehicleMark } from '../components/engrave';
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
    <div className="plate flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="certificate w-full max-w-md bg-[var(--paper)] p-8">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="relative">
            <F2MSeal className="h-16 w-16" />
            <VehicleMark
              code="van"
              className="absolute -bottom-1 -right-2 h-7 w-7 rounded-full border border-[var(--ink-3)] bg-[var(--paper-lift)] p-1 text-[var(--ink)]"
            />
          </span>
          <div>
            <h1 className="display text-xl font-semibold tracking-[0.12em] text-[var(--ink)]">DRIVER WAYBILL</h1>
            <p className="smallcaps mt-1 text-[var(--ink-6)]">Logistics Dispatch · Middle-Mile Bridge</p>
          </div>
          <div className="guilloche-ink h-[10px] w-40" />
        </div>
        <div className="flex flex-col gap-4">
          <Field label="Phone Number">
            <input
              className={`${inputCls} serial`}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="024 000 0000"
              autoComplete="tel"
            />
          </Field>
          <Field label="PIN (set during USSD registration)">
            <input
              className={`${inputCls} serial text-center tracking-[0.5em]`}
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="····"
            />
          </Field>
          {error && <p className="stamp px-3 py-2 text-[11px] text-[var(--stamp)]">{error}</p>}
          <button className={`${btnCls} w-full py-2.5`} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign In'}
          </button>
          <p className="text-center text-xs text-[var(--ink-6)]">
            No account? Dial the USSD code and choose “Register as a driver”.{' '}
            <Link to="/login" className="font-semibold text-[var(--gold-deep)] hover:underline">
              Buyer login
            </Link>
          </p>
        </div>
      </form>
    </div>
  );
}
