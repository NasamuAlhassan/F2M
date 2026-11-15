import {
  config,
  getCommodityByCode,
  guidanceText,
  ingestFeed,
  latestByMarket,
  listMarketPrices,
  listUnits,
  marketOverview,
  priceGuidance,
  priceSeries,
  priceTrend,
  seasonalOutlook,
  supplyDemandByRegion,
  estimatePrice,
  t,
  trendText,
  DomainError,
} from '@ftm/core';
import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const regionQuery = z.object({ regionCode: z.string().optional() });

/** The unit a crop is usually sold in — the biggest formal one — so prices read "per bag", not only "per kg". */
function primaryUnit(commodityId: string) {
  const all = listUnits(commodityId);
  const formal = all.filter((u) => !u.isInformal);
  const pool = formal.length > 0 ? formal : all;
  const unit = [...pool].sort((a, b) => b.kgPerUnit - a.kgPerUnit)[0];
  return unit ? { code: unit.code, name: t('en', unit.nameKey), kgPerUnit: unit.kgPerUnit } : null;
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * Prices (D-053) — public, like the notice board at the market gate. Everything
 * is computed from the price history; no endpoint here accepts a price except
 * the token-guarded feed.
 */
export async function priceRoutes(app: FastifyInstance): Promise<void> {
  // The whole market at a glance: price, trend, sparkline, and who has / wants what.
  app.get('/prices/overview', async (req) => {
    const { regionCode } = regionQuery.parse(req.query);
    const now = Date.now();
    const rows = (await marketOverview({ regionCode, now })).map((o) => {
      const commodity = getCommodityByCode(o.commodityCode);
      return {
        ...o,
        commodityName: t('en', commodity.nameKey),
        unit: primaryUnit(commodity.id),
        trendText: trendText(o.trend),
      };
    });
    return { generatedAt: now, crops: rows };
  });

  // One crop in depth: this week's picture, the long history, the seasons, the markets.
  app.get<{ Params: { code: string } }>('/prices/crop/:code', async (req) => {
    const { regionCode } = regionQuery.parse(req.query);
    const commodity = getCommodityByCode(req.params.code.toUpperCase());
    const now = Date.now();
    const outlook = await seasonalOutlook(commodity.id, now);
    return {
      commodityCode: commodity.code,
      commodityName: t('en', commodity.nameKey),
      unit: primaryUnit(commodity.id),
      estimate: await estimatePrice(commodity.id, { regionCode, now }),
      trend30: await priceTrend(commodity.id, { regionCode, windowDays: 30, now }),
      trend90: await priceTrend(commodity.id, { regionCode, windowDays: 90, now }),
      recent: await priceSeries(commodity.id, { regionCode, days: 120, bucketDays: 7, now }),
      history: await priceSeries(commodity.id, { regionCode, days: 365 * 6, bucketDays: 30, now }),
      markets: await (async () => {
              // Market reports first; the seed's reference quotes fill in markets nobody has reported.
              const reported = (await latestByMarket(commodity.id, now)).map((m) => ({ ...m, kind: 'report' as const }));
              const named = new Set(reported.map((m) => m.market));
              const reference = (await listMarketPrices(commodity.id))
                .filter((p) => !named.has(p.market))
                .map((p) => ({ market: p.market, regionCode: p.regionCode, pricePerKg: p.pricePerKg, observedAt: p.recordedAt, source: 'reference' as const, kind: 'reference' as const }));
              return [...reported, ...reference];
            })(),
      outlook: outlook
        ? {
            ...outlook,
            text:
              Math.abs(outlook.twoMonths) >= 0.05
                ? t('en', outlook.twoMonths > 0 ? 'price.outlook.rise' : 'price.outlook.fall', { pct: Math.round(Math.abs(outlook.twoMonths) * 100) })
                : null,
          }
        : null,
      whereItIs: await supplyDemandByRegion(commodity.id, now),
      generatedAt: now,
    };
  });

  // "Is this a sensible price?" — the same answer the phone and the call give.
  app.get('/prices/check', async (req) => {
    const q = z
      .object({
        commodity: z.string().min(1),
        unit: z.string().optional(),
        regionCode: z.string().optional(),
        price: z.coerce.number().int().positive().optional(), // pesewas, per unit if `unit` is given, else per kg
        side: z.enum(['sell', 'buy']).default('sell'),
        locale: z.string().default('en'),
      })
      .parse(req.query);
    const g = await priceGuidance({
          commodityCode: q.commodity.toUpperCase(),
          unitCode: q.unit,
          regionCode: q.regionCode,
          price: q.price ?? null,
          side: q.side,
        });
    return {
      ...g,
      message: guidanceText(g, q.locale),
      trendText: trendText(g.trend, q.locale),
      ageDays: g.estimate ? Math.max(0, Math.round((Date.now() - g.estimate.newestAt) / DAY)) : null,
    };
  });

  // A partner's or collector's current prices, in the shape of docs/PRICES.md.
  // Closed unless PRICE_INGEST_TOKEN is set, and the token is compared in constant time.
  app.post('/feeds/prices', async (req, reply) => {
    const token = config.PRICE_INGEST_TOKEN;
    const sent = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const ok = token && sent.length === token.length && timingSafeEqual(Buffer.from(sent), Buffer.from(token));
    if (!ok) return reply.code(token ? 401 : 404).send({ error: { code: token ? 'UNAUTHORIZED' : 'NOT_FOUND', message: token ? 'Bad token' : 'Not found' } });
    const result = await ingestFeed(req.body);
    if (result.accepted === 0) throw new DomainError('No usable price rows: ' + JSON.stringify(result.rejected.slice(0, 3)), 'NO_VALID_ROWS', 422);
    return result;
  });
}
