import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { buyers, type Buyer } from '../db/schema';
import { DomainError } from './errors';

export function verifyBuyerLogin(email: string, password: string): Buyer {
  const buyer = db.select().from(buyers).where(eq(buyers.email, email.toLowerCase().trim())).get();
  if (!buyer || !bcrypt.compareSync(password, buyer.passwordHash)) {
    throw new DomainError('Invalid email or password', 'INVALID_CREDENTIALS', 401);
  }
  return buyer;
}

export function getBuyerById(id: string): Buyer | undefined {
  return db.select().from(buyers).where(eq(buyers.id, id)).get();
}
