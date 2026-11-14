import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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

export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      'Logins are not set up: add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env at the repo root (see supabase/README.md).',
    );
  }
  return supabase;
}
