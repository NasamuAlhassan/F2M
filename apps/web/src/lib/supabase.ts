import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The Supabase client — web logins only (D-047): phone + password. Everything
 * else about a person lives in F2M's own server, reached through api.ts with
 * this client's access token.
 *
 * Built only when the two keys are present, so a checkout without them still
 * loads every public page (QR trace, prices); the login screen says plainly
 * what is missing instead of the whole app failing at import.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Whether logins are set up on this copy (checked without loading the library). */
export const supabaseConfigured = Boolean(url && key);

/**
 * The library is fetched on first use, not with the app: the landing page, the
 * QR trace and the phone simulator never sign anyone in, and on a costly data
 * plan they should not pay for the code that does.
 */
let client: Promise<SupabaseClient | null> | null = null;
const authListeners = new Set<() => void>();

export function getSupabase(): Promise<SupabaseClient | null> {
  client ??=
    url && key
      ? import('@supabase/supabase-js').then(({ createClient }) => {
          const c = createClient(url, key);
          c.auth.onAuthStateChange(() => authListeners.forEach((l) => l()));
          return c;
        })
      : Promise.resolve(null);
  return client;
}

/** Called on every sign-in, sign-out and token refresh, once the client exists. */
export function onAuthChange(listener: () => void): () => void {
  authListeners.add(listener);
  return () => {
    authListeners.delete(listener);
  };
}

/** True when this browser holds a saved login, read straight from storage. */
export function hasStoredSession(): boolean {
  if (!url) return false;
  try {
    return localStorage.getItem(`sb-${new URL(url).hostname.split('.')[0]}-auth-token`) !== null;
  } catch {
    return false;
  }
}

export async function requireSupabase(): Promise<SupabaseClient> {
  const c = await getSupabase();
  if (!c) {
    throw new Error(
      'Logins are not set up: add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env at the repo root (see supabase/README.md).',
    );
  }
  return c;
}
