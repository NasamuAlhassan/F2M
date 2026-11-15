import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '../db/client';
import { demands } from '../db/schema';
import { getContract, listContractsForFarmer } from './contracts';
import { createDemand } from './demands';
import { registerFarmer } from './farmers';
import { getLot, registerLot } from './lots';
import { clockCompatible, runMatching, scoreLotForDemand } from './matching';
import { acceptProposal, getOffer, listOfferEvents, rejectOffer, sweepOffers } from './offers';
import { getDemand } from './demands';
import { getTrace } from './trace';
import { openOfferFor, testBuyer } from '../testing/fixtures';
import type { ClockConfig } from './types';

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const storableClock: ClockConfig = { offerTtlMinutes: 1440, distanceDecayKm: 300, allowsForward: true, maxWindowDays: 60 };
const perishableClock: ClockConfig = { offerTtlMinutes: 120, distanceDecayKm: 50, allowsForward: false, maxWindowDays: 2 };
const stats = { settled: 0, defaulted: 0 };

async function demoBuyerId(): Promise<string> {
  return (await testBuyer()).id;
}

describe('scorer (pure)', () => {
  const now = Date.now();
  const baseLot = { remainingKg: 500, declaredBand: 'B', readyDate: now };
  const baseDemand = { remainingKg: 500, minBand: 'B', windowStart: now, windowEnd: now + 7 * DAY };

  it('decays distance much faster for perishables', () => {
    const s = scoreLotForDemand({ lot: baseLot, demand: baseDemand, clockType: 'storable', clock: storableClock, distanceKm: 100, stats });
    const p = scoreLotForDemand({
      lot: baseLot,
      demand: { ...baseDemand, windowEnd: now + DAY },
      clockType: 'perishable',
      clock: perishableClock,
      distanceKm: 100,
      stats,
    });
    expect(s.breakdown.distance).toBeCloseTo(Math.exp(-100 / 300), 5);
    expect(p.breakdown.distance).toBeCloseTo(Math.exp(-100 / 50), 5);
    expect(p.breakdown.distance).toBeLessThan(s.breakdown.distance);
  });

  it('scores quality bands relative to the demand minimum', () => {
    const at = scoreLotForDemand({ lot: { ...baseLot, declaredBand: 'A' }, demand: baseDemand, clockType: 'storable', clock: storableClock, distanceKm: 10, stats });
    const below = scoreLotForDemand({ lot: { ...baseLot, declaredBand: 'C' }, demand: baseDemand, clockType: 'storable', clock: storableClock, distanceKm: 10, stats });
    expect(at.breakdown.qualityBand).toBe(1);
    expect(below.breakdown.qualityBand).toBe(0.6);
  });

  it('rewards settled history via Laplace smoothing', () => {
    const fresh = scoreLotForDemand({ lot: baseLot, demand: baseDemand, clockType: 'storable', clock: storableClock, distanceKm: 10, stats: { settled: 0, defaulted: 0 } });
    const proven = scoreLotForDemand({ lot: baseLot, demand: baseDemand, clockType: 'storable', clock: storableClock, distanceKm: 10, stats: { settled: 8, defaulted: 0 } });
    expect(fresh.breakdown.farmerHistory).toBe(0.5);
    expect(proven.breakdown.farmerHistory).toBe(0.9);
  });

  it('enforces the clock hard filter', () => {
    const now = Date.now();
    const window = { windowStart: now, windowEnd: now + DAY };
    // Storable: pre-harvest forward (ready in 3 weeks) fits a 30-day window.
    expect(clockCompatible({ readyDate: now + 21 * DAY }, { windowStart: now, windowEnd: now + 30 * DAY }, storableClock)).toBe(true);
    // Perishable: ready in 10 days cannot serve a next-day window.
    expect(clockCompatible({ readyDate: now + 10 * DAY }, window, perishableClock)).toBe(false);
    expect(clockCompatible({ readyDate: now }, window, perishableClock)).toBe(true);
  });
});

describe('offer lifecycle (yam fixtures)', () => {
  const now = Date.now();

  it('bids on demand creation in whole units, creates the order on accept, keeps the rest listed', async () => {
    const farmer = await registerFarmer({ phone: '0261000001', name: 'Yaw Darko', regionCode: 'BONO_EAST' });
    const lot = await registerLot({ farmerId: farmer.id, commodityCode: 'YAM', unitCode: 'HUNDRED', unitQty: 2, declaredBand: 'A' }); // 500kg

    const demand = await createDemand({
          buyerId: await demoBuyerId(),
          commodityCode: 'YAM',
          quantityKg: 300,
          minBand: 'B',
          basePricePerKg: 350,
          windowStart: now,
          windowEnd: now + 14 * DAY,
          regionCode: 'GREATER_ACCRA',
        });
    // Whole units only (Phase 1): 300kg buys one 250kg Hundred; 50kg stays wanted.
    expect(demand.status).toBe('partially_matched');
    expect(demand.remainingKg).toBe(50);

    // The engine's suggestion is a buyer bid waiting on the farmer — no contract yet.
    const offer = (await openOfferFor(farmer.id, lot.id))!;
    expect(offer).toBeDefined();
    expect(offer.proposedBy).toBe('buyer');
    expect(offer.units).toBe(1);
    expect(offer.heldDemandKg).toBe(250);
    // Priced at the request's band-A rate (base 350 for min band B → A ≈ 398/kg) per 250kg unit.
    expect(offer.pricePerUnit).toBe(Math.round(350 / 0.88) * 250);
    expect(await listContractsForFarmer(farmer.id)).toHaveLength(0);
    expect((await getLot(lot.id)).remainingKg).toBe(500); // an open bid reserves nothing on the listing

    const { contractId } = await acceptProposal(offer.id, 'farmer', farmer.id);
    const contract = await getContract(contractId);
    expect(contract.state).toBe('ACCEPTED');
    expect(contract.quantityKg).toBe(250);
    expect(contract.agreedTotal).toBe(offer.pricePerUnit);
    expect(contract.holdAmount).toBe(offer.pricePerUnit);
    expect((await getOffer(offer.id)).status).toBe('accepted');
    // A listing with bags left stays on the market (Phase 1).
    expect((await getLot(lot.id)).remainingKg).toBe(250);
    expect((await getLot(lot.id)).status).toBe('registered');

    const types = (await getTrace(lot.id)).map((e) => e.type);
    expect(types).toEqual(['LOT_REGISTERED', 'MATCHED', 'CONTRACT_ACCEPTED']);

    // Close the 50kg still wanted, or it would bid on the next test's yam listing.
    (await db.update(demands).set({ status: 'cancelled' }).where(eq(demands.id, demand.id)));
  });

  it('guards the accept against the wrong farmer', async () => {
    const farmer = await registerFarmer({ phone: '0261000002', name: 'Efua Nyame', regionCode: 'VOLTA' });
    const lot = await registerLot({ farmerId: farmer.id, commodityCode: 'YAM', unitCode: 'TUBER', unitQty: 100, declaredBand: 'B' }); // 250kg
    const demand = await createDemand({
          buyerId: await demoBuyerId(),
          commodityCode: 'YAM',
          quantityKg: 200,
          minBand: 'C',
          basePricePerKg: 300,
          windowStart: now,
          windowEnd: now + 10 * DAY,
          regionCode: 'VOLTA',
        });
    const offer = (await openOfferFor(farmer.id, lot.id))!;
    expect(offer.units).toBe(80); // 80 tubers × 2.5kg
    expect((await getDemand(demand.id)).remainingKg).toBe(0); // held by the thread
    await expect((() => acceptProposal(offer.id, 'farmer', 'someone-else'))()).rejects.toThrow(/Not your offer/);

    // Rejecting gives the request its kilograms back; the listing never lost any.
    await rejectOffer(offer.id, 'farmer', farmer.id);
    expect((await getOffer(offer.id)).status).toBe('rejected');
    expect((await getLot(lot.id)).remainingKg).toBe(250);
    expect((await getLot(lot.id)).status).toBe('registered');
    expect((await getDemand(demand.id)).remainingKg).toBe(200);
  });

  it('expires stale offers via the sweep without re-offering the same lot', async () => {
    const farmer = await registerFarmer({ phone: '0261000003', name: 'Kojo Antwi', regionCode: 'ASHANTI' });
    const lot = await registerLot({ farmerId: farmer.id, commodityCode: 'TOMATO', unitCode: 'CRATE', unitQty: 5, declaredBand: 'A' }); // 260kg
    const demand = await createDemand({
          buyerId: await demoBuyerId(),
          commodityCode: 'TOMATO',
          quantityKg: 200,
          minBand: 'B',
          basePricePerKg: 250,
          windowStart: now,
          windowEnd: now + DAY,
          regionCode: 'ASHANTI',
        });
    const offer = (await openOfferFor(farmer.id, lot.id))!;
    expect(offer.units).toBe(3); // 3 × 52kg crates fit the 200kg request
    expect(offer.heldDemandKg).toBe(156);
    expect((await getLot(lot.id)).remainingKg).toBe(260);

    // Tomato offers live 120 minutes; three hours later the sweep expires it.
    const { expired } = await sweepOffers(now + 3 * HOUR);
    expect(expired).toBeGreaterThanOrEqual(1);

    expect((await getOffer(offer.id)).status).toBe('expired');
    expect((await getLot(lot.id)).remainingKg).toBe(260);
    expect((await getDemand(demand.id)).remainingKg).toBe(200); // held kg released
    // One shot per (lot, demand): rematching does not open a fresh thread here.
    await runMatching({ demandId: demand.id });
    expect(await openOfferFor(farmer.id, lot.id)).toBeUndefined();
    expect((await listOfferEvents(offer.id)).map((e) => e.action)).toEqual(['bid', 'expire']);
  });
});
