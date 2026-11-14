import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { buyers, type Buyer } from '../db/schema';
import { DomainError } from './errors';
import { normalizePhone, toMsisdn } from './farmers';
import { getRegion } from './registries';

export interface RegisterBuyerInput {
  phone: string;
  name: string;
  company?: string;
  regionCode: string;
}

/** A buyer signing up on the web (D-047). Payouts and refunds go to the same number's mobile money. */
export function registerBuyer(input: RegisterBuyerInput): Buyer {
  const phone = normalizePhone(input.phone);
  getRegion(input.regionCode); // throws on unknown region
  if (!input.name.trim()) throw new DomainError('Name is required', 'INVALID_NAME');
  if (getBuyerByPhone(phone)) throw new DomainError('This phone number is already registered as a buyer', 'BUYER_EXISTS', 409);
  return db
    .insert(buyers)
    .values({
      phone,
      name: input.name.trim(),
      company: input.company?.trim() || null,
      regionCode: input.regionCode,
      momoMsisdn: toMsisdn(phone),
    })
    .returning()
    .get();
}

export function getBuyerById(id: string): Buyer | undefined {
  return db.select().from(buyers).where(eq(buyers.id, id)).get();
}

export function getBuyerByPhone(rawPhone: string): Buyer | undefined {
  let phone: string;
  try {
    phone = normalizePhone(rawPhone);
  } catch {
    return undefined;
  }
  return db.select().from(buyers).where(eq(buyers.phone, phone)).get();
}
