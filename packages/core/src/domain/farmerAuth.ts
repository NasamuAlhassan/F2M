import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { loginOtps, type Farmer } from '../db/schema';
import { DomainError } from './errors';
import { getFarmerByPhone, normalizePhone } from './farmers';
import { queueSms } from './notifications';

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

/**
 * Farmer web login (D-032): phone + one-time code over the SMS outbox — the
 * same channel every other farmer message rides. Offline the code shows up in
 * the dev SMS inbox; with real AT keys it is a real text. No password to
 * remember, no change to the USSD registration flow.
 */
export function requestFarmerLoginCode(rawPhone: string): { phone: string } {
  const phone = normalizePhone(rawPhone);
  const farmer = getFarmerByPhone(phone);
  if (!farmer) {
    // v1 accepts the enumeration tradeoff: a helpful error beats a silent no-op
    // for farmers who mistype or haven't registered yet.
    throw new DomainError('No farmer is registered with this phone — register by USSD first', 'FARMER_NOT_FOUND', 404);
  }
  const code = crypto.randomInt(100000, 1000000).toString();
  db.delete(loginOtps).where(eq(loginOtps.phone, phone)).run();
  db.insert(loginOtps)
    .values({ phone, codeHash: bcrypt.hashSync(code, 8), expiresAt: Date.now() + OTP_TTL_MS })
    .run();
  queueSms({ phone, locale: farmer.locale, templateKey: 'sms.loginCode', params: { code } });
  return { phone };
}

export function verifyFarmerLoginCode(rawPhone: string, code: string): Farmer {
  const phone = normalizePhone(rawPhone);
  const row = db.select().from(loginOtps).where(eq(loginOtps.phone, phone)).get();
  const invalid = new DomainError('Invalid or expired code', 'INVALID_CODE', 401);
  if (!row || row.expiresAt < Date.now() || row.attempts >= MAX_ATTEMPTS) throw invalid;
  if (!bcrypt.compareSync(code, row.codeHash)) {
    db.update(loginOtps)
      .set({ attempts: row.attempts + 1 })
      .where(eq(loginOtps.id, row.id))
      .run();
    throw invalid;
  }
  db.delete(loginOtps).where(eq(loginOtps.id, row.id)).run();
  const farmer = getFarmerByPhone(phone);
  if (!farmer) throw invalid;
  return farmer;
}
