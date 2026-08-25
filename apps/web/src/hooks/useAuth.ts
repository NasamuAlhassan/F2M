import { useEffect, useState } from 'react';
import * as mockAuth from '../lib/mockAuth';
import { isSupabaseConfigured, type AppRole, type Profile, supabase } from '../lib/supabase';

/** The minimal session shape every consumer in this app actually needs —
 *  just enough to say "signed in, and here's the id." Real Supabase's
 *  Session type is far richer; nothing here reads past .user.id, so both
 *  backends can satisfy this one small interface instead of the UI needing
 *  to know which backend produced it. */
export interface AuthSession {
  user: { id: string };
}

interface AuthState {
  session: AuthSession | null;
  profile: Profile | null;
  /** True until the initial session check (and, if signed in, the profile
   *  fetch) resolves — the window where a guard must not decide anything yet. */
  loading: boolean;
}

/**
 * The unified-signup identity — separate from apps/web/src/api.ts's
 * role-keyed JWT hooks, which still serve the pre-existing buyer/farmer/
 * driver flows. Backed by real Supabase when configured, otherwise the
 * mock in ../lib/mockAuth — the same mock-first shape as every other
 * provider seam in this app, so this hook itself never needs to know or
 * care which one is live; it just asks isSupabaseConfigured() once.
 */
export function useAuth(): AuthState {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      const load = () => {
        const s = mockAuth.getSession();
        setSession(s);
        setProfile(s ? mockAuth.getProfile(s.user.id) : null);
        setLoading(false);
      };
      load();
      return mockAuth.subscribe(load);
    }

    let alive = true;

    async function loadProfile(userId: string | null) {
      if (!userId) {
        if (alive) setProfile(null);
        return;
      }
      const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
      if (!alive) return;
      // A missing profile mid-signup (the auth.users trigger hasn't landed
      // yet) is a transient race, not a real error — leave profile null and
      // let the caller keep loading/redirect rather than surface a message
      // for something that resolves itself in under a second.
      setProfile(error ? null : (data as Profile));
    }

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (!alive) return;
      const mapped = s ? { user: { id: s.user.id } } : null;
      setSession(mapped);
      loadProfile(mapped?.user.id ?? null).finally(() => {
        if (alive) setLoading(false);
      });
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      const mapped = s ? { user: { id: s.user.id } } : null;
      setSession(mapped);
      void loadProfile(mapped?.user.id ?? null);
    });

    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, []);

  return { session, profile, loading };
}

export interface SignUpFields {
  email: string;
  password: string;
  role: AppRole;
  fullName: string;
  phone: string | null;
  company: string | null;
  vehicleClass: string | null;
  licenseNumber: string | null;
}

/** Returns the new user's id, and whether a session came back immediately.
 *  Real Supabase can come back with no session (email confirmation
 *  required) — mock mode never does, signup is always instant there. */
export async function signUp(fields: SignUpFields): Promise<{ userId: string; hasSession: boolean }> {
  if (!isSupabaseConfigured()) {
    const { userId } = mockAuth.signUp(fields);
    return { userId, hasSession: true };
  }

  const { data, error } = await supabase.auth.signUp({
    email: fields.email,
    password: fields.password,
    options: {
      data: {
        role: fields.role,
        full_name: fields.fullName,
        phone: fields.phone,
        company: fields.company,
        vehicle_class: fields.vehicleClass,
        license_number: fields.licenseNumber,
      },
    },
  });
  if (error) throw error;
  if (!data.user) throw new Error('Sign up did not return a user — try again.');
  return { userId: data.user.id, hasSession: Boolean(data.session) };
}

export async function signInWithPassword(email: string, password: string): Promise<{ role: AppRole | null }> {
  if (!isSupabaseConfigured()) {
    const { role } = mockAuth.signInWithPassword(email, password);
    return { role };
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', data.user.id).single();
  return { role: (profile?.role as AppRole) ?? null };
}

export async function signOut(): Promise<void> {
  if (!isSupabaseConfigured()) {
    mockAuth.signOut();
    return;
  }
  await supabase.auth.signOut();
}
