import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '../db/client';
import { priceObservations } from '../db/schema';
import { acceptFor, testBuyer } from '../testing/fixtures';
import { createDemand } from './demands';
import { registerFarmer } from './farmers';
import { registerLot, updateLot } from './lots';
import { upsertMarketPrice } from './marketPrices';
import { placeBid } from './offers';
import { getCommodityByCode } from './registries';
import { estimatePrice } from './priceIntel';

const DAY = 24 * 60 * 60 * 1000;
const seen = (code: string, source: string) =>
  db
    .select()
    .from(priceObservations)
    .where(and(eq(priceObservations.commodityId, getCommodityByCode(code).id), eq(priceObservations.source, source as 'ask')))
    .all();

/**
 * "Always updating" (D-053): nobody has to enter a price. Listing, bidding,
 * agreeing and requesting each leave a price behind, and the engine reads them.
 */
describe('prices that arrive by themselves', () => {
  it('a listing’s asking price, and a change to it, become one ask observation', () => {
    const farmer = registerFarmer({ phone: '+233207530001', name: 'Signal Farmer', regionCode: 'UPPER_EAST' });
    const lot = registerLot({ farmerId: farmer.id, commodityCode: 'SOYBEAN', unitCode: 'BAG_100KG', unitQty: 5, declaredBand: 'B', askingPricePerUnit: 40_000 });
    let asks = seen('SOYBEAN', 'ask').filter((o) => o.refId === lot.id);
    expect(asks).toHaveLength(1);
    expect(asks[0]).toMatchObject({ pricePerKg: 400, regionCode: 'UPPER_EAST' });

    updateLot(lot.id, farmer.id, { askingPricePerUnit: 45_000 });
    asks = seen('SOYBEAN', 'ask').filter((o) => o.refId === lot.id);
    expect(asks).toHaveLength(1);
    expect(asks[0]!.pricePerKg).toBe(450);
  });

  it('a listing with no asking price leaves nothing behind', () => {
    const farmer = registerFarmer({ phone: '+233207530002', name: 'No Price Farmer', regionCode: 'UPPER_EAST' });
    const lot = registerLot({ farmerId: farmer.id, commodityCode: 'SOYBEAN', unitCode: 'BAG_100KG', unitQty: 2, declaredBand: 'B' });
    expect(seen('SOYBEAN', 'ask').filter((o) => o.refId === lot.id)).toHaveLength(0);
  });

  it('a bid is an offer observation, and the agreed price is a deal', async () => {
    const farmer = registerFarmer({ phone: '+233207530003', name: 'Deal Farmer', regionCode: 'NORTHERN' });
    const lot = registerLot({ farmerId: farmer.id, commodityCode: 'COWPEA', unitCode: 'BAG_100KG', unitQty: 10, declaredBand: 'B', askingPricePerUnit: 120_000 });
    const offer = placeBid({ buyerId: testBuyer().id, lotId: lot.id, units: 4, pricePerUnit: 110_000 });
    const bids = seen('COWPEA', 'offer').filter((o) => o.refId === offer.id);
    expect(bids).toHaveLength(1);
    expect(bids[0]!.pricePerKg).toBe(1100);

    await acceptFor(farmer.id, lot.id);
    const deals = seen('COWPEA', 'deal').filter((o) => o.refId === offer.id);
    expect(deals).toHaveLength(1);
    expect(deals[0]!.pricePerKg).toBe(1100);
  });

  it('a buyer request records what the buyer will pay for the lowest grade accepted', () => {
    const now = Date.now();
    const demand = createDemand({
      buyerId: testBuyer().id,
      commodityCode: 'ONION',
      quantityKg: 200,
      minBand: 'B',
      basePricePerKg: 700,
      windowStart: now,
      windowEnd: now + 2 * DAY,
      regionCode: 'GREATER_ACCRA',
    });
    const asks = seen('ONION', 'request').filter((o) => o.refId === demand.id);
    expect(asks).toHaveLength(1);
    expect(asks[0]!.regionCode).toBe('GREATER_ACCRA');
  });

  it('a market quote also lands in the history, so it can show a trend', () => {
    upsertMarketPrice({ commodityCode: 'PEPPER', market: 'Techiman', regionCode: 'BONO_EAST', pricePerKg: 910 });
    const quotes = seen('PEPPER', 'market').filter((o) => o.dataset === 'manual');
    expect(quotes).toHaveLength(1);
    expect(quotes[0]!.pricePerKg).toBe(910);
  });

  it('then the estimate for that crop reflects them', () => {
    const e = estimatePrice(getCommodityByCode('COWPEA').id)!;
    expect(e.basis.deal).toBeGreaterThanOrEqual(1);
    expect(e.pricePerKg).toBeGreaterThan(900); // pulled toward the 1,100 deal, away from the 950 placeholder
  });
});
