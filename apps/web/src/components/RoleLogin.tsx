import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setToken, type Role } from '../api';
import { F2MSeal, Glyph, VehicleMark } from './engrave';
import { btnCls, Field, inputCls } from './ui';

/**
 * One login card, three tabs — replacing the old pattern of three separate
 * pages that linked to each other through a small line of text at the
 * bottom ("Farmer login · Driver login"). Each role keeps its own real auth
 * flow and its own isolated state, so switching tabs to check something and
 * switching back never loses what you typed.
 */

const TABS: Array<{ role: Role; label: string; icon: 'farmer' | 'van' | null }> = [
  { role: 'buyer', label: 'Buyer', icon: null },
  { role: 'farmer', label: 'Farmer', icon: 'farmer' },
  { role: 'driver', label: 'Driver', icon: 'van' },
];

const PATH_FOR: Record<Role, string> = {
  buyer: '/login',
  farmer: '/farmer/login',
  driver: '/driver/login',
};

const HEADING: Record<Role, { title: string; subtitle: string }> = {
  buyer: { title: 'FARM TO MARKET', subtitle: 'Buyer Portal · Agritech Marketplace Ghana' },
  farmer: { title: 'SELLER DESK', subtitle: 'List · Sell · Get Paid' },
  driver: { title: 'DRIVER WAYBILL', subtitle: 'Logistics Dispatch · Middle-Mile Bridge' },
};

function RoleBadge({ role }: { role: Role }) {
  if (role === 'buyer') return <F2MSeal className="h-16 w-16" />;
  return (
    <span className="relative">
      <F2MSeal className="h-16 w-16" />
      {role === 'farmer' ? (
        <Glyph
          name="farmer"
          className="absolute -bottom-1 -right-2 h-7 w-7 rounded-full border border-[var(--ink-3)] bg-[var(--paper-lift)] p-1 text-[var(--ink)]"
        />
      ) : (
        <VehicleMark
          code="van"
          className="absolute -bottom-1 -right-2 h-7 w-7 rounded-full border border-[var(--ink-3)] bg-[var(--paper-lift)] p-1 text-[var(--ink)]"
        />
      )}
    </span>
  );
}

function BuyerForm() {
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
      setToken(res.token, 'buyer');
      navigate('/market');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Email">
        <input
          className={inputCls}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
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
      {error && <p className="stamp px-3 py-2 text-[11px] text-[var(--stamp)]">{error}</p>}
      <button className={`${btnCls} w-full py-2.5`} disabled={busy}>
        {busy ? 'Signing in…' : 'Sign In'}
      </button>
      {/* The seed's demo buyer, already public in docs/DEPLOY.md — which also
          says to change it before real users. Quoting the password beside the
          email spares a live demo the one thing nobody remembers on stage. */}
      <p className="text-center text-xs text-[var(--ink-6)]">
        Demo account: <span className="serial">buyer@demo.ftm</span> ·{' '}
        <span className="serial">demo-buyer-2026</span>
      </p>
    </form>
  );
}

function FarmerForm() {
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
    <form onSubmit={submit} className="flex flex-col gap-4">
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
      <p className="text-center text-xs text-[var(--ink-6)]">No account? Dial the USSD code and register — it takes a minute.</p>
    </form>
  );
}

function DriverForm() {
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
    <form onSubmit={submit} className="flex flex-col gap-4">
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
      <p className="text-center text-xs text-[var(--ink-6)]">No account? Dial the USSD code and choose "Register as a driver".</p>
    </form>
  );
}

export function RoleLogin({ initialRole }: { initialRole: Role }) {
  const navigate = useNavigate();
  const [active, setActive] = useState<Role>(initialRole);
  const heading = HEADING[active];

  function selectTab(role: Role) {
    setActive(role);
    navigate(PATH_FOR[role], { replace: true });
  }

  return (
    <div
      className="plate flex min-h-screen items-center justify-center bg-cover bg-center px-4 py-8"
      style={{
        backgroundImage:
          'linear-gradient(160deg, color-mix(in srgb, var(--forest-deep) 92%, black) 0%, color-mix(in srgb, var(--forest) 80%, transparent) 55%, color-mix(in srgb, var(--forest-deep) 92%, black) 100%), url(/images/marketing/market-hero.jpg)',
      }}
    >
      <div className="certificate w-full max-w-md bg-[var(--paper)] p-8">
        <div role="tablist" aria-label="Sign in as" className="flex gap-1 rounded-full bg-[var(--paper-deep)] p-1">
          {TABS.map((t) => (
            <button
              key={t.role}
              type="button"
              role="tab"
              aria-selected={active === t.role}
              onClick={() => selectTab(t.role)}
              className={`smallcaps flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full transition-colors lg:min-h-9 ${
                active === t.role
                  ? 'bg-[var(--forest)] text-[var(--paper)] shadow-sm'
                  : 'text-[var(--ink-6)] hover:text-[var(--ink)]'
              }`}
            >
              {t.icon === 'farmer' && <Glyph name="farmer" className="h-3.5 w-3.5" />}
              {t.icon === 'van' && <VehicleMark code="van" className="h-3.5 w-3.5" />}
              {t.label}
            </button>
          ))}
        </div>

        <div className="mb-6 mt-6 flex flex-col items-center gap-3 text-center">
          <RoleBadge role={active} />
          <div>
            <h1 className="display text-xl font-semibold tracking-[0.12em] text-[var(--ink)]">{heading.title}</h1>
            <p className="smallcaps mt-1 text-[var(--ink-6)]">{heading.subtitle}</p>
          </div>
          <div className="h-[3px] w-12 rounded-full bg-[var(--gold)]" />
        </div>

        {active === 'buyer' && <BuyerForm />}
        {active === 'farmer' && <FarmerForm />}
        {active === 'driver' && <DriverForm />}
      </div>
    </div>
  );
}
