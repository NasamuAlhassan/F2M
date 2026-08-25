import type { AppRole, Profile } from './supabase';

/**
 * The mock auth backend — used automatically whenever Supabase isn't
 * configured (see isSupabaseConfigured() in ./supabase). Same principle as
 * every other provider seam in this app (GRADING_PROVIDER, PAYMENT_PROVIDER,
 * NOTIFY_PROVIDER: mock by default, D-013) — the new unified signup
 * shouldn't be the one thing here that can't be demoed without an external
 * account. No email confirmation step exists in mock mode at all: signup is
 * instant, matching how every other mock in this codebase skips the real
 * provider's friction, not just its cost.
 *
 * Accounts persist in localStorage (one shared "database" across tabs, so a
 * seller signed up in one tab is a real account a driver-tab could look up
 * later). The ACTIVE session is sessionStorage instead — per tab, on
 * purpose: it's what lets you open three tabs and be signed in as buyer,
 * seller, and driver simultaneously, the same multi-role demo pattern the
 * rest of this app already uses (apps/web/src/api.ts's role-keyed tokens),
 * rather than the one-identity-per-browser model real Supabase auth defaults
 * to. Everything here is scoped to this browser only — nothing to deploy,
 * nothing to reconcile with the real backend later; the real Supabase path
 * this shadows is untouched.
 */

const ACCOUNTS_KEY = 'ftm_mock_auth_accounts';
const SESSION_KEY = 'ftm_mock_auth_session';

interface MockAccount {
  password: string;
  profile: Profile;
}

function readAccounts(): Record<string, MockAccount> {
  try {
    return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) ?? '{}') as Record<string, MockAccount>;
  } catch {
    return {};
  }
}

function writeAccounts(accounts: Record<string, MockAccount>): void {
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch {
    // Private browsing / storage disabled: the demo just won't persist
    // across a reload, which is a fine degradation for a local-only mock.
  }
}

function readSessionEmail(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

type Listener = () => void;
const listeners = new Set<Listener>();
function notify(): void {
  listeners.forEach((l) => l());
}

/** useAuth subscribes here to re-render when this tab's mock session changes. */
export function subscribe(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function writeSessionEmail(email: string | null): void {
  try {
    if (email) sessionStorage.setItem(SESSION_KEY, email);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Same graceful degradation as writeAccounts.
  }
  notify();
}

export interface MockSignUpFields {
  email: string;
  password: string;
  role: AppRole;
  fullName: string;
  phone: string | null;
  company: string | null;
  vehicleClass: string | null;
  licenseNumber: string | null;
}

export function signUp(fields: MockSignUpFields): { userId: string } {
  const accounts = readAccounts();
  if (accounts[fields.email]) {
    throw new Error('An account with this email already exists (demo mode — try signing in instead).');
  }
  const userId = `mock-${crypto.randomUUID()}`;
  const profile: Profile = {
    id: userId,
    role: fields.role,
    full_name: fields.fullName,
    phone: fields.phone,
    company: fields.company,
    vehicle_class: fields.vehicleClass,
    license_number: fields.licenseNumber,
    license_photo_path: null,
    verification_status: fields.role === 'driver' ? 'pending' : null,
    created_at: new Date().toISOString(),
  };
  accounts[fields.email] = { password: fields.password, profile };
  writeAccounts(accounts);
  writeSessionEmail(fields.email);
  return { userId };
}

export function signInWithPassword(email: string, password: string): { userId: string; role: AppRole } {
  const account = readAccounts()[email];
  if (!account || account.password !== password) {
    throw new Error('Invalid email or password (demo mode — accounts live in this browser and reset if you clear its storage).');
  }
  writeSessionEmail(email);
  return { userId: account.profile.id, role: account.profile.role };
}

export function signOut(): void {
  writeSessionEmail(null);
}

export function getSession(): { user: { id: string } } | null {
  const email = readSessionEmail();
  if (!email) return null;
  const account = readAccounts()[email];
  return account ? { user: { id: account.profile.id } } : null;
}

export function getProfile(userId: string): Profile | null {
  const match = Object.values(readAccounts()).find((a) => a.profile.id === userId);
  return match?.profile ?? null;
}

/** dataUrl instead of a File/path: mock storage has no bucket to upload to,
 *  so the photo itself (base64) is what gets persisted — small demo images
 *  only, by design, never meant to hold a real production upload. */
export function setLicensePhoto(userId: string, dataUrl: string): void {
  const accounts = readAccounts();
  const entry = Object.entries(accounts).find(([, a]) => a.profile.id === userId);
  if (!entry) return;
  const [email, account] = entry;
  account.profile.license_photo_path = dataUrl;
  accounts[email] = account;
  writeAccounts(accounts);
  notify();
}
