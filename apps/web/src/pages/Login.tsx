import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { api, type Registries, type Role } from '../api';
import { F2MSeal, Glyph, VehicleMark } from '../components/engrave';
import { AlertMark, btnCls, BusyLabel, fieldAria, fieldCls, FormField, PasswordInput, quietBtnCls, RadioCard } from '../components/ui';
import { pillItemCls, SlidingPillGroup } from '../components/SlidingPill';
import { HOME_FOR, signIn, signOut, signUp, toE164, useAccount, type AccountView } from '../lib/session';
import { useT } from '../lib/i18n';
import { supabaseConfigured } from '../lib/supabase';
import { SkipLink } from '../components/SkipLink';

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

function Frame({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  const { t } = useT();
  return (
    <div className="grid min-h-screen bg-[var(--paper)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <SkipLink />
      {/* The story panel: desktop only, so a phone opens straight onto the form. */}
      <aside
        className="plate on-dark relative hidden flex-col justify-between overflow-hidden bg-cover bg-center p-12 lg:flex"
        style={{
          backgroundImage:
            'linear-gradient(180deg, color-mix(in srgb, var(--forest-night) 72%, transparent) 0%, color-mix(in srgb, var(--forest-night) 94%, transparent) 70%), url(/images/marketing/market-hero.jpg)',
        }}
      >
        <Link to="/" className="flex min-h-11 items-center gap-2.5 rounded-full transition-opacity hover:opacity-85 active:opacity-70" aria-label={t('web.login.home', 'Farm to Market, home')}>
          <F2MSeal className="h-10 w-10" dark />
          <span className="text-lg font-extrabold uppercase tracking-[0.04em]">Farm to Market</span>
        </Link>
        <div className="max-w-md">
          <p className="headline text-4xl xl:text-5xl">{t('web.login.storyTitle', 'Selling from a basic phone?')}</p>
          <p className="mt-5 text-[17px] leading-relaxed text-[var(--ink-2)]">
            {t(
              'web.login.storyBody',
              'You do not need this website. Dial *384*7247# from any phone to list your produce, answer offers and check prices.',
            )}
          </p>
          <p className="mt-4 text-[15px] leading-relaxed text-[var(--ink-3)]">
            {t('web.login.storyOthers', 'Buyers, drivers and farmers with a smartphone can sign in here.')}
          </p>
        </div>
        <p className="text-xs text-[var(--ink-3)]">{t('web.login.prototype', 'Prototype · all payments are simulated')}</p>
      </aside>

      <main id="main" tabIndex={-1} className="flex flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between lg:justify-end">
          <Link to="/" className="flex min-h-11 items-center gap-2.5 rounded-full transition-opacity hover:opacity-85 active:opacity-70 lg:hidden" aria-label={t('web.login.home', 'Farm to Market, home')}>
            <F2MSeal className="h-9 w-9" />
            <span className="text-base font-extrabold uppercase tracking-[0.04em] text-[var(--forest-deep)]">Farm to Market</span>
          </Link>
          <Link to="/" className={quietBtnCls}>
            ← {t('web.login.backHome', 'Home')}
          </Link>
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h1 className="headline text-4xl text-[var(--ink)] sm:text-5xl">{title}</h1>
          {note && <p className="mt-3 text-[15px] leading-relaxed text-[var(--ink-7)]">{note}</p>}
          <div className="mb-8" />
          {children}
        </div>
      </main>
    </div>
  );
}

function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-2xl bg-[var(--stamp-wash)] px-4 py-3 text-sm leading-snug text-[var(--stamp-deep)]">
      <AlertMark className="mt-px h-[18px] w-[18px]" />
      <p>{message}</p>
    </div>
  );
}

type Mode = 'signin' | 'signup';
type CredField = 'phone' | 'password' | 'confirm';
type CredValues = { phone: string; password: string; confirm: string };

const CRED_IDS: Record<CredField, string> = { phone: 'login-phone', password: 'login-password', confirm: 'login-confirm' };

function CredentialsForm({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Partial<Record<CredField, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A ref, not the state: two taps inside one frame both see busy=false.
  const inFlight = useRef(false);
  const values: CredValues = { phone, password, confirm };
  const order: CredField[] = mode === 'signup' ? ['phone', 'password', 'confirm'] : ['phone', 'password'];

  function check(field: CredField, v: CredValues): string | undefined {
    if (field === 'phone') {
      const raw = v.phone.trim();
      if (!raw) return t('web.login.phoneMissing', 'Enter your phone number, like 024 123 4567.');
      try {
        toE164(raw);
      } catch {
        return t('web.login.phoneInvalid', 'That is not a Ghana number. Enter 10 digits starting with 0, like 024 123 4567.');
      }
      return undefined;
    }
    if (field === 'password') {
      if (mode === 'signup') {
        if (!v.password) return t('web.login.passwordChoose', 'Choose a password with at least 6 characters.');
        if (v.password.length < 6) return t('web.login.passwordShort', 'Use at least 6 characters.');
        return undefined;
      }
      return v.password ? undefined : t('web.login.passwordMissing', 'Enter your password.');
    }
    if (mode !== 'signup') return undefined;
    if (!v.confirm) return t('web.login.confirmMissing', 'Type your password again.');
    if (v.confirm !== v.password) return t('web.login.confirmMismatch', 'The two passwords are not the same. Type the same password in both boxes.');
    return undefined;
  }

  // On blur: only judge what was typed. Tabbing past an empty box is not a mistake yet.
  function onBlurField(field: CredField) {
    if (!values[field] && !errors[field]) return;
    const message = check(field, values);
    setErrors((cur) => ({ ...cur, [field]: message }));
  }

  // While typing: never add an error, only take one away once it is fixed.
  function edit(field: CredField, value: string) {
    if (field === 'phone') setPhone(value);
    else if (field === 'password') setPassword(value);
    else setConfirm(value);
    const next = { ...values, [field]: value };
    setErrors((cur) => {
      const out = { ...cur };
      for (const f of Object.keys(cur) as CredField[]) if (cur[f] && !check(f, next)) delete out[f];
      return out;
    });
  }

  function switchMode(m: Mode) {
    setMode(m);
    setErrors({});
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    setError(null);
    const found: Partial<Record<CredField, string>> = {};
    for (const f of order) {
      const message = check(f, values);
      if (message) found[f] = message;
    }
    setErrors(found);
    const first = order.find((f) => found[f]);
    if (first) {
      document.getElementById(CRED_IDS[first])?.focus();
      return;
    }
    inFlight.current = true;
    setBusy(true);
    try {
      const number = phone.trim();
      await (mode === 'signin' ? signIn(number, password) : signUp(number, password));
      await queryClient.invalidateQueries({ queryKey: ['account'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('web.login.genericError', 'Something went wrong. Check your connection and try again.'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <SlidingPillGroup
        watch={mode}
        role="tablist"
        aria-label={t('web.login.modeLabel', 'Sign in or create an account')}
        className="mb-6 flex gap-1 rounded-full border border-[var(--ink-2)] bg-[var(--paper-lift)] p-1"
      >
        {(['signin', 'signup'] as const).map((m) => (
          <button
            key={m}
            id={`login-tab-${m}`}
            type="button"
            role="tab"
            aria-selected={mode === m}
            aria-controls="login-panel"
            tabIndex={mode === m ? 0 : -1}
            onClick={() => switchMode(m)}
            onKeyDown={(e) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
              e.preventDefault();
              const next: Mode = e.key === 'Home' ? 'signin' : e.key === 'End' ? 'signup' : m === 'signin' ? 'signup' : 'signin';
              switchMode(next);
              document.getElementById(`login-tab-${next}`)?.focus();
            }}
            className={`${pillItemCls(mode === m)} flex-1`}
          >
            {m === 'signin' ? t('web.login.segSignin', 'Sign in') : t('web.login.segSignup', 'Create account')}
          </button>
        ))}
      </SlidingPillGroup>
      <div id="login-panel" role="tabpanel" aria-labelledby={`login-tab-${mode}`}>
        <form onSubmit={submit} noValidate aria-busy={busy} className="flex flex-col gap-4">
          <FormField
            id={CRED_IDS.phone}
            label={t('web.login.phoneLabel', 'Phone number')}
            hint={errors.phone ? undefined : t('web.login.phoneHint', 'Ghana number, like 024 123 4567')}
            error={errors.phone}
          >
            <input
              {...fieldAria(CRED_IDS.phone, errors.phone, !errors.phone && `${CRED_IDS.phone}-hint`)}
              className={`${fieldCls} serial`}
              type="tel"
              name="phone"
              inputMode="tel"
              autoComplete="tel"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={phone}
              onChange={(e) => edit('phone', e.target.value)}
              onBlur={() => onBlurField('phone')}
              required
            />
          </FormField>
          <FormField
            id={CRED_IDS.password}
            label={t('web.login.passwordLabel', 'Password')}
            hint={mode === 'signup' && !errors.password ? t('web.login.passwordHint', 'At least 6 characters.') : undefined}
            error={errors.password}
          >
            <PasswordInput
              {...fieldAria(CRED_IDS.password, errors.password, mode === 'signup' && !errors.password && `${CRED_IDS.password}-hint`)}
              showLabel={t('web.form.showPassword', 'Show password')}
              name="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              minLength={mode === 'signup' ? 6 : undefined}
              value={password}
              onChange={(e) => edit('password', e.target.value)}
              onBlur={() => onBlurField('password')}
              required
            />
          </FormField>
          {mode === 'signup' && (
            <FormField id={CRED_IDS.confirm} label={t('web.login.confirmLabel', 'Password again')} error={errors.confirm}>
              <PasswordInput
                {...fieldAria(CRED_IDS.confirm, errors.confirm)}
                showLabel={t('web.form.showPassword', 'Show password')}
                name="confirm-password"
                autoComplete="new-password"
                minLength={6}
                value={confirm}
                onChange={(e) => edit('confirm', e.target.value)}
                onBlur={() => onBlurField('confirm')}
                required
              />
            </FormField>
          )}
          <ErrorLine message={error} />
          <button type="submit" className={`${btnCls} mt-1 w-full py-3`} aria-disabled={busy || undefined} aria-busy={busy || undefined}>
            <BusyLabel
              busy={busy}
              label={mode === 'signin' ? t('web.login.submitSignin', 'Sign in') : t('web.login.submitSignup', 'Create account')}
              busyLabel={mode === 'signin' ? t('web.login.busySignin', 'Signing in…') : t('web.login.busySignup', 'Creating your account…')}
            />
          </button>
          {mode === 'signup' && (
            <p className="text-center text-xs text-[var(--ink-6)]">
              {t('web.login.inviteOnly', 'F2M is invite-only for now: your number must be on the invite list.')}
            </p>
          )}
        </form>
      </div>
    </>
  );
}

type ProfileFieldKey = 'name' | 'region' | 'vehicle';
type ProfileValues = { name: string; regionCode: string; vehicleClassCode: string };

const PROFILE_IDS: Record<ProfileFieldKey, string> = { name: 'profile-name', region: 'profile-region', vehicle: 'profile-vehicle' };

function ProfileForm() {
  const { t } = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: registries } = useQuery({ queryKey: ['registries'], queryFn: () => api<Registries>('/api/registries') });
  const [role, setRole] = useState<Role | null>(null);
  const [name, setName] = useState('');
  const [regionCode, setRegionCode] = useState('');
  const [district, setDistrict] = useState('');
  const [company, setCompany] = useState('');
  const [vehicleClassCode, setVehicleClassCode] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<ProfileFieldKey, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const values: ProfileValues = { name, regionCode, vehicleClassCode };
  const order: ProfileFieldKey[] = role === 'driver' ? ['name', 'region', 'vehicle'] : ['name', 'region'];

  // Static keys, so i18n:extract finds every one.
  const roleText = (r: Role): { label: string; blurb: string } =>
    r === 'farmer'
      ? { label: t('web.login.roleFarmer', 'Farmer'), blurb: t('web.login.roleFarmerBlurb', 'I grow and sell produce') }
      : r === 'buyer'
        ? { label: t('web.login.roleBuyer', 'Buyer'), blurb: t('web.login.roleBuyerBlurb', 'I buy produce for my business') }
        : { label: t('web.login.roleDriver', 'Driver'), blurb: t('web.login.roleDriverBlurb', 'I move produce with my vehicle') };

  function check(field: ProfileFieldKey, v: ProfileValues): string | undefined {
    if (field === 'name') {
      if (v.name.trim()) return undefined;
      return role === 'buyer'
        ? t('web.login.nameMissingBuyer', 'Enter the name of the person farmers and drivers should ask for.')
        : t('web.login.nameMissing', 'Enter your name, the way people know you.');
    }
    if (field === 'region') return v.regionCode ? undefined : t('web.login.regionMissing', 'Choose your region from the list.');
    if (role !== 'driver') return undefined;
    return v.vehicleClassCode ? undefined : t('web.login.vehicleMissing', 'Choose the vehicle you drive from the list.');
  }

  function onBlurField(field: ProfileFieldKey, value: string) {
    if (!value.trim() && !errors[field]) return;
    const message = check(field, values);
    setErrors((cur) => ({ ...cur, [field]: message }));
  }

  function clearFixed(next: ProfileValues) {
    setErrors((cur) => {
      const out = { ...cur };
      for (const f of Object.keys(cur) as ProfileFieldKey[]) if (cur[f] && !check(f, next)) delete out[f];
      return out;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!role || inFlight.current) return;
    setError(null);
    const found: Partial<Record<ProfileFieldKey, string>> = {};
    for (const f of order) {
      const message = check(f, values);
      if (message) found[f] = message;
    }
    setErrors(found);
    const first = order.find((f) => found[f]);
    if (first) {
      document.getElementById(PROFILE_IDS[first])?.focus();
      return;
    }
    inFlight.current = true;
    setBusy(true);
    try {
      const body = {
        role,
        name: name.trim(),
        regionCode,
        ...(role === 'farmer' && district.trim() ? { district: district.trim() } : {}),
        ...(role === 'buyer' && company.trim() ? { company: company.trim() } : {}),
        ...(role === 'driver' ? { vehicleClassCode } : {}),
      };
      const { account } = await api<{ account: AccountView }>('/api/account/register', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      await queryClient.invalidateQueries({ queryKey: ['account'] });
      navigate(HOME_FOR[account.role], { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('web.login.profileError', 'Could not save your details. Check your connection and try again.'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-busy={busy} className="flex flex-col gap-4">
      <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
        <legend className="smallcaps mb-2 p-0 text-[var(--ink-6)]">{t('web.login.iAm', 'I am a…')}</legend>
        {ROLE_CHOICES.map((c) => {
          const text = roleText(c.role);
          return (
            <RadioCard
              key={c.role}
              name="role"
              value={c.role}
              checked={role === c.role}
              onChange={() => {
                setRole(c.role);
                setErrors({});
              }}
              icon={<RoleIcon role={c.role} className="h-6 w-6 shrink-0 text-[var(--ink)]" />}
              title={text.label}
              detail={text.blurb}
            />
          );
        })}
      </fieldset>

      {role && (
        <>
          <FormField
            id={PROFILE_IDS.name}
            label={role === 'buyer' ? t('web.login.nameLabelBuyer', 'Your name (the contact person)') : t('web.login.nameLabel', 'Your name')}
            error={errors.name}
          >
            <input
              {...fieldAria(PROFILE_IDS.name, errors.name)}
              className={fieldCls}
              type="text"
              name="name"
              autoComplete="name"
              autoCapitalize="words"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                clearFixed({ ...values, name: e.target.value });
              }}
              onBlur={(e) => onBlurField('name', e.target.value)}
              required
            />
          </FormField>
          {role === 'buyer' && (
            <FormField id="profile-company" label={t('web.login.companyLabel', 'Business name')} optional={t('web.form.optional', 'Optional')}>
              <input
                id="profile-company"
                className={fieldCls}
                type="text"
                name="organization"
                autoComplete="organization"
                autoCapitalize="words"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              />
            </FormField>
          )}
          <FormField id={PROFILE_IDS.region} label={t('web.login.regionLabel', 'Region')} error={errors.region}>
            <select
              {...fieldAria(PROFILE_IDS.region, errors.region)}
              className={fieldCls}
              name="region"
              autoComplete="address-level1"
              value={regionCode}
              onChange={(e) => {
                setRegionCode(e.target.value);
                clearFixed({ ...values, regionCode: e.target.value });
              }}
              onBlur={(e) => onBlurField('region', e.target.value)}
              required
            >
              <option value="">{t('web.login.regionPlaceholder', 'Choose your region')}</option>
              {registries?.regions.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.name}
                </option>
              ))}
            </select>
          </FormField>
          {role === 'farmer' && (
            <FormField id="profile-district" label={t('web.login.districtLabel', 'District or community')} optional={t('web.form.optional', 'Optional')}>
              <input
                id="profile-district"
                className={fieldCls}
                type="text"
                name="district"
                autoComplete="address-level2"
                autoCapitalize="words"
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
              />
            </FormField>
          )}
          {role === 'driver' && (
            <FormField id={PROFILE_IDS.vehicle} label={t('web.login.vehicleLabel', 'Your vehicle')} error={errors.vehicle}>
              <select
                {...fieldAria(PROFILE_IDS.vehicle, errors.vehicle)}
                className={fieldCls}
                name="vehicle"
                value={vehicleClassCode}
                onChange={(e) => {
                  setVehicleClassCode(e.target.value);
                  clearFixed({ ...values, vehicleClassCode: e.target.value });
                }}
                onBlur={(e) => onBlurField('vehicle', e.target.value)}
                required
              >
                <option value="">{t('web.login.vehiclePlaceholder', 'Choose your vehicle')}</option>
                {registries?.vehicleClasses.map((v) => (
                  <option key={v.code} value={v.code}>
                    {t('web.login.vehicleOption', '{name} (up to {kg} kg)', {
                      name: v.name,
                      kg: v.capacityKg.toLocaleString('en-GH'),
                    })}
                  </option>
                ))}
              </select>
            </FormField>
          )}
          <ErrorLine message={error} />
          <button type="submit" className={`${btnCls} w-full py-2.5`} aria-disabled={busy || undefined} aria-busy={busy || undefined}>
            <BusyLabel busy={busy} label={t('web.login.continue', 'Continue')} busyLabel={t('web.login.saving', 'Saving…')} />
          </button>
        </>
      )}
      <button
        type="button"
        className="mt-2 inline-flex min-h-11 items-center justify-center self-center rounded-full px-3 text-center text-sm text-[var(--ink-6)] underline decoration-transparent underline-offset-[0.2em] transition-[color,text-decoration-color,background-color] hover:text-[var(--ink)] hover:decoration-current active:bg-[var(--paper-deep)]"
        disabled={leaving}
        aria-busy={leaving || undefined}
        onClick={() => {
          setLeaving(true);
          void signOut()
            .then(() => queryClient.invalidateQueries({ queryKey: ['account'] }))
            .finally(() => setLeaving(false));
        }}
      >
        <BusyLabel busy={leaving} label={t('web.login.notYou', 'Not your number? Sign out')} busyLabel={t('web.login.signingOut', 'Signing out…')} />
      </button>
    </form>
  );
}

export function LoginPage() {
  const { t } = useT();
  const { loading, signedIn, account, error } = useAccount();
  // The tab lives in the URL so the landing page can link straight to
  // "create an account" (/login?mode=signup).
  const [params, setParams] = useSearchParams();
  const mode: Mode = params.get('mode') === 'signup' ? 'signup' : 'signin';
  useEffect(() => {
    document.title = `${mode === 'signup' ? t('web.login.tabSignup', 'Create an account') : t('web.login.tabSignin', 'Sign in')} · Farm to Market`;
  }, [mode, t]);
  const setMode = (m: Mode) => setParams(m === 'signup' ? { mode: 'signup' } : {}, { replace: true });

  if (!supabaseConfigured) {
    return (
      <Frame title={t('web.login.titleSignin', 'Sign in')}>
        <ErrorLine message="Logins are not set up on this copy of F2M: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are missing from .env (see supabase/README.md)." />
      </Frame>
    );
  }
  if (loading) {
    return (
      <Frame title={t('web.login.titleSignin', 'Sign in')}>
        <p className="text-sm text-[var(--ink-6)]">{t('web.common.loading', 'Loading…')}</p>
      </Frame>
    );
  }
  if (account) return <Navigate to={HOME_FOR[account.role]} replace />;
  if (signedIn) {
    return (
      <Frame
        title={t('web.login.titleProfile', 'One more step')}
        note={t('web.login.noteProfile', 'Tell us who you are, and we will set up the right desk for you.')}
      >
        <ProfileForm />
      </Frame>
    );
  }
  return (
    <Frame
      title={mode === 'signin' ? t('web.login.titleSignin', 'Sign in') : t('web.login.titleSignup', 'Create your account')}
    >
      {error && <ErrorLine message={error.message} />}
      <CredentialsForm mode={mode} setMode={setMode} />
    </Frame>
  );
}
