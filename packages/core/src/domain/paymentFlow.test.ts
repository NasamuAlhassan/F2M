import bcrypt from 'bcryptjs';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../db/client';
import { buyers, demands, lots } from '../db/schema';
import { getCommodityByCode } from './registries';
import { MockPaymentProvider, setPaymentProvider } from '../providers/payment/index';
import { transitionContract } from '../state/contractMachine';
import { getContract, listContractsForFarmer } from './contracts';
import { createDemand } from './demands';
import { registerFarmer } from './farmers';
import { ACCOUNTS, accountBalance, allJournalsBalanced, contractEscrowBalance } from './ledger';
import { getLot, registerLot } from './lots';
import {
  acceptOfferAndHold,
  initiateRelease,
  pollPaymentsOnce,
  refundHold,
  releaseDuePayments,
} from './paymentFlow';
import { getTrace } from './trace';
import { verifyBuyerLogin } from './buyers';

const DAY = 24 * 60 * 60 * 1000;

beforeAll(() => {
  setPaymentProvider(new MockPaymentProvider(0)); // settle instantly — deterministic tests
});
afterAll(() => {
  setPaymentProvider(null);
});

/**
 * Isolated fixture: cancel any stray open demands (earlier suites leave
 * partially-matched ones that would grab the new lot at registration), then
 * register a fresh farmer + 500kg lot + an exactly-sized demand. The new lot
 * outscores any leftover lot (full quantity fit + shortest distance), so the
 * offer deterministically lands on this farmer.
 */
function offerFor(phone: string, buyerId: string) {
  const yam = getCommodityByCode('YAM');
  db.update(demands)
    .set({ status: 'cancelled' })
    .where(and(eq(demands.commodityId, yam.id), inArray(demands.status, ['open', 'partially_matched'])))
    .run();
  db.update(lots)
    .set({ status: 'withdrawn' })
    .where(and(eq(lots.commodityId, yam.id), eq(lots.status, 'registered')))
    .run();
  const farmer = registerFarmer({ phone, name: `Test ${phone.slice(-4)}`, regionCode: 'GREATER_ACCRA' });
  const lot = registerLot({
    farmerId: farmer.id,
    commodityCode: 'YAM',
    unitCode: 'HUNDRED',
    unitQty: 2, // 500kg
    declaredBand: 'B',
  });
  createDemand({
    buyerId,
    commodityCode: 'YAM',
    quantityKg: 500,
    minBand: 'B',
    basePricePerKg: 400, // B=400, A=455, C=318
    windowStart: Date.now(),
    windowEnd: Date.now() + 14 * DAY,
    regionCode: 'GREATER_ACCRA',
  });
  const offer = listContractsForFarmer(farmer.id, ['OFFERED']).find((c) => c.buyerId === buyerId)!;
  return { farmer, lot, offer };
}

describe('payment flow (M4)', () => {
  it('holds funds on accept and posts a balanced hold journal', async () => {
    const buyer = verifyBuyerLogin('buyer@demo.ftm', 'demo-buyer-2026');
    const { farmer, offer } = offerFor('0271000001', buyer.id);

    await acceptOfferAndHold(offer.id, farmer.id);
    expect(getContract(offer.id).state).toBe('ACCEPTED');

    await pollPaymentsOnce();
    const contract = getContract(offer.id);
    expect(contract.state).toBe('FUNDS_HELD');
    expect(contractEscrowBalance(contract.id)).toBe(contract.holdAmount);
    expect(allJournalsBalanced()).toBe(true);
    expect(getTrace(contract.lotId).map((e) => e.type)).toContain('FUNDS_HELD');
  });

  it('fails funding on the magic MSISDN, retries once, then cancels', async () => {
    // A buyer whose wallet always declines (mock magic: ...0000).
    const badBuyer = db
      .insert(buyers)
      .values({
        email: 'declines@demo.ftm',
        passwordHash: bcrypt.hashSync('x', 4),
        name: 'Declining Buyer',
        momoMsisdn: '233555110000',
        regionCode: 'GREATER_ACCRA',
      })
      .returning()
      .get();
    const { farmer, lot, offer } = offerFor('0271000002', badBuyer.id);

    await acceptOfferAndHold(offer.id, farmer.id);
    await pollPaymentsOnce(); // fail #1 → FUNDING_FAILED → auto-retry → ACCEPTED
    // The retry hold also fails against the same wallet.
    await pollPaymentsOnce(); // fail #2 → CANCELLED

    const contract = getContract(offer.id);
    expect(contract.state).toBe('CANCELLED');
    expect(contract.fundingAttempts).toBe(2);
    expect(contractEscrowBalance(contract.id)).toBe(0); // nothing was ever held
    expect(getLot(lot.id).remainingKg).toBe(500); // reservation released
    const types = getTrace(lot.id).map((e) => e.type);
    expect(types).toContain('FUNDING_FAILED');
    expect(types).toContain('CANCELLED');
  });

  it('settles: releases the graded amount and refunds the remainder', async () => {
    const buyer = verifyBuyerLogin('buyer@demo.ftm', 'demo-buyer-2026');
    const { farmer, lot, offer } = offerFor('0271000003', buyer.id);

    await acceptOfferAndHold(offer.id, farmer.id);
    await pollPaymentsOnce();
    expect(getContract(offer.id).state).toBe('FUNDS_HELD');

    transitionContract(offer.id, 'PICKUP_CONFIRMED', { type: 'farmer', id: farmer.id });
    // Graded B: 500kg × 400p = 200,000p; hold was 500 × 455 = 227,500p.
    const finalAmount = 500 * 400;
    transitionContract(offer.id, 'GRADED', { type: 'system' }, { finalGrade: 'B', finalAmount });

    const buyerRefundsBefore = accountBalance(ACCOUNTS.buyerRefunds(buyer.id));
    const released = await releaseDuePayments(Date.now() + 11 * 60 * 1000); // past the 10min window
    expect(released).toBe(1);
    await pollPaymentsOnce();

    const contract = getContract(offer.id);
    expect(contract.state).toBe('SETTLED');
    expect(contractEscrowBalance(contract.id)).toBe(0); // escrow zeroes at terminal state
    expect(accountBalance(ACCOUNTS.farmerPayable(farmer.id))).toBe(finalAmount);
    expect(accountBalance(ACCOUNTS.buyerRefunds(buyer.id)) - buyerRefundsBefore).toBe(contract.holdAmount - finalAmount);
    expect(allJournalsBalanced()).toBe(true);
    expect(getLot(lot.id).status).toBe('settled');

    // Idempotent: a second release attempt returns the existing payment.
    const again = await initiateRelease(offer.id).catch((e) => e);
    expect(again).toBeInstanceOf(Error); // SETTLED now — no second disbursement possible
  });

  it('refunds the full hold when a contract dies after funding', async () => {
    const buyer = verifyBuyerLogin('buyer@demo.ftm', 'demo-buyer-2026');
    const { farmer, lot, offer } = offerFor('0271000004', buyer.id);
    await acceptOfferAndHold(offer.id, farmer.id);
    await pollPaymentsOnce();

    const held = getContract(offer.id);
    refundHold(offer.id, { reason: 'pickup window missed' });

    const contract = getContract(offer.id);
    expect(contract.state).toBe('CANCELLED_REFUNDED');
    expect(contractEscrowBalance(contract.id)).toBe(0);
    expect(allJournalsBalanced()).toBe(true);
    expect(getLot(lot.id).remainingKg).toBe(500); // produce back on the market
    expect(getTrace(lot.id).map((e) => e.type)).toContain('REFUNDED');
    expect(held.holdAmount).toBeGreaterThan(0);
  });
});
