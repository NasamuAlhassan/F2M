import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../db/client';
import { buyers, demands, lots } from '../db/schema';
import { getCommodityByCode } from './registries';
import { MockPaymentProvider, setPaymentProvider } from '../providers/payment/index';
import { transitionContract } from '../state/contractMachine';
import { getContract } from './contracts';
import { createDemand } from './demands';
import { registerFarmer } from './farmers';
import { ACCOUNTS, accountBalance, allJournalsBalanced, contractEscrowBalance } from './ledger';
import { getLot, registerLot } from './lots';
import {
  initiateRelease,
  pollPaymentsOnce,
  refundHold,
  releaseDuePayments,
} from './paymentFlow';
import { getTrace } from './trace';
import { acceptFor, testBuyer } from '../testing/fixtures';

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
 * engine's bid deterministically lands on this farmer. The farmer accepting it
 * creates the order in ACCEPTED and starts the hold (Phase 1).
 */
async function acceptedOrder(phone: string, buyerId: string) {
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
    basePricePerKg: 400, // B=400/kg → the B lot is bid 2 × 250kg units at 100,000p each
    windowStart: Date.now(),
    windowEnd: Date.now() + 14 * DAY,
    regionCode: 'GREATER_ACCRA',
  });
  const order = await acceptFor(farmer.id, lot.id);
  expect(order.buyerId).toBe(buyerId);
  return { farmer, lot, order };
}

describe('payment flow (M4)', () => {
  it('holds funds on accept and posts a balanced hold journal', async () => {
    const buyer = testBuyer();
    const { order } = await acceptedOrder('0271000001', buyer.id);
    expect(getContract(order.id).state).toBe('ACCEPTED');
    // The hold is the exact agreed total: 2 units × 100,000p.
    expect(order.holdAmount).toBe(200_000);
    expect(order.agreedTotal).toBe(200_000);

    await pollPaymentsOnce();
    const contract = getContract(order.id);
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
        phone: '+233555110000',
        name: 'Declining Buyer',
        momoMsisdn: '233555110000',
        regionCode: 'GREATER_ACCRA',
      })
      .returning()
      .get();
    const { lot, order } = await acceptedOrder('0271000002', badBuyer.id);
    expect(getLot(lot.id).remainingKg).toBe(0); // the order took the whole listing

    await pollPaymentsOnce(); // fail #1 → FUNDING_FAILED → auto-retry → ACCEPTED
    // The retry hold also fails against the same wallet.
    await pollPaymentsOnce(); // fail #2 → CANCELLED

    const contract = getContract(order.id);
    expect(contract.state).toBe('CANCELLED');
    expect(contract.fundingAttempts).toBe(2);
    expect(contractEscrowBalance(contract.id)).toBe(0); // nothing was ever held
    expect(getLot(lot.id).remainingKg).toBe(500); // bags back on the listing
    expect(getLot(lot.id).status).toBe('registered');
    const types = getTrace(lot.id).map((e) => e.type);
    expect(types).toContain('FUNDING_FAILED');
    expect(types).toContain('CANCELLED');
  });

  // Before Phase 1 the hold was sized at the best band and settlement refunded
  // the grade delta. Every order is now an agreed deal that pays its agreed
  // total whatever the grade, and no production path creates a per-grade
  // contract any more — so settlement releases the whole hold, refunding nothing.
  it('settles: releases the agreed total, nothing left to refund', async () => {
    const buyer = testBuyer();
    const { farmer, lot, order } = await acceptedOrder('0271000003', buyer.id);

    await pollPaymentsOnce();
    expect(getContract(order.id).state).toBe('FUNDS_HELD');

    transitionContract(order.id, 'PICKUP_CONFIRMED', { type: 'farmer', id: farmer.id });
    // What grading pays for an agreed deal (A/B/C alike): the agreed total, 200,000p.
    const finalAmount = order.agreedTotal!;
    expect(finalAmount).toBe(order.holdAmount);
    transitionContract(order.id, 'GRADED', { type: 'system' }, { finalGrade: 'B', finalAmount });

    const buyerRefundsBefore = accountBalance(ACCOUNTS.buyerRefunds(buyer.id));
    const released = await releaseDuePayments(Date.now() + 11 * 60 * 1000); // past the 10min window
    expect(released).toBe(1);
    await pollPaymentsOnce();

    const contract = getContract(order.id);
    expect(contract.state).toBe('SETTLED');
    expect(contractEscrowBalance(contract.id)).toBe(0); // escrow zeroes at terminal state
    expect(accountBalance(ACCOUNTS.farmerPayable(farmer.id))).toBe(finalAmount);
    expect(accountBalance(ACCOUNTS.buyerRefunds(buyer.id)) - buyerRefundsBefore).toBe(0);
    expect(allJournalsBalanced()).toBe(true);
    expect(getLot(lot.id).status).toBe('settled');

    // Idempotent: a second release attempt returns the existing payment.
    const again = await initiateRelease(order.id).catch((e) => e);
    expect(again).toBeInstanceOf(Error); // SETTLED now — no second disbursement possible
  });

  it('refunds the full hold when a contract dies after funding', async () => {
    const buyer = testBuyer();
    const { lot, order } = await acceptedOrder('0271000004', buyer.id);
    await pollPaymentsOnce();

    const held = getContract(order.id);
    refundHold(order.id, { reason: 'pickup window missed' });

    const contract = getContract(order.id);
    expect(contract.state).toBe('CANCELLED_REFUNDED');
    expect(contractEscrowBalance(contract.id)).toBe(0);
    expect(allJournalsBalanced()).toBe(true);
    expect(getLot(lot.id).remainingKg).toBe(500); // produce back on the market
    expect(getTrace(lot.id).map((e) => e.type)).toContain('REFUNDED');
    expect(held.holdAmount).toBeGreaterThan(0);
  });
});
