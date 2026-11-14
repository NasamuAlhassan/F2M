import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { Role } from '../api';
import { requireSupabase, supabase } from './supabase';

/**
 * The signed-in person (D-047). Supabase holds the login (phone + password);
 * F2M's server holds the profile. `account` is null while signed in but not
 * yet registered — the login screen then asks for the profile.
 */
export interface AccountView {
  role: Role;
  id: string;
  phone: string;
  name: string;
  regionCode: string | null;
  company: string | null;
  vehicleClassCode: string | null;
}

export const HOME_FOR: Record<Role, string> = {
  buyer: '/market',
  farmer: '/farmer/dashboard',
  driver: '/driver/jobs',
};

/** Ghana numbers as people write them (024…, 233…, +233…) → the E.164 form Supabase stores. */
export function toE164(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '');
  if (/^\+233\d{9}$/.test(digits)) return digits;
  if (/^233\d{9}$/.test(digits)) return `+${digits}`;
  if (/^0\d{9}$/.test(digits)) return `+233${digits.slice(1)}`;
  throw new Error('Enter a Ghana phone number, like 024 123 4567');
}

export async function accessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function fetchAccount(): Promise<{ signedIn: boolean; account: AccountView | null }> {
  const token = await accessToken();
  if (!token) return { signedIn: false, account: null };
  const res = await fetch('/api/account/me', { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) return { signedIn: false, account: null };
  if (!res.ok) throw new Error(`Could not load your account (${res.status})`);
  const body = (await res.json()) as { account: AccountView | null };
  return { signedIn: true, account: body.account };
}

/** The current session + profile, kept in step with Supabase's sign-in/sign-out events. */
export function useAccount() {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange(() => {
      void queryClient.invalidateQueries({ queryKey: ['account'] });
    });
    return () => data.subscription.unsubscribe();
  }, [queryClient]);

  const query = useQuery({ queryKey: ['account'], queryFn: fetchAccount, staleTime: 5 * 60 * 1000, retry: false });
  return {
    loading: query.isPending,
    error: query.error,
    signedIn: query.data?.signedIn ?? false,
    account: query.data?.account ?? null,
  };
}

/** Supabase's own messages, said the way a farmer or buyer would understand them. */
function friendly(message: string): string {
  if (/invalid login credentials/i.test(message)) return 'That phone number and password do not match.';
  if (/already registered|already exists/i.test(message)) return 'This phone number already has an account — sign in instead.';
  if (/phone signups are disabled/i.test(message)) return 'Phone sign-up is switched off in Supabase (see supabase/README.md).';
  if (/password should be at least/i.test(message)) return 'Use a password of at least 6 characters.';
  return message;
}

export async function signIn(phone: string, password: string): Promise<void> {
  const { error } = await requireSupabase().auth.signInWithPassword({ phone: toE164(phone), password });
  if (error) throw new Error(friendly(error.message));
}

export async function signUp(phone: string, password: string): Promise<void> {
  const { data, error } = await requireSupabase().auth.signUp({ phone: toE164(phone), password });
  if (error) throw new Error(friendly(error.message));
  if (!data.session) {
    // Supabase is waiting for an SMS code — phone confirmation is still on.
    throw new Error('Supabase is asking for an SMS code. Turn "Confirm phone" off for now (see supabase/README.md).');
  }
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut();
}
