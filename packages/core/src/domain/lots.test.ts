import { and, eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '../db/client';
import { buyerNotifications, demands } from '../db/schema';
import { openOfferFor, testBuyer } from '../testing/fixtures';
import { createDemand, getDemand } from './demands';
import { registerFarmer } from './farmers';
import { getLot, registerLot, withdrawLot } from './lots';
import { acceptProposal, getOffer } from './offers';
import { getCommodityByCode } from './registries';
import { getTrace } from './trace';

const DAY = 24 * 60 * 60 * 1000;

// Plantain: no other suite trades it, so no stray demand matches these lots.
function plantainLot(phone: string) {
  const farmer = registerFarmer({ phone, name: 'Remove Farmer', regionCode: 'ASHANTI' });
  const lot = registerLot({ farmerId: farmer.id, commodityCode: 'PLANTAIN', unitCode: 'BUNCH', unitQty: 10, declaredBand: 'B' });
  return { farmer, lot };
}
function plantainDemand(kg: number) {
  const now = Date.now();
  return createDemand({
    buyerId: testBuyer().id,
    commodityCode: 'PLANTAIN',
    quantityKg: kg,
    minBand: 'C',
    basePricePerKg: 300,
    windowStart: now,
    windowEnd: now + 2 * DAY,
    regionCode: 'ASHANTI',
  });
}

describe('removing a listing', () => {
  it('takes an unsold lot off the market and records it on the trace', () => {
    const { farmer, lot } = plantainLot('+233207490001');
    const removed = withdrawLot(lot.id, farmer.id);
    expect(removed.status).toBe('withdrawn');
    expect(removed.remainingKg).toBe(0);
    expect(getTrace(lot.id).at(-1)).toMatchObject({ type: 'LOT_WITHDRAWN', payload: { withdrawnKg: 120 } });
    expect(withdrawLot(lot.id, farmer.id).status).toBe('withdrawn'); // removing twice is harmless
  });

  it('closes open offers first, giving the buyer their kilograms back', () => {
    const { farmer, lot } = plantainLot('+233207490002');
    const demand = plantainDemand(60);
    const offer = openOfferFor(farmer.id, lot.id);
    expect(offer).toBeDefined();
    expect(getDemand(demand.id).remainingKg).toBe(0); // held by the open thread

    withdrawLot(lot.id, farmer.id);
    expect(getOffer(offer!.id).status).toBe('withdrawn');
    expect(getDemand(demand.id).remainingKg).toBe(60); // free to match another farmer
    expect(getLot(lot.id).status).toBe('withdrawn');
    // The buyer is told their offer ended with the listing.
    const told = db.select().from(buyerNotifications).where(eq(buyerNotifications.lotId, lot.id)).all();
    expect(told.map((n) => n.templateKey)).toContain('notif.listingClosed');
  });

  it("refuses another farmer's lot, and a lot with an accepted order", () => {
    // The previous test left its 60kg request open again; it would bid on this
    // listing first and (one open thread per buyer per listing) block the 120kg one.
    const plantain = getCommodityByCode('PLANTAIN');
    db.update(demands)
      .set({ status: 'cancelled' })
      .where(and(eq(demands.commodityId, plantain.id), inArray(demands.status, ['open', 'partially_matched'])))
      .run();

    const { farmer, lot } = plantainLot('+233207490003');
    const other = registerFarmer({ phone: '+233207490004', name: 'Other Farmer', regionCode: 'ASHANTI' });
    expect(() => withdrawLot(lot.id, other.id)).toThrow(/Not your lot/);

    plantainDemand(120);
    const offer = openOfferFor(farmer.id, lot.id)!;
    expect(offer.units).toBe(10); // the whole listing
    acceptProposal(offer.id, 'farmer', farmer.id);
    // Nothing left on it, so the listing has left the market with its order.
    expect(getLot(lot.id).status).toBe('contracted');
    expect(() => withdrawLot(lot.id, farmer.id)).toThrow(/already has an order/);
  });
});
