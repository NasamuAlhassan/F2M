import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api, type Registries, type Role } from '../api';
import { F2MSeal, Glyph, VehicleMark } from '../components/engrave';
import { btnCls, Field, inputCls } from '../components/ui';
import { HOME_FOR, signIn, signOut, signUp, useAccount, type AccountView } from '../lib/session';
import { supabase } from '../lib/supabase';

/**
 * One door for everyone on the web (D-047): sign in, or create an account
 * with a phone number and password and then say who you are on F2M —
 * farmer, buyer or driver. The same phone a farmer dials USSD from opens the
 * same profile here.
 */

const ROLE_CHOICES: Array<{ role: Role; label: string; blurb: string }> = [
  { role: 'farmer', label: 'Farmer', blurb: 'I grow and sell produce' },
  { role: 'buyer', label: 'Buyer', blurb: 'I buy produce for my business' },
  { role: 'driver', label: 'Driver', blurb: 'I move produce with my vehicle' },
];

function RoleIcon({ role, className }: { role: Role; className: string }) {
  if (role === 'driver') return <VehicleMark code="van" className={className} />;
  if (role === 'farmer') return <Glyph name="farmer" className={className} />;
  return <F2MSeal className={className} />;
}

function Frame({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div
      className="plate flex min-h-screen items-center justify-center bg-cover bg-center px-4 py-8"
      style={{
        backgroundImage:
          'linear-gradient(160deg, color-mix(in srgb, var(--forest-deep) 92%, black) 0%, color-mix(in srgb, var(--forest) 80%, transparent) 55%, color-mix(in srgb, var(--forest-deep) 92%, black) 100%), url(/images/marketing/market-hero.jpg)',
      }}
    >
      <div className="certificate w-full max-w-md bg-[var(--paper)] p-8">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <F2MSeal className="h-16 w-16" />
          <div>
            <h1 className="display text-xl font-semibold tracking-[0.12em] text-[var(--ink)]">{title}</h1>
            <p className="smallcaps mt-1 text-[var(--ink-6)]">{subtitle}</p>
          </div>
          <div className="h-[3px] w-12 rounded-full bg-[var(--gold)]" />
        </div>
        {children}
      </div>
    </div>
  );
}

function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="stamp px-3 py-2 text-[11px] text-[var(--stamp)]">
      {message}
    </p>
  );
}

function CredentialsForm() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === 'signup' && password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await (mode === 'signin' ? signIn(phone, password) : signUp(phone, password));
      await queryClient.invalidateQueries({ queryKey: ['account'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong — try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div role="tablist" aria-label="Sign in or create an account" className="mb-6 flex gap-1 rounded-full bg-[var(--paper-deep)] p-1">
        {(['signin', 'signup'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => {
              setMode(m);
              setError(null);
            }}
            className={`smallcaps flex min-h-11 flex-1 items-center justify-center rounded-full transition-colors lg:min-h-9 ${
              mode === m ? 'bg-[var(--forest)] text-[var(--paper)] shadow-sm' : 'text-[var(--ink-6)] hover:text-[var(--ink)]'
            }`}
          >
            {m === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Phone number">
          <input
            className={`${inputCls} serial`}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="024 123 4567"
            inputMode="tel"
            autoComplete="tel"
            required
          />
        </Field>
        <Field label="Password">
          <input
            className={inputCls}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            minLength={6}
            required
          />
        </Field>
        {mode === 'signup' && (
          <Field label="Password again">
            <input
              className={inputCls}
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              minLength={6}
              required
            />
          </Field>
        )}
        <ErrorLine message={error} />
        <button className={`${btnCls} w-full py-2.5`} disabled={busy}>
          {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
        {mode === 'signup' && (
          <p className="text-center text-xs text-[var(--ink-6)]">
            F2M is invite-only for now: your number must be on the invite list.
          </p>
        )}
      </form>
    </>
  );
}

function ProfileForm() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: registries } = useQuery({ queryKey: ['registries'], queryFn: () => api<Registries>('/api/registries') });
  const [role, setRole] = useState<Role | null>(null);
  const [name, setName] = useState('');
  const [regionCode, setRegionCode] = useState('');
  const [district, setDistrict] = useState('');
  const [company, setCompany] = useState('');
  const [vehicleClassCode, setVehicleClassCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!role) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        role,
        name,
        regionCode,
        ...(role === 'farmer' && district.trim() ? { district } : {}),
        ...(role === 'buyer' && company.trim() ? { company } : {}),
        ...(role === 'driver' ? { vehicleClassCode } : {}),
      };
      const { account } = await api<{ account: AccountView }>('/api/account/register', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      await queryClient.invalidateQueries({ queryKey: ['account'] });
      navigate(HOME_FOR[account.role], { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create your profile — try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="smallcaps mb-2 text-[var(--ink-6)]">I am a…</legend>
        {ROLE_CHOICES.map((c) => (
          <label
            key={c.role}
            className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 transition-colors ${
              role === c.role ? 'border-[var(--forest)] bg-[var(--paper-deep)]' : 'border-[var(--ink-2)] hover:border-[var(--ink-4)]'
            }`}
          >
            <input type="radio" name="role" className="sr-only" checked={role === c.role} onChange={() => setRole(c.role)} />
            <RoleIcon role={c.role} className="h-6 w-6 shrink-0 text-[var(--ink)]" />
            <span>
              <span className="block font-semibold text-[var(--ink)]">{c.label}</span>
              <span className="block text-xs text-[var(--ink-6)]">{c.blurb}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {role && (
        <>
          <Field label={role === 'buyer' ? 'Your name (the contact person)' : 'Your name'}>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
          </Field>
          {role === 'buyer' && (
            <Field label="Business name (optional)">
              <input className={inputCls} value={company} onChange={(e) => setCompany(e.target.value)} autoComplete="organization" />
            </Field>
          )}
          <Field label="Region">
            <select className={inputCls} value={regionCode} onChange={(e) => setRegionCode(e.target.value)} required>
              <option value="">Choose your region</option>
              {registries?.regions.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
          {role === 'farmer' && (
            <Field label="District or community (optional)">
              <input className={inputCls} value={district} onChange={(e) => setDistrict(e.target.value)} />
            </Field>
          )}
          {role === 'driver' && (
            <Field label="Your vehicle">
              <select className={inputCls} value={vehicleClassCode} onChange={(e) => setVehicleClassCode(e.target.value)} required>
                <option value="">Choose your vehicle</option>
                {registries?.vehicleClasses.map((v) => (
                  <option key={v.code} value={v.code}>
                    {v.name} — carries up to {v.capacityKg.toLocaleString('en-GH')} kg
                  </option>
                ))}
              </select>
            </Field>
          )}
          <ErrorLine message={error} />
          <button className={`${btnCls} w-full py-2.5`} disabled={busy}>
            {busy ? 'Saving…' : 'Continue'}
          </button>
        </>
      )}
      <button
        type="button"
        className="smallcaps text-center text-[var(--ink-6)] hover:text-[var(--ink)]"
        onClick={() => void signOut().then(() => queryClient.invalidateQueries({ queryKey: ['account'] }))}
      >
        Not your number? Sign out
      </button>
    </form>
  );
}

export function LoginPage() {
  const { loading, signedIn, account, error } = useAccount();

  if (!supabase) {
    return (
      <Frame title="FARM TO MARKET" subtitle="Agritech Marketplace · Ghana">
        <ErrorLine message="Logins are not set up on this copy of F2M: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are missing from .env (see supabase/README.md)." />
      </Frame>
    );
  }
  if (loading) {
    return (
      <Frame title="FARM TO MARKET" subtitle="Agritech Marketplace · Ghana">
        <p className="smallcaps text-center text-[var(--ink-6)]">Loading…</p>
      </Frame>
    );
  }
  if (account) return <Navigate to={HOME_FOR[account.role]} replace />;
  if (signedIn) {
    return (
      <Frame title="YOUR F2M PROFILE" subtitle="One last step">
        <ProfileForm />
      </Frame>
    );
  }
  return (
    <Frame title="FARM TO MARKET" subtitle="Agritech Marketplace · Ghana">
      {error && <ErrorLine message={error.message} />}
      <CredentialsForm />
    </Frame>
  );
}
