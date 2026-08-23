import { asc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { marketPrices, type MarketPrice } from '../db/schema';
import { getCommodityByCode } from './registries';

export function listMarketPrices(commodityId: string): MarketPrice[] {
  return db.select().from(marketPrices).where(eq(marketPrices.commodityId, commodityId)).orderBy(asc(marketPrices.market)).all();
}

export function listAllMarketPrices(): MarketPrice[] {
  return db.select().from(marketPrices).orderBy(asc(marketPrices.market)).all();
}

/** Latest-only upsert per (commodity, market) — admin/feed entry point. */
export function upsertMarketPrice(input: {
  commodityCode: string;
  market: string;
  regionCode: string;
  pricePerKg: number; // pesewas
  recordedAt?: number;
}): MarketPrice {
  const commodity = getCommodityByCode(input.commodityCode);
  const values = {
    commodityId: commodity.id,
    market: input.market,
    regionCode: input.regionCode,
    pricePerKg: input.pricePerKg,
    recordedAt: input.recordedAt ?? Date.now(),
  };
  return db
    .insert(marketPrices)
    .values(values)
    .onConflictDoUpdate({
      target: [marketPrices.commodityId, marketPrices.market],
      set: { pricePerKg: values.pricePerKg, recordedAt: values.recordedAt, regionCode: values.regionCode },
    })
    .returning()
    .get();
}
