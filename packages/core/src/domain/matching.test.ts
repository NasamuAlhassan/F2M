import { describe, expect, it } from 'vitest';
import { getContractByMatchId, listContractsForFarmer } from './contracts';
import { createDemand } from './demands';
import { registerFarmer } from './farmers';
import { getLot, registerLot } from './lots';
import { acceptOffer, clockCompatible, declineOffer, expireOffers, scoreLotForDemand } from './matching';
import { getDemand } from './demands';
import { getTrace } from './trace';
import { verifyBuyerLogin } from './buyers';
import type { ClockConfig } from './types';

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const storableClock: ClockConfig = { offerTtlMinutes: 1440, distanceDecayKm: 300, allowsForward: true, maxWindowDays: 60 };
const perishableClock: ClockConfig = { offerTtlMinutes: 120, distanceDecayKm: 50, allowsForward: false, maxWindowDays: 2 };
const stats = { settled: 0, defaulted: 0 };

function demoBuyerId(): string {
  return verifyBuyerLogin('buyer@demo.ftm', 'demo-buyer-2026').id;
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

  it('offers on demand creation, accepts via the state machine, reserves quantity', () => {
    const farmer = registerFarmer({ phone: '0261000001', name: 'Yaw Darko', regionCode: 'BONO_EAST' });
    const lot = registerLot({ farmerId: farmer.id, commodityCode: 'YAM', unitCode: 'HUNDRED', unitQty: 2, declaredBand: 'A' }); // 500kg

    const demand = createDemand({
      buyerId: demoBuyerId(),
      commodityCode: 'YAM',
      quantityKg: 300,
      minBand: 'B',
      basePricePerKg: 350,
      windowStart: now,
      windowEnd: now + 14 * DAY,
      regionCode: 'GREATER_ACCRA',
    });
    expect(demand.status).toBe('fulfilled');
    expect(demand.remainingKg).toBe(0);

    const offers = listContractsForFarmer(farmer.id, ['OFFERED']);
    expect(offers).toHaveLength(1);
    const contract = offers[0]!;
    expect(contract.quantityKg).toBe(300);
    // Hold sized at the best band (A) — base 350 for min band B → A ≈ 398.
    expect(contract.holdAmount).toBe(Math.round(300 * Math.round(350 / 0.88)));
    expect(getLot(lot.id).remainingKg).toBe(200); // reserved

    const accepted = acceptOffer(contract.id, farmer.id);
    expect(accepted.state).toBe('ACCEPTED');
    expect(getLot(lot.id).status).toBe('contracted');

    const types = getTrace(lot.id).map((e) => e.type);
    expect(types).toEqual(['LOT_REGISTERED', 'MATCHED', 'CONTRACT_OFFERED', 'CONTRACT_ACCEPTED']);
  });

  it('guards the accept against the wrong farmer', () => {
    const farmer = registerFarmer({ phone: '0261000002', name: 'Efua Nyame', regionCode: 'VOLTA' });
    registerLot({ farmerId: farmer.id, commodityCode: 'YAM', unitCode: 'TUBER', unitQty: 100, declaredBand: 'B' }); // 250kg
    createDemand({
      buyerId: demoBuyerId(),
      commodityCode: 'YAM',
      quantityKg: 200,
      minBand: 'C',
      basePricePerKg: 300,
      windowStart: now,
      windowEnd: now + 10 * DAY,
      regionCode: 'VOLTA',
    });
    const offer = listContractsForFarmer(farmer.id, ['OFFERED'])[0]!;
    expect(() => acceptOffer(offer.id, 'someone-else')).toThrow(/Not your contract/);

    // Decline restores both sides.
    declineOffer(offer.id, farmer.id);
    expect(getLot(offer.lotId).remainingKg).toBe(250);
    expect(getLot(offer.lotId).status).toBe('registered');
    expect(getDemand(offer.demandId).remainingKg).toBe(200);
  });

  it('expires stale offers via the sweep without re-offering the same lot', () => {
    const farmer = registerFarmer({ phone: '0261000003', name: 'Kojo Antwi', regionCode: 'ASHANTI' });
    const lot = registerLot({ farmerId: farmer.id, commodityCode: 'TOMATO', unitCode: 'CRATE', unitQty: 5, declaredBand: 'A' }); // 260kg
    const demand = createDemand({
      buyerId: demoBuyerId(),
      commodityCode: 'TOMATO',
      quantityKg: 200,
      minBand: 'B',
      basePricePerKg: 250,
      windowStart: now,
      windowEnd: now + DAY,
      regionCode: 'ASHANTI',
    });
    const offer = listContractsForFarmer(farmer.id, ['OFFERED'])[0]!;
    expect(getLot(lot.id).remainingKg).toBe(60);

    // Tomato offers live 120 minutes; three hours later the sweep expires it.
    const expired = expireOffers(now + 3 * HOUR);
    expect(expired).toBeGreaterThanOrEqual(1);

    const contract = getContractByMatchId(offer.matchId)!;
    expect(contract.state).toBe('EXPIRED');
    expect(getLot(lot.id).remainingKg).toBe(260); // restored
    expect(getDemand(demand.id).remainingKg).toBe(200); // restored
    // One shot per (lot, demand): no fresh OFFERED contract reappears.
    expect(listContractsForFarmer(farmer.id, ['OFFERED'])).toHaveLength(0);
    expect(getTrace(lot.id).map((e) => e.type)).toContain('OFFER_EXPIRED');
  });
});
