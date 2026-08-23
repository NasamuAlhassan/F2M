import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { farmers, type Farmer } from '../db/schema';
import { DomainError } from './errors';
import { getRegion } from './registries';

/**
 * Normalize a Ghanaian phone number to E.164 (+233...).
 * Accepts: 0244123456, 233244123456, +233244123456.
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '');
  if (/^\+233\d{9}$/.test(digits)) return digits;
  if (/^233\d{9}$/.test(digits)) return `+${digits}`;
  if (/^0\d{9}$/.test(digits)) return `+233${digits.slice(1)}`;
  throw new DomainError(`Not a valid Ghanaian phone number: ${raw}`, 'INVALID_PHONE');
}

/** MSISDN form (no plus) used by mobile-money APIs. */
export function toMsisdn(phone: string): string {
  return normalizePhone(phone).slice(1);
}

export interface RegisterFarmerInput {
  phone: string;
  name: string;
  regionCode: string;
  district?: string;
  gpsLat?: number;
  gpsLng?: number;
  locale?: string;
}

export function registerFarmer(input: RegisterFarmerInput): Farmer {
  const phone = normalizePhone(input.phone);
  getRegion(input.regionCode); // throws on unknown region
  if (!input.name.trim()) throw new DomainError('Name is required', 'INVALID_NAME');
  const existing = getFarmerByPhone(phone);
  if (existing) throw new DomainError('This phone number is already registered', 'FARMER_EXISTS', 409);
  return db
    .insert(farmers)
    .values({
      phone,
      name: input.name.trim(),
      regionCode: input.regionCode,
      district: input.district?.trim() || null,
      gpsLat: input.gpsLat ?? null,
      gpsLng: input.gpsLng ?? null,
      momoMsisdn: toMsisdn(phone),
      locale: input.locale ?? 'en',
    })
    .returning()
    .get();
}

export function getFarmerByPhone(rawPhone: string): Farmer | undefined {
  let phone: string;
  try {
    phone = normalizePhone(rawPhone);
  } catch {
    return undefined;
  }
  return db.select().from(farmers).where(eq(farmers.phone, phone)).get();
}

export function getFarmerById(id: string): Farmer | undefined {
  return db.select().from(farmers).where(eq(farmers.id, id)).get();
}
