import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, setToken } from '../api';
import { btnCls, Field, inputCls } from '../components/ui';

/**
 * Farmer web login (D-032): phone → one-time code over SMS. In the offline
 * demo the code lands in the USSD simulator's SMS inbox for the same phone.
 */
export function FarmerLoginPage() {
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (step === 'phone') {
        await api('/api/auth/farmer-otp', { method: 'POST', body: JSON.stringify({ phone }) });
        setStep('code');
      } else {
        const res = await api<{ token: string }>('/api/auth/farmer-login', {
          method: 'POST',
          body: JSON.stringify({ phone, code }),
        });
        setToken(res.token, 'farmer');
        navigate('/farmer/dashboard');
      }
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
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#D97706] text-lg">👨🏾‍🌾</div>
          <div>
            <div className="text-sm font-bold text-white">Farm to Market — Seller</div>
            <div className="text-[11px] text-green-300">Farmer Dashboard · List, Sell, Get Paid</div>
          </div>
        </div>
        <div className="flex flex-col gap-4 p-6">
          <Field label="Phone Number (your USSD identity)">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">🇬🇭</span>
              <input
                className={`${inputCls} pl-9`}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="020 123 4567"
                autoComplete="tel"
                disabled={step === 'code'}
              />
            </div>
          </Field>
          {step === 'code' && (
            <Field label="Login code — sent to your phone by SMS">
              <input
                className={`${inputCls} mono text-center text-lg tracking-[0.4em]`}
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="······"
                autoFocus
              />
              <span className="mt-1.5 block text-[10px] text-gray-400">
                Demo tip: the code appears in the USSD simulator's SMS inbox for this phone.
              </span>
            </Field>
          )}
          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>
          )}
          <button className={`${btnCls} w-full py-2.5`} disabled={busy}>
            {busy ? 'Please wait…' : step === 'phone' ? 'Send Login Code' : 'Sign In'}
          </button>
          {step === 'code' && (
            <button
              type="button"
              className="text-center text-[11px] font-semibold text-gray-400 hover:text-gray-600"
              onClick={() => {
                setStep('phone');
                setCode('');
              }}
            >
              ← Different phone number
            </button>
          )}
          <p className="text-center text-[11px] text-gray-400">
            No account? Dial the USSD code and register — it takes a minute.{' '}
            <Link to="/login" className="font-semibold text-[#1B4332] hover:underline">
              Buyer login →
            </Link>
          </p>
        </div>
      </form>
    </div>
  );
}
