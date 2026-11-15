import bcrypt from 'bcryptjs';
import { asc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { drivers, vehicleClasses, type Driver, type VehicleClass } from '../db/schema';
import { DomainError, notFound } from './errors';
import { assertLocale, getFarmerByPhone, normalizePhone, toMsisdn } from './farmers';
import { getRegion } from './registries';

export async function listVehicleClasses(): Promise<VehicleClass[]> {
  return (await db.select().from(vehicleClasses).orderBy(asc(vehicleClasses.sortOrder)));
}

export async function getVehicleClass(code: string): Promise<VehicleClass> {
  const vc = (await db.select().from(vehicleClasses).where(eq(vehicleClasses.code, code)))[0];
  if (!vc) throw notFound(`vehicle class ${code}`);
  return vc;
}

export interface RegisterDriverInput {
  phone: string;
  name: string;
  regionCode: string;
  vehicleClassCode: string;
  pin?: string; // 4 digits, set during USSD registration (D-021); web signups have none (D-047)
  gpsLat?: number;
  gpsLng?: number;
  locale?: string;
}

export async function registerDriver(input: RegisterDriverInput): Promise<Driver> {
  const phone = normalizePhone(input.phone);
  getRegion(input.regionCode);
  await getVehicleClass(input.vehicleClassCode);
  if (!input.name.trim()) throw new DomainError('Name is required', 'INVALID_NAME');
  if (input.pin !== undefined && !/^\d{4}$/.test(input.pin)) throw new DomainError('PIN must be 4 digits', 'INVALID_PIN');
  if (input.locale !== undefined) assertLocale(input.locale);
  if (await getDriverByPhone(phone)) {
    throw new DomainError('This phone number is already registered as a driver', 'DRIVER_EXISTS', 409);
  }
  // One role per phone in v1 — a farmer phone cannot double as a driver phone.
  if (await getFarmerByPhone(phone)) {
    throw new DomainError('This phone number is already registered as a farmer', 'ROLE_TAKEN', 409);
  }
  return (await db
        .insert(drivers)
        .values({
          phone,
          name: input.name.trim(),
          regionCode: input.regionCode,
          vehicleClassCode: input.vehicleClassCode,
          pinHash: input.pin !== undefined ? bcrypt.hashSync(input.pin, 8) : null,
          momoMsisdn: toMsisdn(phone),
          gpsLat: input.gpsLat ?? null,
          gpsLng: input.gpsLng ?? null,
          locale: input.locale ?? 'en',
        })
        .returning())[0]!;
}

export async function getDriverByPhone(rawPhone: string): Promise<Driver | undefined> {
  let phone: string;
  try {
    phone = normalizePhone(rawPhone);
  } catch {
    return undefined;
  }
  return (await db.select().from(drivers).where(eq(drivers.phone, phone)))[0];
}

export async function getDriverById(id: string): Promise<Driver | undefined> {
  return (await db.select().from(drivers).where(eq(drivers.id, id)))[0];
}

export function driverRouteRegions(driver: Driver): string[] {
  try {
    const parsed = JSON.parse(driver.routeRegions) as unknown;
    return Array.isArray(parsed) ? parsed.filter((r): r is string => typeof r === 'string') : [];
  } catch {
    return [];
  }
}

export interface UpdateDriverProfileInput {
  vehicleClassCode?: string;
  active?: boolean; // online/offline
  routeRegions?: string[]; // region codes; empty array = serve anywhere
  locale?: string; // SMS + call language (D-040)
}

export async function updateDriverProfile(driverId: string, input: UpdateDriverProfileInput): Promise<Driver> {
  const driver = await getDriverById(driverId);
  if (!driver) throw notFound('driver');
  const updates: Partial<typeof drivers.$inferInsert> = {};
  if (input.vehicleClassCode !== undefined) {
    await getVehicleClass(input.vehicleClassCode); // throws on unknown
    updates.vehicleClassCode = input.vehicleClassCode;
  }
  if (input.active !== undefined) updates.active = input.active;
  if (input.routeRegions !== undefined) {
    for (const code of input.routeRegions) getRegion(code); // throws on unknown
    updates.routeRegions = JSON.stringify([...new Set(input.routeRegions)]);
  }
  if (input.locale !== undefined) {
    assertLocale(input.locale);
    updates.locale = input.locale;
  }
  if (Object.keys(updates).length === 0) return driver;
  return (await db.update(drivers).set(updates).where(eq(drivers.id, driverId)).returning())[0]!;
}
