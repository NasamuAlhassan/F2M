import { useState } from 'react';
import { useAuth, signOut } from '../hooks/useAuth';
import { uploadLicensePhoto } from '../lib/licensePhoto';
import { btnCls, btnGhostCls, inputCls } from '../components/ui';

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending review',
  verified: 'Verified',
  rejected: 'Rejected — contact support',
};

// Placeholder shell — proves role-routing works end to end. Replaced by the
// real driver dashboard once tomorrow's design files land, not extended.
export function DriverHomePage() {
  const { profile } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState(false);

  async function upload() {
    if (!profile || !file) return;
    setBusy(true);
    setError(null);
    const { error: err } = await uploadLicensePhoto(profile.id, file);
    setBusy(false);
    if (err) setError(err);
    else setUploaded(true);
  }

  const hasPhoto = uploaded || Boolean(profile?.license_photo_path);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Welcome, {profile?.full_name}</h1>
          <p className="text-sm text-[var(--ink-6)]">Driver</p>
        </div>
        <button className={btnGhostCls} onClick={() => signOut()}>
          Sign out
        </button>
      </div>

      <div className="mb-6 rounded-xl border border-[var(--ink-2)] p-4">
        <p className="text-sm font-semibold">
          Verification: {STATUS_LABEL[profile?.verification_status ?? 'pending'] ?? 'Pending review'}
        </p>
        <p className="mt-1 text-xs text-[var(--ink-6)]">
          A real driver's license check hasn't been built yet — this status is set by hand until it has. You can't
          accept deliveries until it reads "Verified."
        </p>
      </div>

      {!hasPhoto && (
        // Covers the case where signup couldn't upload the license photo yet
        // (email confirmation was required, so there was no session at
        // signup time) — the photo isn't lost, it's just added here instead.
        <div className="rounded-xl border border-[var(--ink-2)] p-4">
          <p className="mb-2 text-sm font-semibold">Add your license photo</p>
          <input type="file" accept="image/*" className={`${inputCls} mb-3`} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {error && <p className="mb-2 text-sm text-[var(--stamp)]">{error}</p>}
          <button className={btnCls} disabled={busy || !file} onClick={upload}>
            {busy ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      )}
      {hasPhoto && <p className="text-sm text-[var(--ink-6)]">License photo on file.</p>}

      <p className="mt-6 text-sm text-[var(--ink-6)]">
        Dispatch and delivery jobs still run on the existing driver login (see /driver/login) — this dashboard is a
        placeholder proving the new unified signup routes here correctly.
      </p>
    </div>
  );
}
