import { and, eq, inArray } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../config';
import { db } from '../db/client';
import { buyerNotifications, demands, lots, notifications, offers, payments, voiceCalls } from '../db/schema';
import { setGradingProvider } from '../providers/grading/index';
import { MockPaymentProvider, setPaymentProvider } from '../providers/payment/index';
import { testBuyer } from '../testing/fixtures';
import { registerBuyer } from './buyers';
import { getContract } from './contracts';
import { createDemand, demandPriceTerms, getDemand } from './demands';
import { DomainError } from './errors';
import { registerFarmer } from './farmers';
import { confirmPickup, runGrading } from './gradingFlow';
import { getLot, markLotSold, registerLot, sweepListings, updateLot, withdrawLot } from './lots';
import { runMatching } from './matching';
import {
  acceptProposal,
  counterOffer,
  describeOffer,
  getOffer,
  OFFER_REMINDER_AFTER_MS,
  offerOnRequest,
  placeBid,
  rejectOffer,
  sweepOffers,
  unitsAvailable,
  withdrawOffer,
} from './offers';
import { acceptOfferThread, pollPaymentsOnce } from './paymentFlow';
import { addPhoto } from './photos';
import { getCommodityByCode } from './registries';

/*
 * Phase 1 negotiation rules (docs/PHASE1.md) at the domain level. Everything
 * trades ONION in 50kg bags (offer clock 720 min) so no other suite's open
 * requests or listings can match into these threads.
 */

const DAY = 24 * 60 * 60 * 1000;
const ONION_TTL_MS = 720 * 60 * 1000;
const BAG_KG = 50;

let farmerSeq = 0;
let buyerSeq = 0;
const nextFarmerPhone = () => `+2332074950${String(++farmerSeq).padStart(2, '0')}`;
const nextBuyerPhone = () => `+2332074951${String(++buyerSeq).padStart(2, '0')}`;

/** Scripted grading verdicts for the agreed-deal grading test. */
const verdicts: string[] = [];

beforeAll(() => {
  setPaymentProvider(new MockPaymentProvider(0));
  setGradingProvider({
    name: 'mock',
    grade: async () => {
      const band = verdicts.shift();
      if (!band) throw new Error('no scripted verdict');
      return { gradeBand: band, confidence: 0.9, reasons: [{ criterion: 'rot', observation: `scripted ${band}`, bandForCriterion: band }], provider: 'mock' };
    },
  });
});
afterAll(() => {
  setPaymentProvider(null);
  setGradingProvider(null);
});

// Each test builds its own onion market from scratch; leftovers from an earlier
// test would otherwise be matched by the engine into the next one.
beforeEach(() => {
  const onion = getCommodityByCode('ONION');
  db.update(demands)
    .set({ status: 'cancelled' })
    .where(and(eq(demands.commodityId, onion.id), inArray(demands.status, ['open', 'partially_matched'])))
    .run();
  db.update(lots)
    .set({ status: 'withdrawn' })
    .where(and(eq(lots.commodityId, onion.id), inArray(lots.status, ['registered', 'matched'])))
    .run();
});

function newFarmer(name = 'Onion Farmer') {
  return registerFarmer({ phone: nextFarmerPhone(), name, regionCode: 'NORTHERN' });
}

function newBuyer(company: string) {
  return registerBuyer({ phone: nextBuyerPhone(), name: `${company} buyer`, company, regionCode: 'ASHANTI' });
}

function onionLot(farmerId: string, bags = 10, declaredBand: 'A' | 'B' | 'C' = 'B') {
  return registerLot({ farmerId, commodityCode: 'ONION', unitCode: 'BAG_50KG', unitQty: bags, declaredBand, channel: 'web' });
}

/**
 * A public onion request. `engine: false` puts the delivery window three days
 * out, which no ready-now perishable listing is clock-compatible with — so the
 * engine leaves it alone and a farmer can answer it by hand.
 */
function onionRequest(quantityKg: number, opts: { engine?: boolean; basePricePerKg?: number } = {}) {
  const now = Date.now();
  const start = opts.engine === false ? now + 3 * DAY : now;
  return createDemand({
    buyerId: testBuyer().id,
    commodityCode: 'ONION',
    quantityKg,
    minBand: 'B',
    basePricePerKg: opts.basePricePerKg ?? 700,
    windowStart: start,
    windowEnd: start + 2 * DAY,
    regionCode: 'NORTHERN',
  });
}

function smsTo(phone: string, templateKey: string) {
  return db
    .select()
    .from(notifications)
    .where(and(eq(notifications.phone, phone), eq(notifications.templateKey, templateKey)))
    .all();
}

function buyerAlerts(buyerId: string, templateKey: string, lotId: string) {
  return db
    .select()
    .from(buyerNotifications)
    .where(and(eq(buyerNotifications.buyerId, buyerId), eq(buyerNotifications.templateKey, templateKey), eq(buyerNotifications.lotId, lotId)))
    .all();
}

/** The DomainError code a call fails with (undefined if it succeeds). */
function failureCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    throw err;
  }
  return undefined;
}

function failure(fn: () => unknown): DomainError {
  try {
    fn();
  } catch (err) {
    if (err instanceof DomainError) return err;
    throw err;
  }
  throw new Error('expected a DomainError');
}

describe('a buyer bids on a listing', () => {
  it('passes the turn to the farmer, texts them and queues a call', () => {
    const buyer = testBuyer();
    const farmer = newFarmer();
    const lot = onionLot(farmer.id, 10);

    const offer = placeBid({ buyerId: buyer.id, lotId: lot.id, units: 4, pricePerUnit: 38000 });
    expect(offer).toMatchObject({ status: 'open', turn: 'farmer', proposedBy: 'buyer', units: 4, pricePerUnit: 38000, demandId: null });
    expect(offer.expiresAt).toBe(offer.proposedAt + ONION_TTL_MS);

    const sms = smsTo(farmer.phone, 'sms.bidReceived');
    expect(sms).toHaveLength(1);
    expect(sms[0]!.lotId).toBe(lot.id);
    expect(sms[0]!.message).toContain('GHS 380.00');

    const calls = db.select().from(voiceCalls).where(eq(voiceCalls.offerId, offer.id)).all();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ flow: 'bid', phone: farmer.phone });

    // Nothing is reserved by a bid: the listing still has all its bags.
    expect(getLot(lot.id).remainingKg).toBe(10 * BAG_KG);
  });

  it('refuses part units, zero, more than is left, and a price of zero or less', () => {
    const buyer = testBuyer();
    const lot = onionLot(newFarmer().id, 4);
    const bid = (units: number, pricePerUnit: number) => () => placeBid({ buyerId: buyer.id, lotId: lot.id, units, pricePerUnit });

    expect(failureCode(bid(1.5, 38000))).toBe('INVALID_UNITS');
    expect(failureCode(bid(0, 38000))).toBe('INVALID_UNITS');
    expect(failureCode(bid(-2, 38000))).toBe('INVALID_UNITS');
    expect(failureCode(bid(2, 0))).toBe('INVALID_PRICE');
    expect(failureCode(bid(2, -100))).toBe('INVALID_PRICE');

    const tooMany = failure(bid(5, 38000));
    expect(tooMany.code).toBe('NOT_ENOUGH_LEFT');
    expect(tooMany.message).toMatch(/Only 4 50kg bags left/);

    expect(failureCode(bid(4, 38000))).toBeUndefined(); // exactly what is left is fine
  });

  it('refuses a second open bid by the same buyer on the same listing', () => {
    const buyer = testBuyer();
    const lot = onionLot(newFarmer().id, 10);
    placeBid({ buyerId: buyer.id, lotId: lot.id, units: 2, pricePerUnit: 38000 });
    expect(failureCode(() => placeBid({ buyerId: buyer.id, lotId: lot.id, units: 3, pricePerUnit: 39000 }))).toBe('OFFER_EXISTS');
  });
});

describe('countering back and forth', () => {
  it('flips the turn each time, restarts the clock and records every move', () => {
    const buyer = testBuyer();
    const farmer = newFarmer();
    const lot = onionLot(farmer.id, 10);
    const bid = placeBid({ buyerId: buyer.id, lotId: lot.id, units: 2, pricePerUnit: 38000 });

    // Only the side whose turn it is may answer.
    expect(failureCode(() => counterOffer(bid.id, 'buyer', buyer.id, { pricePerUnit: 39000 }))).toBe('NOT_YOUR_TURN');
    expect(failureCode(() => acceptProposal(bid.id, 'buyer', buyer.id))).toBe('NOT_YOUR_TURN');
    expect(failureCode(() => rejectOffer(bid.id, 'buyer', buyer.id))).toBe('NOT_YOUR_TURN');
    // A stranger cannot move it at all.
    const stranger = newFarmer('Stranger');
    expect(failureCode(() => counterOffer(bid.id, 'farmer', stranger.id, { pricePerUnit: 40000 }))).toBe('FORBIDDEN');
    // And the side whose turn it is rejects rather than withdraws.
    expect(failureCode(() => withdrawOffer(bid.id, 'farmer', farmer.id))).toBe('USE_REJECT');
    expect(failureCode(() => counterOffer(bid.id, 'farmer', farmer.id, { pricePerUnit: 0 }))).toBe('INVALID_PRICE');

    // Pretend the bid has been sitting a while, so a restarted clock is visible.
    db.update(offers).set({ expiresAt: Date.now() + 60_000 }).where(eq(offers.id, bid.id)).run();
    const t0 = Date.now();
    const farmerCounter = counterOffer(bid.id, 'farmer', farmer.id, { units: 3, pricePerUnit: 42000 });
    expect(farmerCounter).toMatchObject({ turn: 'buyer', proposedBy: 'farmer', units: 3, pricePerUnit: 42000 });
    expect(farmerCounter.expiresAt!).toBeGreaterThanOrEqual(t0 + ONION_TTL_MS);
    expect(buyerAlerts(buyer.id, 'notif.farmerCountered', lot.id)).toHaveLength(1);

    expect(failureCode(() => counterOffer(bid.id, 'farmer', farmer.id, { pricePerUnit: 43000 }))).toBe('NOT_YOUR_TURN');
    expect(failureCode(() => acceptProposal(bid.id, 'farmer', farmer.id))).toBe('NOT_YOUR_TURN');

    const t1 = Date.now();
    const buyerCounter = counterOffer(bid.id, 'buyer', buyer.id, { pricePerUnit: 40000 });
    expect(buyerCounter).toMatchObject({ turn: 'farmer', proposedBy: 'buyer', units: 3, pricePerUnit: 40000 });
    expect(buyerCounter.expiresAt!).toBeGreaterThanOrEqual(t1 + ONION_TTL_MS);
    expect(smsTo(farmer.phone, 'sms.counterReceived')).toHaveLength(1);

    // Waiting on the farmer now: only the buyer (the waiting side) may withdraw.
    expect(failureCode(() => withdrawOffer(bid.id, 'farmer', farmer.id))).toBe('USE_REJECT');
    const withdrawn = withdrawOffer(bid.id, 'buyer', buyer.id);
    expect(withdrawn).toMatchObject({ status: 'withdrawn', turn: null });
    expect(failureCode(() => acceptProposal(bid.id, 'farmer', farmer.id))).toBe('OFFER_CLOSED');

    const history = describeOffer(getOffer(bid.id)).history.map((h) => ({
      by: h.by,
      action: h.action,
      units: h.units,
      pricePerUnit: h.pricePerUnit,
      previousPricePerUnit: h.previousPricePerUnit,
    }));
    expect(history).toEqual([
      { by: 'buyer', action: 'bid', units: 2, pricePerUnit: 38000, previousPricePerUnit: null },
      { by: 'farmer', action: 'counter', units: 3, pricePerUnit: 42000, previousPricePerUnit: 38000 },
      { by: 'buyer', action: 'counter', units: 3, pricePerUnit: 40000, previousPricePerUnit: 42000 },
      { by: 'buyer', action: 'withdraw', units: null, pricePerUnit: null, previousPricePerUnit: null },
    ]);
  });

  it('lets the side whose turn it is reject, which ends the thread and tells the buyer', () => {
    const buyer = testBuyer();
    const farmer = newFarmer();
    const lot = onionLot(farmer.id, 10);
    const bid = placeBid({ buyerId: buyer.id, lotId: lot.id, units: 2, pricePerUnit: 30000 });
    const rejected = rejectOffer(bid.id, 'farmer', farmer.id);
    expect(rejected).toMatchObject({ status: 'rejected', turn: null });
    expect(buyerAlerts(buyer.id, 'notif.offerRejected', lot.id)).toHaveLength(1);
    // A closed thread no longer blocks a fresh bid.
    expect(failureCode(() => placeBid({ buyerId: buyer.id, lotId: lot.id, units: 2, pricePerUnit: 33000 }))).toBeUndefined();
  });
});

describe('accepting creates the order', () => {
  it('makes an ACCEPTED contract for exactly units × price, starts the hold and takes the bags off the listing', async () => {
    const buyer = testBuyer();
    const farmer = newFarmer();
    const lot = onionLot(farmer.id, 10);
    // An odd price: the exact total (3 × 33333 = 99999) differs from any per-kg rounding.
    const bid = placeBid({ buyerId: buyer.id, lotId: lot.id, units: 3, pricePerUnit: 33333 });

    const { offer, contract } = await acceptOfferThread(bid.id, 'farmer', farmer.id);
    expect(contract.state).toBe('ACCEPTED');
    expect(contract.agreedTotal).toBe(99999);
    expect(contract.holdAmount).toBe(99999);
    expect(contract.quantityKg).toBe(3 * BAG_KG);
    expect(contract).toMatchObject({ lotId: lot.id, buyerId: buyer.id, farmerId: farmer.id });

    const hold = db.select().from(payments).where(and(eq(payments.contractId, contract.id), eq(payments.direction, 'collection'))).all();
    expect(hold).toHaveLength(1);
    expect(hold[0]!.amount).toBe(99999);

    expect(offer).toMatchObject({ status: 'accepted', turn: null, contractId: contract.id });
    expect(describeOffer(offer).history.at(-1)).toMatchObject({ by: 'farmer', action: 'accept' });

    const after = getLot(lot.id);
    expect(after.remainingKg).toBe(7 * BAG_KG);
    expect(after.status).toBe('registered'); // bags left: still on the market
    expect(unitsAvailable(after)).toBe(7);

    expect(smsTo(farmer.phone, 'sms.offerAgreed').some((s) => s.lotId === lot.id)).toBe(true);
    expect(buyerAlerts(buyer.id, 'notif.dealAgreed', lot.id)).toHaveLength(1);

    await pollPaymentsOnce();
    expect(getContract(contract.id).state).toBe('FUNDS_HELD');
  });

  it('takes a listing off the market when the last bag is sold', async () => {
    const buyer = testBuyer();
    const farmer = newFarmer();
    const lot = onionLot(farmer.id, 2);
    const bid = placeBid({ buyerId: buyer.id, lotId: lot.id, units: 2, pricePerUnit: 40000 });
    await acceptOfferThread(bid.id, 'farmer', farmer.id);
    expect(getLot(lot.id)).toMatchObject({ remainingKg: 0, status: 'contracted' });
  });

  it('lets the buyer accept a farmer counter', async () => {
    const buyer = testBuyer();
    const farmer = newFarmer();
    const lot = onionLot(farmer.id, 10);
    const bid = placeBid({ buyerId: buyer.id, lotId: lot.id, units: 2, pricePerUnit: 38000 });
    counterOffer(bid.id, 'farmer', farmer.id, { pricePerUnit: 41000 });
    const { contract } = await acceptOfferThread(bid.id, 'buyer', buyer.id);
    expect(contract.agreedTotal).toBe(2 * 41000);
  });
});

describe('many buyers on one listing', () => {
  it('lets several buyers bid; the first acceptance wins and a later one that no longer fits is refused plainly', async () => {
    const farmer = newFarmer();
    const lot = onionLot(farmer.id, 4);
    const first = testBuyer();
    const second = newBuyer('Kumasi Onion Traders');

    const bidA = placeBid({ buyerId: first.id, lotId: lot.id, units: 3, pricePerUnit: 38000 });
    const bidB = placeBid({ buyerId: second.id, lotId: lot.id, units: 3, pricePerUnit: 39000 });
    expect(bidA.status).toBe('open');
    expect(bidB.status).toBe('open');

    await acceptOfferThread(bidA.id, 'farmer', farmer.id);
    expect(getLot(lot.id).remainingKg).toBe(1 * BAG_KG);

    const refused = failure(() => acceptProposal(bidB.id, 'farmer', farmer.id));
    expect(refused.code).toBe('NOT_ENOUGH_LEFT');
    expect(refused.message).toMatch(/Only 1 50kg bag left/);
    // Nothing moved: the losing thread is still open for a smaller counter.
    expect(getOffer(bidB.id)).toMatchObject({ status: 'open', turn: 'farmer' });
    expect(getLot(lot.id).remainingKg).toBe(1 * BAG_KG);

    const smaller = counterOffer(bidB.id, 'farmer', farmer.id, { units: 1, pricePerUnit: 39000 });
    expect(smaller.turn).toBe('buyer');
  });
});

describe('a farmer offers on a buyer request', () => {
  it('passes the turn to the buyer and holds that many kg of the request', () => {
    const buyer = testBuyer();
    const farmer = newFarmer();
    const lot = onionLot(farmer.id, 10);
    const request = onionRequest(300, { engine: false });
    expect(getDemand(request.id).remainingKg).toBe(300); // the engine left it alone

    const offer = offerOnRequest({ farmerId: farmer.id, demandId: request.id, lotId: lot.id, units: 4, pricePerUnit: 36000 });
    expect(offer).toMatchObject({ turn: 'buyer', proposedBy: 'farmer', demandId: request.id, buyerId: buyer.id, heldDemandKg: 200 });
    expect(getDemand(request.id)).toMatchObject({ remainingKg: 100, status: 'partially_matched' });
    expect(buyerAlerts(buyer.id, 'notif.farmerOffered', lot.id)).toHaveLength(1);

    expect(failureCode(() => offerOnRequest({ farmerId: farmer.id, demandId: request.id, lotId: lot.id, units: 1, pricePerUnit: 36000 }))).toBe(
      'OFFER_EXISTS',
    );
    // A request-held thread may shrink in the haggle but never grow past what it holds.
    expect(failureCode(() => counterOffer(offer.id, 'buyer', buyer.id, { units: 5, pricePerUnit: 35000 }))).toBe('MORE_THAN_NEEDED');
  });

  it('refuses more than the request still needs, and a different crop', () => {
    const farmer = newFarmer();
    const lot = onionLot(farmer.id, 10);
    const request = onionRequest(120, { engine: false });

    const tooMuch = failure(() => offerOnRequest({ farmerId: farmer.id, demandId: request.id, lotId: lot.id, units: 3, pricePerUnit: 36000 }));
    expect(tooMuch.code).toBe('MORE_THAN_NEEDED');
    expect(tooMuch.message).toMatch(/120kg/);

    const pepper = registerLot({ farmerId: farmer.id, commodityCode: 'PEPPER', unitCode: 'SACK', unitQty: 2, declaredBand: 'B', channel: 'web' });
    try {
      expect(failureCode(() => offerOnRequest({ farmerId: farmer.id, demandId: request.id, lotId: pepper.id, units: 1, pricePerUnit: 36000 }))).toBe(
        'WRONG_CROP',
      );
    } finally {
      withdrawLot(pepper.id, farmer.id); // keep the pepper market clean for other suites
    }

    const other = newFarmer('Not The Owner');
    expect(failureCode(() => offerOnRequest({ farmerId: other.id, demandId: request.id, lotId: lot.id, units: 1, pricePerUnit: 36000 }))).toBe(
      'FORBIDDEN',
    );
    expect(getDemand(request.id).remainingKg).toBe(120);
  });

  it('gives the held kg back when the buyer rejects or the farmer withdraws', () => {
    const buyer = testBuyer();
    const farmer = newFarmer();
    const lot = onionLot(farmer.id, 10);
    const request = onionRequest(300, { engine: false });

    const first = offerOnRequest({ farmerId: farmer.id, demandId: request.id, lotId: lot.id, units: 4, pricePerUnit: 36000 });
    expect(getDemand(request.id).remainingKg).toBe(100);
    rejectOffer(first.id, 'buyer', buyer.id);
    expect(getDemand(request.id)).toMatchObject({ remainingKg: 300, status: 'open' });
    expect(smsTo(farmer.phone, 'sms.offerEnded')).toHaveLength(1);

    const second = offerOnRequest({ farmerId: farmer.id, demandId: request.id, lotId: lot.id, units: 6, pricePerUnit: 36000 });
    expect(getDemand(request.id).remainingKg).toBe(0);
    expect(getDemand(request.id).status).toBe('fulfilled');
    withdrawOffer(second.id, 'farmer', farmer.id);
    expect(getDemand(request.id)).toMatchObject({ remainingKg: 300, status: 'open' });
    expect(buyerAlerts(buyer.id, 'notif.offerWithdrawn', lot.id)).toHaveLength(1);
  });

  it('consumes the held kg when the buyer accepts, linking the order to the request', async () => {
    const buyer = testBuyer();
    const farmer = newFarmer();
    const lot = onionLot(farmer.id, 10);
    const request = onionRequest(300, { engine: false });

    const offer = offerOnRequest({ farmerId: farmer.id, demandId: request.id, lotId: lot.id, units: 4, pricePerUnit: 36000 });
    const { contract } = await acceptOfferThread(offer.id, 'buyer', buyer.id);
    expect(contract).toMatchObject({ state: 'ACCEPTED', demandId: request.id, quantityKg: 200, agreedTotal: 4 * 36000 });
    expect(getDemand(request.id)).toMatchObject({ remainingKg: 100, status: 'partially_matched' });
    expect(getOffer(offer.id).heldDemandKg).toBe(0);
    expect(getLot(lot.id).remainingKg).toBe(300);
  });

  it('gives back the part of the hold a shrinking counter no longer needs', async () => {
    const buyer = testBuyer();
    const farmer = newFarmer();
    const lot = onionLot(farmer.id, 10);
    const request = onionRequest(300, { engine: false });

    const offer = offerOnRequest({ farmerId: farmer.id, demandId: request.id, lotId: lot.id, units: 4, pricePerUnit: 36000 });
    counterOffer(offer.id, 'buyer', buyer.id, { units: 2, pricePerUnit: 35000 });
    await acceptOfferThread(offer.id, 'farmer', farmer.id);
    expect(getDemand(request.id).remainingKg).toBe(200); // 300 − the 100kg actually ordered
  });
});

describe('the matching engine', () => {
  it('turns a fitting request into a bid in whole units at the request price for the declared grade', () => {
    const buyer = testBuyer();
    const farmer = newFarmer();
    const lot = onionLot(farmer.id, 10, 'A');
    const request = onionRequest(230); // 4.6 bags' worth — the engine offers 4

    const terms = demandPriceTerms(request);
    const engineOffers = db.select().from(offers).where(eq(offers.demandId, request.id)).all();
    expect(engineOffers).toHaveLength(1);
    const offer = engineOffers[0]!;
    expect(offer).toMatchObject({
      lotId: lot.id,
      buyerId: buyer.id,
      turn: 'farmer',
      proposedBy: 'buyer',
      units: 4,
      pricePerUnit: terms.A! * BAG_KG,
      heldDemandKg: 4 * BAG_KG,
    });
    expect(Number.isInteger(offer.units)).toBe(true);
    expect(getDemand(request.id)).toMatchObject({ remainingKg: 30, status: 'partially_matched' });
    expect(describeOffer(offer).history[0]).toMatchObject({ by: 'system', action: 'bid', channel: 'system' });
    expect(smsTo(farmer.phone, 'sms.bidReceived')).toHaveLength(1);
  });

  it('gives a listing one shot per request: after a reject the same lot is not offered again', () => {
    const farmer = newFarmer();
    const lot = onionLot(farmer.id, 10);
    const request = onionRequest(200);
    const offer = db.select().from(offers).where(and(eq(offers.demandId, request.id), eq(offers.lotId, lot.id))).get()!;
    expect(offer.units).toBe(4);

    rejectOffer(offer.id, 'farmer', farmer.id);
    expect(getDemand(request.id)).toMatchObject({ remainingKg: 200, status: 'open' });

    runMatching({ demandId: request.id });
    runMatching();
    const threads = db.select().from(offers).where(and(eq(offers.demandId, request.id), eq(offers.lotId, lot.id))).all();
    expect(threads).toHaveLength(1);
    expect(threads[0]!.status).toBe('rejected');

    // The freed kilograms flow to a different listing instead.
    const otherLot = onionLot(newFarmer('Next Farmer').id, 10);
    const next = db.select().from(offers).where(and(eq(offers.demandId, request.id), eq(offers.lotId, otherLot.id))).all();
    expect(next).toHaveLength(1);
    expect(next[0]!.units).toBe(4);
  });
});

describe('expiry and reminders (sweepOffers)', () => {
  it('expires a proposal past its clock and returns the request kg it held', () => {
    const buyer = testBuyer();
    const farmer = newFarmer();
    const lot = onionLot(farmer.id, 10);
    const request = onionRequest(300, { engine: false });
    const offer = offerOnRequest({ farmerId: farmer.id, demandId: request.id, lotId: lot.id, units: 4, pricePerUnit: 36000 });
    expect(getDemand(request.id).remainingKg).toBe(100);

    // Move this one proposal's clock into the past rather than the sweep's clock
    // into the future, so no other suite's open offers are swept along.
    db.update(offers).set({ expiresAt: Date.now() - 1000 }).where(eq(offers.id, offer.id)).run();
    const result = sweepOffers(Date.now());
    expect(result.expired).toBeGreaterThanOrEqual(1);

    expect(getOffer(offer.id)).toMatchObject({ status: 'expired', turn: null });
    expect(describeOffer(getOffer(offer.id)).history.at(-1)).toMatchObject({ by: 'system', action: 'expire' });
    expect(getDemand(request.id)).toMatchObject({ remainingKg: 300, status: 'open' });
    // The farmer's proposal was waiting on the buyer, so both are told the buyer let it lapse.
    expect(buyerAlerts(buyer.id, 'notif.proposalLapsed', lot.id)).toHaveLength(1);
    expect(smsTo(farmer.phone, 'sms.proposalLapsed')).toHaveLength(1);
  });

  it('tells the farmer when a bid they did not answer lapses', () => {
    const buyer = newBuyer('Lapse Traders');
    const farmer = newFarmer();
    const lot = onionLot(farmer.id, 10);
    const offer = placeBid({ buyerId: buyer.id, lotId: lot.id, units: 2, pricePerUnit: 40000 });
    db.update(offers).set({ expiresAt: Date.now() - 1000 }).where(eq(offers.id, offer.id)).run();
    sweepOffers(Date.now());

    expect(getOffer(offer.id).status).toBe('expired');
    expect(buyerAlerts(buyer.id, 'notif.offerLapsed', lot.id)).toHaveLength(1);
    expect(smsTo(farmer.phone, 'sms.offerLapsed')).toHaveLength(1);
  });

  it('ends the other bids on a listing the moment it sells out', () => {
    const farmer = newFarmer();
    const lot = onionLot(farmer.id, 4);
    const winner = newBuyer('Sellout Winner');
    const loser = newBuyer('Sellout Late');
    const won = placeBid({ buyerId: winner.id, lotId: lot.id, units: 4, pricePerUnit: 40000 });
    const late = placeBid({ buyerId: loser.id, lotId: lot.id, units: 2, pricePerUnit: 41000 });

    acceptProposal(won.id, 'farmer', farmer.id);

    expect(getOffer(late.id).status).toBe('withdrawn');
    expect(buyerAlerts(loser.id, 'notif.listingClosed', lot.id)).toHaveLength(1);
  });

  it('refuses a move on a lapsed proposal and closes it', () => {
    const buyer = testBuyer();
    const farmer = newFarmer();
    const lot = onionLot(farmer.id, 10);
    const bid = placeBid({ buyerId: buyer.id, lotId: lot.id, units: 2, pricePerUnit: 38000 });
    db.update(offers).set({ expiresAt: Date.now() - 1000 }).where(eq(offers.id, bid.id)).run();
    expect(failureCode(() => acceptProposal(bid.id, 'farmer', farmer.id))).toBe('OFFER_EXPIRED');
    expect(getOffer(bid.id).status).toBe('expired');
    expect(getLot(lot.id).remainingKg).toBe(10 * BAG_KG);
  });

  it('reminds a farmer once when a buyer has waited longer than the reminder delay', () => {
    const buyer = testBuyer();
    const farmer = newFarmer();
    const lot = onionLot(farmer.id, 10);
    const bid = placeBid({ buyerId: buyer.id, lotId: lot.id, units: 2, pricePerUnit: 38000 });

    sweepOffers(Date.now());
    expect(smsTo(farmer.phone, 'sms.offerReminder')).toHaveLength(0); // fresh: no nudge yet

    db.update(offers)
      .set({ proposedAt: Date.now() - OFFER_REMINDER_AFTER_MS - 60_000 })
      .where(eq(offers.id, bid.id))
      .run();
    sweepOffers(Date.now());
    sweepOffers(Date.now());
    const reminders = smsTo(farmer.phone, 'sms.offerReminder');
    expect(reminders).toHaveLength(1);
    expect(reminders[0]!.lotId).toBe(lot.id);
    expect(getOffer(bid.id).status).toBe('open'); // a reminder, not an expiry
  });
});

describe('grading an agreed deal', () => {
  it('pays the agreed total whatever the grade', async () => {
    const buyer = testBuyer();
    const farmer = newFarmer();
    const lot = onionLot(farmer.id, 10, 'A');
    const bid = placeBid({ buyerId: buyer.id, lotId: lot.id, units: 3, pricePerUnit: 33333 });
    const { contract } = await acceptOfferThread(bid.id, 'farmer', farmer.id);
    await pollPaymentsOnce();
    expect(getContract(contract.id).state).toBe('FUNDS_HELD');

    confirmPickup(contract.id, { type: 'farmer', id: farmer.id });
    const photo = await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 170, g: 120, b: 70 } } })
      .jpeg()
      .toBuffer();
    await addPhoto({ contractId: contract.id, buffer: photo, actor: { type: 'buyer', id: buyer.id } });

    verdicts.push('C'); // worse than the A the farmer declared
    await runGrading(contract.id);
    const graded = getContract(contract.id);
    expect(graded.state).toBe('GRADED');
    expect(graded.finalGrade).toBe('C');
    expect(graded.finalAmount).toBe(99999);
  });
});

describe('managing a listing', () => {
  it('stores the new listing fields and sets an expiry', () => {
    const farmer = newFarmer();
    const harvestedAt = Date.now() - 2 * DAY;
    const before = Date.now();
    const lot = registerLot({
      farmerId: farmer.id,
      commodityCode: 'ONION',
      unitCode: 'BAG_50KG',
      unitQty: 6,
      declaredBand: 'B',
      askingPricePerUnit: 40000,
      harvestedAt,
      community: '  Tolon ',
      landmark: 'behind the Methodist school',
      channel: 'web',
    });
    expect(lot).toMatchObject({ askingPricePerUnit: 40000, askingPricePerKg: 800, harvestedAt, community: 'Tolon', landmark: 'behind the Methodist school' });
    expect(lot.expiresAt!).toBeGreaterThanOrEqual(before + config.LISTING_TTL_DAYS * DAY);

    expect(
      failureCode(() =>
        registerLot({ farmerId: farmer.id, commodityCode: 'ONION', unitCode: 'BAG_50KG', unitQty: 1, declaredBand: 'B', harvestedAt: Date.now() + 3 * DAY }),
      ),
    ).toBe('INVALID_HARVEST_DATE');
  });

  it('updateLot stores the price both ways, renews the listing, and will not drop below what is sold', async () => {
    const buyer = testBuyer();
    const farmer = newFarmer();
    const lot = onionLot(farmer.id, 10);
    expect(lot.askingPricePerUnit).toBeNull();

    const priced = updateLot(lot.id, farmer.id, { askingPricePerUnit: 45000 });
    expect(priced).toMatchObject({ askingPricePerUnit: 45000, askingPricePerKg: 900 });

    // About to lapse and already warned: any change renews it for a full term.
    db.update(lots).set({ expiresAt: Date.now() + DAY, expiryWarnedAt: Date.now() }).where(eq(lots.id, lot.id)).run();
    const before = Date.now();
    const renewed = updateLot(lot.id, farmer.id, { community: 'Savelugu' });
    expect(renewed.community).toBe('Savelugu');
    expect(renewed.expiresAt!).toBeGreaterThanOrEqual(before + config.LISTING_TTL_DAYS * DAY);
    expect(renewed.expiryWarnedAt).toBeNull();

    const bid = placeBid({ buyerId: buyer.id, lotId: lot.id, units: 6, pricePerUnit: 44000 });
    await acceptOfferThread(bid.id, 'farmer', farmer.id);
    expect(getLot(lot.id).remainingKg).toBe(4 * BAG_KG);

    const below = failure(() => updateLot(lot.id, farmer.id, { units: 5 }));
    expect(below.code).toBe('BELOW_SOLD');
    expect(below.message).toMatch(/^6 are already sold/);

    const resized = updateLot(lot.id, farmer.id, { units: 8 });
    expect(resized).toMatchObject({ unitQty: 8, quantityKg: 8 * BAG_KG, remainingKg: 2 * BAG_KG });
    expect(failureCode(() => updateLot(lot.id, farmer.id, { units: 0 }))).toBe('INVALID_UNITS');
    expect(failureCode(() => updateLot(lot.id, newFarmer('Intruder').id, { askingPricePerUnit: 1 }))).toBe('FORBIDDEN');
  });

  it('markLotSold closes open threads, tells their buyers and takes the listing off the market', () => {
    const farmer = newFarmer();
    const lot = onionLot(farmer.id, 10);
    const first = testBuyer();
    const second = newBuyer('Tamale Fresh');
    const a = placeBid({ buyerId: first.id, lotId: lot.id, units: 2, pricePerUnit: 38000 });
    const b = placeBid({ buyerId: second.id, lotId: lot.id, units: 3, pricePerUnit: 39000 });

    const sold = markLotSold(lot.id, farmer.id);
    expect(sold).toMatchObject({ status: 'sold', remainingKg: 0 });
    expect(getOffer(a.id).status).toBe('withdrawn');
    expect(getOffer(b.id).status).toBe('withdrawn');
    expect(buyerAlerts(first.id, 'notif.listingClosed', lot.id)).toHaveLength(1);
    expect(buyerAlerts(second.id, 'notif.listingClosed', lot.id)).toHaveLength(1);
    expect(failureCode(() => placeBid({ buyerId: first.id, lotId: lot.id, units: 1, pricePerUnit: 38000 }))).toBe('LOT_CLOSED');
    expect(failureCode(() => markLotSold(lot.id, farmer.id))).toBe('LOT_CLOSED');
  });

  it('withdrawLot closes open threads and tells their buyers too', () => {
    const buyer = testBuyer();
    const farmer = newFarmer();
    const lot = onionLot(farmer.id, 10);
    const bid = placeBid({ buyerId: buyer.id, lotId: lot.id, units: 2, pricePerUnit: 38000 });

    expect(withdrawLot(lot.id, farmer.id)).toMatchObject({ status: 'withdrawn', remainingKg: 0 });
    expect(getOffer(bid.id).status).toBe('withdrawn');
    expect(buyerAlerts(buyer.id, 'notif.listingClosed', lot.id)).toHaveLength(1);
    expect(failureCode(() => placeBid({ buyerId: buyer.id, lotId: lot.id, units: 1, pricePerUnit: 38000 }))).toBe('LOT_CLOSED');
  });

  it('sweepListings warns once two days before the end, then expires the listing and its open threads', () => {
    const buyer = testBuyer();
    const farmer = newFarmer();
    const lot = onionLot(farmer.id, 10);
    const bid = placeBid({ buyerId: buyer.id, lotId: lot.id, units: 2, pricePerUnit: 38000 });

    // Three days out: not yet.
    db.update(lots).set({ expiresAt: Date.now() + 3 * DAY }).where(eq(lots.id, lot.id)).run();
    sweepListings(Date.now());
    expect(smsTo(farmer.phone, 'sms.listingExpiring')).toHaveLength(0);

    // Inside the two-day window: one warning, however often the sweep runs.
    db.update(lots).set({ expiresAt: Date.now() + DAY }).where(eq(lots.id, lot.id)).run();
    sweepListings(Date.now());
    sweepListings(Date.now());
    const warnings = smsTo(farmer.phone, 'sms.listingExpiring');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain(lot.lotCode);
    expect(getLot(lot.id).status).toBe('registered');

    // Past the end: expired, farmer told, the open bid closed with it.
    db.update(lots).set({ expiresAt: Date.now() - 1000 }).where(eq(lots.id, lot.id)).run();
    sweepListings(Date.now());
    expect(getLot(lot.id).status).toBe('expired');
    expect(smsTo(farmer.phone, 'sms.listingExpired')).toHaveLength(1);
    expect(getOffer(bid.id).status).toBe('expired');
    expect(buyerAlerts(buyer.id, 'notif.listingClosed', lot.id)).toHaveLength(1);
    expect(failureCode(() => placeBid({ buyerId: buyer.id, lotId: lot.id, units: 1, pricePerUnit: 38000 }))).toBe('LOT_CLOSED');
  });
});
