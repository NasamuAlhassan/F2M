import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { isSupabaseConfigured, type Profile, supabase } from '../lib/supabase';

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  /** True until the initial session check (and, if signed in, the profile
   *  fetch) resolves — the window where a guard must not decide anything yet. */
  loading: boolean;
  /** Set when Supabase isn't configured. A guard checking only `session`
   *  would just redirect to /auth, which is fine but silent about *why* —
   *  a consumer that wants to say "Supabase isn't set up yet" instead of a
   *  bare redirect can key off this. */
  configError: boolean;
}

/**
 * The Supabase identity: who's signed in, and their role/verification
 * status. Separate from apps/web/src/api.ts's role-keyed JWT hooks, which
 * still serve the pre-existing buyer/farmer/driver flows.
 *
 * Deliberately checks isSupabaseConfigured() before ever touching `supabase`
 * here: this hook runs inside a useEffect (RequireSupabaseAuth, the
 * dashboard shells), and a throw inside an effect is an uncaught error that
 * crashes the whole route via React Router's error boundary — not something
 * a try/catch in this file can turn into a graceful redirect after the fact.
 */
export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setConfigError(true);
      setLoading(false);
      return;
    }

    let alive = true;

    async function loadProfile(s: Session | null) {
      if (!s) {
        if (alive) setProfile(null);
        return;
      }
      const { data, error } = await supabase.from('profiles').select('*').eq('id', s.user.id).single();
      if (!alive) return;
      // A missing profile mid-signup (the auth.users trigger hasn't landed
      // yet) is a transient race, not a real error — leave profile null and
      // let the caller keep loading/redirect rather than surface a message
      // for something that resolves itself in under a second.
      setProfile(error ? null : (data as Profile));
    }

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (!alive) return;
      setSession(s);
      loadProfile(s).finally(() => {
        if (alive) setLoading(false);
      });
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      void loadProfile(s);
    });

    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, []);

  return { session, profile, loading, configError };
}

export async function signOut(): Promise<void> {
  if (isSupabaseConfigured()) await supabase.auth.signOut();
}
