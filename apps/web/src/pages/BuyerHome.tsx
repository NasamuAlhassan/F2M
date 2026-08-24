import { useAuth, signOut } from '../hooks/useAuth';
import { btnGhostCls } from '../components/ui';

// Placeholder shell — proves role-routing works end to end. Replaced by the
// real buyer dashboard once tomorrow's design files land, not extended.
export function BuyerHomePage() {
  const { profile } = useAuth();
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Welcome, {profile?.full_name}</h1>
          <p className="text-sm text-[var(--ink-6)]">Buyer{profile?.company ? ` · ${profile.company}` : ''}</p>
        </div>
        <button className={btnGhostCls} onClick={() => signOut()}>
          Sign out
        </button>
      </div>
      <p className="text-sm text-[var(--ink-6)]">
        The marketplace and ordering flows still run on the existing buyer login (see /login) — this dashboard is a
        placeholder proving the new unified signup routes here correctly.
      </p>
    </div>
  );
}
