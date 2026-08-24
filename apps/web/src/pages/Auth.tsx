import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { uploadLicensePhoto } from '../lib/licensePhoto';
import { type AppRole, supabase } from '../lib/supabase';
import { btnCls, btnGhostCls, Field, inputCls } from '../components/ui';

/**
 * The unified signup/login the team decided on: one page, pick your role
 * instead of three separate login URLs. This is a placeholder shell for
 * tomorrow's design files, not a finished screen — the logic here (role
 * routing, driver verification, the email-confirmation fork below) is the
 * part meant to survive the restyle.
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
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            role,
            full_name: fullName,
            phone: phone || null,
            company: role === 'buyer' ? company || null : null,
            vehicle_class: role === 'driver' ? vehicleClass || null : null,
            license_number: role === 'driver' ? licenseNumber || null : null,
          },
        },
      });
      if (signUpError) throw signUpError;
      if (!data.user) throw new Error('Sign up did not return a user — try again.');

      // Two real Supabase outcomes here, not one: if email confirmation is
      // off, signUp() hands back an active session immediately and the
      // driver's license photo can upload right now. If confirmation is
      // required, there's no session yet — RLS would reject the upload, so
      // the honest move is to say so and let them add the photo after they
      // confirm and sign in, not silently drop it or fake success.
      if (data.session) {
        if (role === 'driver' && licenseFile) {
          const { error: uploadErr } = await uploadLicensePhoto(data.user.id, licenseFile);
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
      const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', data.user.id).single();
      navigate(profile ? HOME_PATH[profile.role as AppRole] : '/auth');
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
