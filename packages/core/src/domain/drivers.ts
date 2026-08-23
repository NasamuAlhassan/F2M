import bcrypt from 'bcryptjs';
import { asc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { drivers, vehicleClasses, type Driver, type VehicleClass } from '../db/schema';
import { DomainError, notFound } from './errors';
import { getFarmerByPhone, normalizePhone, toMsisdn } from './farmers';
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
  const driver = getDriverByPhone(rawPhone);
  if (!driver || !driver.active || !bcrypt.compareSync(pin, driver.pinHash)) {
    throw new DomainError('Invalid phone or PIN', 'INVALID_CREDENTIALS', 401);
  }
  return driver;
}
