import {
  db,
  getCommodityById,
  getFarmerById,
  getRegion,
  haversineKm,
  listMarketPrices,
  resolvePoint,
  schema,
  t,
} from '@ftm/core';
import { desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

/**
 * The marketplace browse view (prototype Frame 01): every open lot as a card a
 * buyer can bid on. "Bidding" is our demand+engine model — the card's action
 * pre-fills a demand — so this endpoint only reads; no new write paths.
 */
export async function marketRoutes(app: FastifyInstance): Promise<void> {
  app.get('/market/lots', { preHandler: [app.authBuyer] }, async (req) => {
    const buyer = db.select().from(schema.buyers).where(eq(schema.buyers.id, req.user.sub)).get();
    const buyerPoint = resolvePoint(buyer?.gpsLat ?? null, buyer?.gpsLng ?? null, buyer?.regionCode ?? 'GREATER_ACCRA');
    const now = Date.now();

    const lots = db
      .select()
      .from(schema.lots)
      .where(inArray(schema.lots.status, ['registered', 'matched']))
      .orderBy(desc(schema.lots.createdAt))
      .all()
      .filter((l) => l.remainingKg > 0)
      .slice(0, 60)
      .map((l) => {
        const commodity = getCommodityById(l.commodityId);
        const farmer = getFarmerById(l.farmerId);
        const unit = db.select().from(schema.units).where(eq(schema.units.id, l.unitId)).get();
        const kgPerUnit = unit?.kgPerUnit ?? 0;

        const prices = listMarketPrices(l.commodityId);
        const marketAvgPerKg = prices.length
          ? Math.round(prices.reduce((s, p) => s + p.pricePerKg, 0) / prices.length)
          : null;
        const pricePerKg = l.askingPricePerKg ?? marketAvgPerKg;

        return {
          id: l.id,
          lotCode: l.lotCode,
          status: l.status,
          commodityCode: commodity.code,
          commodityName: t('en', commodity.nameKey),
          clockType: commodity.clockType,
          // A future ready date is a forward listing; anything ready now trades same-day.
          listingType: l.readyDate > now + 24 * 60 * 60 * 1000 ? 'FORWARD' : 'SAME_DAY',
          declaredBand: l.declaredBand,
          remainingKg: l.remainingKg,
          unitCode: unit?.code ?? null,
          unitName: unit ? t('en', unit.nameKey) : 'unit',
          kgPerUnit,
          unitsRemaining: kgPerUnit > 0 ? Math.max(1, Math.round(l.remainingKg / kgPerUnit)) : null,
          pricePerKg,
          pricePerUnit: pricePerKg !== null && kgPerUnit > 0 ? Math.round(pricePerKg * kgPerUnit) : null,
          priceSource: l.askingPricePerKg !== null ? 'asking' : marketAvgPerKg !== null ? 'market' : null,
          fairPrice: pricePerKg !== null && marketAvgPerKg !== null && pricePerKg <= marketAvgPerKg,
          farmerName: farmer?.name ?? null,
          district: farmer?.district ?? null,
          regionCode: l.regionCode,
          regionName: t('en', getRegion(l.regionCode).nameKey),
          distanceKm: Math.round(haversineKm(resolvePoint(l.gpsLat, l.gpsLng, l.regionCode), buyerPoint)),
          readyDate: l.readyDate,
          createdAt: l.createdAt,
        };
      });

    return { lots };
  });
}
