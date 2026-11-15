import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { settings } from '../db/schema';

/** A remembered value, or null (docs/HOSTING.md: nothing in memory outlives a serverless call). */
export async function getSetting(key: string): Promise<string | null> {
  return (await db.select().from(settings).where(eq(settings.key, key)))[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const now = Date.now();
  await db
    .insert(settings)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } });
}

export async function deleteSetting(key: string): Promise<void> {
  await db.delete(settings).where(eq(settings.key, key));
}
