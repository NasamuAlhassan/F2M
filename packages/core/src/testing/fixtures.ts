/**
 * Test-only helpers (imported as `@ftm/core/testing`). Never imported by app
 * code. Tests cannot sign in to the real Supabase project, so they use a
 * stand-in token verifier and create the accounts they need directly.
 */
import { eq } from 'drizzle-orm';
import type { TokenVerifier } from '../auth/tokens';
import { db } from '../db/client';
import { accounts, type Account, type Buyer, type Contract, type Offer } from '../db/schema';
import { listOffersForFarmer } from '../domain/offers';
import { acceptOfferThread } from '../domain/paymentFlow';
import { getBuyerByPhone, registerBuyer } from '../domain/buyers';
import { normalizePhone } from '../domain/farmers';

/** The buyer most suites trade with — the same details the old seeded demo buyer had. */
export const TEST_BUYER = {
  phone: '+233555000123',
  name: 'Adjoa Mensah',
  company: 'Accra Fresh Markets Ltd',
  regionCode: 'GREATER_ACCRA',
} as const;

export function testBuyer(): Buyer {
  return getBuyerByPhone(TEST_BUYER.phone) ?? registerBuyer({ ...TEST_BUYER });
}

/** Accepts `test:<authUserId>:<phone digits>` and nothing else. */
export const testTokenVerifier: TokenVerifier = async (token) => {
  const [scheme, authUserId, phone] = token.split(':');
  if (scheme !== 'test' || !authUserId) throw new Error('not a test token');
  return { authUserId, phone: phone || null };
};

/** A bearer token for a login that has not registered an F2M profile yet. */
export function testLoginToken(authUserId: string, phone: string): string {
  return `test:${authUserId}:${normalizePhone(phone).slice(1)}`;
}

/**
 * A bearer token acting as an existing farmer, buyer or driver row — creating
 * the account link on first use. The row's own phone becomes the login.
 */
export function testToken(role: Account['role'], roleId: string, phone: string): string {
  const authUserId = `auth-${role}-${roleId}`;
  const existing = db.select().from(accounts).where(eq(accounts.authUserId, authUserId)).get();
  if (!existing) {
    db.insert(accounts)
      .values({
        authUserId,
        phone: normalizePhone(phone),
        role,
        farmerId: role === 'farmer' ? roleId : null,
        buyerId: role === 'buyer' ? roleId : null,
        driverId: role === 'driver' ? roleId : null,
      })
      .run();
  }
  return testLoginToken(authUserId, phone);
}

/** Shorthand: a token for the shared test buyer. */
export function testBuyerToken(): string {
  const buyer = testBuyer();
  return testToken('buyer', buyer.id, buyer.phone!);
}

/** The newest open offer thread waiting on this farmer (Phase 1) — what the engine or a buyer bid made. */
export function openOfferFor(farmerId: string, lotId?: string): Offer | undefined {
  return listOffersForFarmer(farmerId, 'open').find((o) => o.turn === 'farmer' && (!lotId || o.lotId === lotId));
}

/**
 * Accept the offer waiting on this farmer, as the farmer: the order is created
 * and the buyer's payment hold starts — what "press 1" did before Phase 1.
 */
export async function acceptFor(farmerId: string, lotId?: string): Promise<Contract> {
  const offer = openOfferFor(farmerId, lotId);
  if (!offer) throw new Error(`no open offer waiting on farmer ${farmerId}`);
  const { contract } = await acceptOfferThread(offer.id, 'farmer', farmerId);
  return contract;
}
