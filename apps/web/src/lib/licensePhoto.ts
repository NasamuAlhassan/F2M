import { supabase } from './supabase';

/**
 * Uploads a driver's license photo and records its path on the profile.
 * Shared between the signup flow (when a session exists immediately —
 * email confirmation off) and the driver dashboard (when it doesn't yet —
 * confirmation required, so this runs after the person confirms and signs
 * in instead). Path is keyed by the driver's own uid, matching the RLS
 * policy in supabase/migrations/0001_profiles.sql.
 */
export async function uploadLicensePhoto(userId: string, file: File): Promise<{ error: string | null }> {
  const ext = file.name.split('.').pop() ?? 'jpg';
  const path = `${userId}/license.${ext}`;

  const { error: uploadError } = await supabase.storage.from('driver-licenses').upload(path, file, {
    upsert: true,
    contentType: file.type,
  });
  if (uploadError) return { error: uploadError.message };

  const { error: updateError } = await supabase.from('profiles').update({ license_photo_path: path }).eq('id', userId);
  if (updateError) return { error: updateError.message };

  return { error: null };
}
