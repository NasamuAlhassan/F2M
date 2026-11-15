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
async function plantainLot(phone: string) {
  const farmer = await registerFarmer({ phone, name: 'Remove Farmer', regionCode: 'ASHANTI' });
  const lot = await registerLot({ farmerId: farmer.id, commodityCode: 'PLANTAIN', unitCode: 'BUNCH', unitQty: 10, declaredBand: 'B' });
  return { farmer, lot };
}
async function plantainDemand(kg: number) {
  const now = Date.now();
  return createDemand({
    buyerId: (await testBuyer()).id,
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
  it('takes an unsold lot off the market and records it on the trace', async () => {
    const { farmer, lot } = await plantainLot('+233207490001');
    const removed = await withdrawLot(lot.id, farmer.id);
    expect(removed.status).toBe('withdrawn');
    expect(removed.remainingKg).toBe(0);
    expect((await getTrace(lot.id)).at(-1)).toMatchObject({ type: 'LOT_WITHDRAWN', payload: { withdrawnKg: 120 } });
    expect((await withdrawLot(lot.id, farmer.id)).status).toBe('withdrawn'); // removing twice is harmless
  });

  it('closes open offers first, giving the buyer their kilograms back', async () => {
    const { farmer, lot } = await plantainLot('+233207490002');
    const demand = await plantainDemand(60);
    const offer = await openOfferFor(farmer.id, lot.id);
    expect(offer).toBeDefined();
    expect((await getDemand(demand.id)).remainingKg).toBe(0); // held by the open thread

    await withdrawLot(lot.id, farmer.id);
    expect((await getOffer(offer!.id)).status).toBe('withdrawn');
    expect((await getDemand(demand.id)).remainingKg).toBe(60); // free to match another farmer
    expect((await getLot(lot.id)).status).toBe('withdrawn');
    // The buyer is told their offer ended with the listing.
    const told = (await db.select().from(buyerNotifications).where(eq(buyerNotifications.lotId, lot.id)));
    expect(told.map((n) => n.templateKey)).toContain('notif.listingClosed');
  });

  it("refuses another farmer's lot, and a lot with an accepted order", async () => {
    // The previous test left its 60kg request open again; it would bid on this
    // listing first and (one open thread per buyer per listing) block the 120kg one.
    const plantain = getCommodityByCode('PLANTAIN');
    (await db.update(demands)
            .set({ status: 'cancelled' })
            .where(and(eq(demands.commodityId, plantain.id), inArray(demands.status, ['open', 'partially_matched']))));

    const { farmer, lot } = await plantainLot('+233207490003');
    const other = await registerFarmer({ phone: '+233207490004', name: 'Other Farmer', regionCode: 'ASHANTI' });
    await expect((() => withdrawLot(lot.id, other.id))()).rejects.toThrow(/Not your lot/);

    await plantainDemand(120);
    const offer = (await openOfferFor(farmer.id, lot.id))!;
    expect(offer.units).toBe(10); // the whole listing
    await acceptProposal(offer.id, 'farmer', farmer.id);
    // Nothing left on it, so the listing has left the market with its order.
    expect((await getLot(lot.id)).status).toBe('contracted');
    await expect((() => withdrawLot(lot.id, farmer.id))()).rejects.toThrow(/already has an order/);
  });
});
