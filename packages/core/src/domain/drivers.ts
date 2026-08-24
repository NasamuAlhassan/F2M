import bcrypt from 'bcryptjs';
import { asc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { drivers, vehicleClasses, type Driver, type VehicleClass } from '../db/schema';
import { DomainError, notFound } from './errors';
import { assertLocale, getFarmerByPhone, normalizePhone, toMsisdn } from './farmers';
import { getRegion } from './registries';

export function listVehicleClasses(): VehicleClass[] {
  return db.select().from(vehicleClasses).orderBy(asc(vehicleClasses.sortOrder)).all();
}

export function getVehicleClass(code: string): VehicleClass {
  const vc = db.select().from(vehicleClasses).where(eq(vehicleClasses.code, code)).get();
  if (!vc) throw notFound(`vehicle class ${code}`);
  return vc;
}

export interface RegisterDriverInput {
  phone: string;
  name: string;
  regionCode: string;
  vehicleClassCode: string;
  pin: string; // 4 digits, set during USSD registration (D-021)
  gpsLat?: number;
  gpsLng?: number;
  locale?: string;
}

export function registerDriver(input: RegisterDriverInput): Driver {
  const phone = normalizePhone(input.phone);
  getRegion(input.regionCode);
  getVehicleClass(input.vehicleClassCode);
  if (!input.name.trim()) throw new DomainError('Name is required', 'INVALID_NAME');
  if (!/^\d{4}$/.test(input.pin)) throw new DomainError('PIN must be 4 digits', 'INVALID_PIN');
  if (input.locale !== undefined) assertLocale(input.locale);
  if (getDriverByPhone(phone)) {
    throw new DomainError('This phone number is already registered as a driver', 'DRIVER_EXISTS', 409);
  }
  // One role per phone in v1 — a farmer phone cannot double as a driver phone.
  if (getFarmerByPhone(phone)) {
    throw new DomainError('This phone number is already registered as a farmer', 'ROLE_TAKEN', 409);
  }
  return db
    .insert(drivers)
    .values({
      phone,
      name: input.name.trim(),
      regionCode: input.regionCode,
      vehicleClassCode: input.vehicleClassCode,
      pinHash: bcrypt.hashSync(input.pin, 8),
      momoMsisdn: toMsisdn(phone),
      gpsLat: input.gpsLat ?? null,
      gpsLng: input.gpsLng ?? null,
      locale: input.locale ?? 'en',
    })
    .returning()
    .get();
}

export function getDriverByPhone(rawPhone: string): Driver | undefined {
  let phone: string;
  try {
    phone = normalizePhone(rawPhone);
  } catch {
    return undefined;
  }
  return db.select().from(drivers).where(eq(drivers.phone, phone)).get();
}

export function getDriverById(id: string): Driver | undefined {
  return db.select().from(drivers).where(eq(drivers.id, id)).get();
}

export function verifyDriverLogin(rawPhone: string, pin: string): Driver {
  // `active` is the availability toggle, NOT an account lock — an offline
  // driver can still log in (e.g. to flip themselves back online).
  const driver = getDriverByPhone(rawPhone);
  if (!driver || !bcrypt.compareSync(pin, driver.pinHash)) {
    throw new DomainError('Invalid phone or PIN', 'INVALID_CREDENTIALS', 401);
  }
  return driver;
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

export function updateDriverProfile(driverId: string, input: UpdateDriverProfileInput): Driver {
  const driver = getDriverById(driverId);
  if (!driver) throw notFound('driver');
  const updates: Partial<typeof drivers.$inferInsert> = {};
  if (input.vehicleClassCode !== undefined) {
    getVehicleClass(input.vehicleClassCode); // throws on unknown
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
  return db.update(drivers).set(updates).where(eq(drivers.id, driverId)).returning().get()!;
}
