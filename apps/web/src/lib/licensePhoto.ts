import * as mockAuth from './mockAuth';
import { isSupabaseConfigured, supabase } from './supabase';

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Uploads a driver's license photo and records it on the profile. Shared
 * between the signup flow (when a session exists immediately) and the
 * driver dashboard (when it doesn't yet — real Supabase with email
 * confirmation required defers this until after sign-in). Mock mode always
 * has a session at signup, so this only ever runs there once, from Auth.tsx.
 *
 * Real path: Storage upload keyed by the driver's own uid, matching the RLS
 * policy in supabase/migrations/0001_profiles.sql. Mock path: no bucket to
 * upload to, so the photo itself (as a data URL) is what gets stored —
 * small demo images only, by design.
 */
export async function uploadLicensePhoto(userId: string, file: File): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured()) {
    const dataUrl = await fileToDataUrl(file);
    mockAuth.setLicensePhoto(userId, dataUrl);
    return { error: null };
  }

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
