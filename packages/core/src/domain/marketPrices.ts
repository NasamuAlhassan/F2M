import { asc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { marketPrices, type MarketPrice } from '../db/schema';
import { observePrice } from './priceIntel';
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
  // The same quote also joins the price history, so it shows up in trends (D-053).
  observePrice({
    commodityId: commodity.id,
    regionCode: input.regionCode,
    market: input.market,
    pricePerKg: input.pricePerKg,
    source: 'market',
    dataset: 'manual',
    refId: `manual:${commodity.code}:${input.market}:${new Date(values.recordedAt).toISOString().slice(0, 10)}`,
    observedAt: values.recordedAt,
  });
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
