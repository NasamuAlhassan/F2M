import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, setToken } from '../api';
import { F2MSeal, Glyph } from '../components/engrave';
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
    <div className="plate flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="certificate w-full max-w-md bg-[var(--paper)] p-8">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="relative">
            <F2MSeal className="h-16 w-16" />
            <Glyph
              name="farmer"
              className="absolute -bottom-1 -right-2 h-7 w-7 rounded-full border border-[var(--ink-3)] bg-[var(--paper-lift)] p-1 text-[var(--ink)]"
            />
          </span>
          <div>
            <h1 className="display text-xl font-semibold tracking-[0.12em] text-[var(--ink)]">SELLER DESK</h1>
            <p className="smallcaps mt-1 text-[var(--ink-6)]">List · Sell · Get Paid</p>
          </div>
          <div className="guilloche-ink h-[10px] w-40" />
        </div>
        <div className="flex flex-col gap-4">
          <Field label="Phone Number (your USSD identity)">
            <input
              className={`${inputCls} serial`}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="020 123 4567"
              autoComplete="tel"
              disabled={step === 'code'}
            />
          </Field>
          {step === 'code' && (
            <Field label="Login code — sent to your phone by SMS">
              <input
                className={`${inputCls} serial text-center text-lg tracking-[0.45em]`}
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="······"
                autoFocus
              />
              <span className="mt-1.5 block text-[11px] text-[var(--ink-6)]">
                Demo tip: the code appears in the USSD simulator's SMS inbox for this phone.
              </span>
            </Field>
          )}
          {error && <p className="stamp px-3 py-2 text-[11px] text-[var(--stamp)]">{error}</p>}
          <button className={`${btnCls} w-full py-2.5`} disabled={busy}>
            {busy ? 'Please wait…' : step === 'phone' ? 'Send Login Code' : 'Sign In'}
          </button>
          {step === 'code' && (
            <button
              type="button"
              className="smallcaps text-center text-[var(--ink-6)] hover:text-[var(--ink)]"
              onClick={() => {
                setStep('phone');
                setCode('');
              }}
            >
              ← Different phone number
            </button>
          )}
          <p className="text-center text-xs text-[var(--ink-6)]">
            No account? Dial the USSD code and register — it takes a minute.{' '}
            <Link to="/login" className="font-semibold text-[var(--gold-deep)] hover:underline">
              Buyer login
            </Link>
          </p>
        </div>
      </form>
    </div>
  );
}
