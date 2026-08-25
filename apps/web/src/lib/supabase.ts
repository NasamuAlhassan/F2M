import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The unified auth identity — separate from apps/web/src/api.ts's
 * role-keyed JWT system, which still serves the existing buyer/farmer/
 * driver flows. See supabase/README.md for why these are two systems
 * right now, and what reconciles them.
 *
 * Fails loudly on first USE, not on import: the rest of the app (the
 * existing buyer/farmer/driver flows) has nothing to do with Supabase and
 * must keep working even with no keys configured. main.tsx wires
 * RequireSupabaseAuth in directly rather than behind a lazy route, so this
 * module's import graph reaches the app's eager entry bundle — throwing at
 * module-eval time there took the whole app down, not just the new /auth
 * routes. A Proxy defers the check to the first property access instead.
 */

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// An explicit pause switch, same shape as GRADING_PROVIDER=mock|hf and
// every other provider flip in this app — deliberate choice, not implicit
// "no key means try anyway and fail" detection. Lets real keys stay in
// .env untouched while auth runs on the mock backend, so "we'll finish the
// Supabase/Vercel/Render setup later" doesn't mean deleting config you
// already entered.
const forceMock = import.meta.env.VITE_FORCE_MOCK_AUTH === 'true';

function missingKeysError(): Error {
  return new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env at the repo root ' +
      'and fill in your Supabase project\'s URL and anon key — see supabase/README.md.',
  );
}

let client: SupabaseClient | null = null;
if (!forceMock && url && anonKey) client = createClient(url, anonKey);

export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    if (!client) throw missingKeysError();
    return client[prop as keyof SupabaseClient];
  },
});

/** Check before touching `supabase` when "not configured" should be handled
 *  gracefully (useAuth's effect) rather than thrown — a throw inside a
 *  useEffect is an uncaught route-level crash, not a catchable error. */
export const isSupabaseConfigured = (): boolean => client !== null;

export type AppRole = 'buyer' | 'seller' | 'driver';
export type VerificationStatus = 'pending' | 'verified' | 'rejected';

export interface Profile {
  id: string;
  role: AppRole;
  full_name: string;
  phone: string | null;
  company: string | null;
  vehicle_class: string | null;
  license_number: string | null;
  license_photo_path: string | null;
  verification_status: VerificationStatus | null;
  created_at: string;
}
