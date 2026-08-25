import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signInWithPassword, signUp } from '../hooks/useAuth';
import { uploadLicensePhoto } from '../lib/licensePhoto';
import { isSupabaseConfigured, type AppRole } from '../lib/supabase';
import { btnCls, btnGhostCls, Field, inputCls } from '../components/ui';

/**
 * The unified signup/login the team decided on: one page, pick your role
 * instead of three separate login URLs. This is a placeholder shell for
 * tomorrow's design files, not a finished screen — the logic here (role
 * routing, driver verification, the email-confirmation fork below) is the
 * part meant to survive the restyle.
 *
 * Talks to signUp/signInWithPassword from hooks/useAuth, not Supabase
 * directly — that indirection is what lets this whole screen work with zero
 * external setup: no configured Supabase project means every call here
 * transparently runs against the mock backend instead (lib/mockAuth.ts),
 * same mock-first shape as every other provider in this app.
 */

const ROLES: Array<{ value: AppRole; label: string; blurb: string }> = [
  { value: 'buyer', label: 'Buyer', blurb: 'Browse the marketplace, place bulk orders' },
  { value: 'seller', label: 'Seller', blurb: 'List and sell your produce in bulk' },
  { value: 'driver', label: 'Driver', blurb: 'Deliver orders — license verification required' },
];

const HOME_PATH: Record<AppRole, string> = {
  buyer: '/app/buyer',
  seller: '/app/seller',
  driver: '/app/driver',
};

export function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'signup' | 'signin'>('signup');
  const [role, setRole] = useState<AppRole | null>(null);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [company, setCompany] = useState('');
  const [vehicleClass, setVehicleClass] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [licenseFile, setLicenseFile] = useState<File | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmPending, setConfirmPending] = useState(false);

  async function submitSignUp(e: React.FormEvent) {
    e.preventDefault();
    if (!role) return;
    setBusy(true);
    setError(null);
    try {
      const { userId, hasSession } = await signUp({
        email,
        password,
        role,
        fullName,
        phone: phone || null,
        company: role === 'buyer' ? company || null : null,
        vehicleClass: role === 'driver' ? vehicleClass || null : null,
        licenseNumber: role === 'driver' ? licenseNumber || null : null,
      });

      // Real Supabase has two outcomes here: with email confirmation off,
      // signUp() hands back an active session immediately and the driver's
      // license photo can upload right now; with it on, there's no session
      // yet (RLS would reject the upload), so the honest move is to say so
      // and let them add the photo after they confirm and sign in. Mock
      // mode always takes the first path — signup is instant, no
      // confirmation step exists to wait on.
      if (hasSession) {
        if (role === 'driver' && licenseFile) {
          const { error: uploadErr } = await uploadLicensePhoto(userId, licenseFile);
          if (uploadErr) throw new Error(`Account created, but the license photo failed to upload: ${uploadErr}`);
        }
        navigate(HOME_PATH[role]);
      } else {
        setConfirmPending(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign up failed');
    } finally {
      setBusy(false);
    }
  }

  async function submitSignIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { role: signedInRole } = await signInWithPassword(email, password);
      navigate(signedInRole ? HOME_PATH[signedInRole] : '/auth');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setBusy(false);
    }
  }

  if (confirmPending) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="text-xl font-semibold">Check your email</h1>
        <p className="text-sm text-[var(--ink-6)]">
          We sent a confirmation link to <strong>{email}</strong>. Confirm it, then sign in below.
          {role === 'driver' && licenseFile && ' You can add your license photo from your dashboard once you sign in.'}
        </p>
        <button
          className={btnGhostCls}
          onClick={() => {
            setConfirmPending(false);
            setMode('signin');
          }}
        >
          Go to sign in
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-10">
      {!isSupabaseConfigured() && (
        <p className="smallcaps self-center rounded-full bg-[var(--gold-wash)] px-3 py-1 text-[var(--gold-ink)]">
          Demo mode — accounts live in this browser only
        </p>
      )}
      <div className="text-center">
        <h1 className="text-2xl font-bold">Farm to Market</h1>
        <p className="text-sm text-[var(--ink-6)]">{mode === 'signup' ? 'Create your account' : 'Sign in'}</p>
      </div>

      <div className="flex gap-2 self-center">
        <button
          className={`px-3 py-1.5 text-sm font-semibold ${mode === 'signup' ? 'text-[var(--ink)] underline' : 'text-[var(--ink-5)]'}`}
          onClick={() => {
            setMode('signup');
            setError(null);
          }}
        >
          Sign up
        </button>
        <button
          className={`px-3 py-1.5 text-sm font-semibold ${mode === 'signin' ? 'text-[var(--ink)] underline' : 'text-[var(--ink-5)]'}`}
          onClick={() => {
            setMode('signin');
            setError(null);
          }}
        >
          Sign in
        </button>
      </div>

      {mode === 'signin' ? (
        <form onSubmit={submitSignIn} className="flex flex-col gap-4">
          <Field label="Email">
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              className={inputCls}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              name="current-password"
              autoComplete="current-password"
              required
              className={inputCls}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {error && <p className="text-sm text-[var(--stamp)]">{error}</p>}
          <button className={btnCls} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      ) : !role ? (
        <div className="flex flex-col gap-3">
          {ROLES.map((r) => (
            <button
              key={r.value}
              onClick={() => setRole(r.value)}
              className="rounded-xl border border-[var(--ink-3)] p-4 text-left transition-colors hover:border-[var(--ink-6)] hover:bg-[var(--paper-deep)]"
            >
              <div className="font-semibold">{r.label}</div>
              <div className="text-sm text-[var(--ink-6)]">{r.blurb}</div>
            </button>
          ))}
        </div>
      ) : (
        <form onSubmit={submitSignUp} className="flex flex-col gap-4">
          <button type="button" onClick={() => setRole(null)} className="self-start text-sm text-[var(--ink-6)] underline">
            ← {ROLES.find((r) => r.value === role)?.label}, change role
          </button>

          <Field label="Full name">
            <input
              name="name"
              autoComplete="name"
              required
              className={inputCls}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              className={inputCls}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              name="new-password"
              autoComplete="new-password"
              required
              minLength={8}
              className={inputCls}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field label="Phone">
            <input
              type="tel"
              name="tel"
              autoComplete="tel"
              className={inputCls}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>

          {role === 'buyer' && (
            <Field label="Company (optional)">
              <input
                name="organization"
                autoComplete="organization"
                className={inputCls}
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              />
            </Field>
          )}

          {role === 'driver' && (
            <>
              <Field label="Vehicle class">
                <input
                  name="vehicle-class"
                  autoComplete="off"
                  required
                  placeholder="e.g. tricycle, van, light truck"
                  className={inputCls}
                  value={vehicleClass}
                  onChange={(e) => setVehicleClass(e.target.value)}
                />
              </Field>
              <Field label="License number">
                <input
                  name="license-number"
                  autoComplete="off"
                  required
                  className={inputCls}
                  value={licenseNumber}
                  onChange={(e) => setLicenseNumber(e.target.value)}
                />
              </Field>
              <Field label="License photo">
                <input
                  type="file"
                  name="license-photo"
                  accept="image/*"
                  required
                  className={inputCls}
                  onChange={(e) => setLicenseFile(e.target.files?.[0] ?? null)}
                />
              </Field>
              <p className="text-xs text-[var(--ink-6)]">
                Your license is reviewed before you can accept deliveries — this account starts in "pending" until then.
              </p>
            </>
          )}

          {error && <p className="text-sm text-[var(--stamp)]">{error}</p>}
          <button className={btnCls} disabled={busy}>
            {busy ? 'Creating account…' : 'Create account'}
          </button>
        </form>
      )}
    </div>
  );
}
