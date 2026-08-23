import {
  acceptOfferAndHold,
  AVAILABLE_LOCALES,
  bestBand,
  config,
  contractPriceTerms,
  db,
  DomainError,
  formatGhs,
  getCommodityById,
  getContract,
  getFarmerById,
  listNotificationsForPhone,
  listVoiceCallsForPhone,
  quoteTransportOptions,
  schema,
  scoreBreakdownSchema,
  t,
} from '@ftm/core';
import { desc, eq, gt, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const simulateSchema = z.object({ contractId: z.string() });
const previewSchema = z.object({ contractId: z.string(), locale: z.string().default('en') });

/**
 * The AI Intent & Auto-Matching Engine's window: the live intent feed (buy
 * orders vs produce listings), the engine's matches with scores and logistics
 * estimates, and the multilingual alert simulation.
 */
export async function engineRoutes(app: FastifyInstance): Promise<void> {
  app.get('/engine/feed', { preHandler: [app.authBuyer] }, async (req) => {
    const buyerId = req.user.sub;

    const lots = db
      .select()
      .from(schema.lots)
      .where(inArray(schema.lots.status, ['registered', 'matched']))
      .orderBy(desc(schema.lots.createdAt))
      .all()
      .filter((l) => l.remainingKg > 0)
      .slice(0, 20)
      .map((l) => {
        const commodity = getCommodityById(l.commodityId);
        const farmer = getFarmerById(l.farmerId);
        return {
          lotCode: l.lotCode,
          commodityName: t('en', commodity.nameKey),
          remainingKg: l.remainingKg,
          declaredBand: l.declaredBand,
          regionCode: l.regionCode,
          readyDate: l.readyDate,
          farmerName: farmer?.name ?? null,
          createdAt: l.createdAt,
        };
      });

    const demands = db
      .select()
      .from(schema.demands)
      .where(gt(schema.demands.remainingKg, 0))
      .orderBy(desc(schema.demands.createdAt))
      .all()
      .filter((d) => d.status === 'open' || d.status === 'partially_matched')
      .slice(0, 20)
      .map((d) => {
        const commodity = getCommodityById(d.commodityId);
        const terms = JSON.parse(d.priceTerms) as Record<string, number>;
        return {
          commodityName: t('en', commodity.nameKey),
          remainingKg: d.remainingKg,
          minBand: d.minBand,
          minPricePerKg: terms[d.minBand] ?? 0,
          windowStart: d.windowStart,
          windowEnd: d.windowEnd,
          regionCode: d.regionCode,
          mine: d.buyerId === buyerId,
          createdAt: d.createdAt,
        };
      });

    const matches = db
      .select()
      .from(schema.contracts)
      .where(eq(schema.contracts.buyerId, buyerId))
      .orderBy(desc(schema.contracts.createdAt))
      .all()
      .slice(0, 8)
      .map((c) => {
        const match = db.select().from(schema.matches).where(eq(schema.matches.id, c.matchId)).get();
        const breakdown = match ? scoreBreakdownSchema.parse(JSON.parse(match.scoreBreakdown)) : null;
        const commodity = getCommodityById(c.commodityId);
        const farmer = getFarmerById(c.farmerId);
        const lot = db.select().from(schema.lots).where(eq(schema.lots.id, c.lotId)).get();
        let logisticsEstimate: number | null = null;
        try {
          logisticsEstimate = quoteTransportOptions(c.id)[0]?.quoteAmount ?? null;
        } catch {
          logisticsEstimate = null;
        }
        const terms = contractPriceTerms(c);
        return {
          contractId: c.id,
          state: c.state,
          scorePct: match ? Math.round(match.score * 100) : null,
          commodityName: t('en', commodity.nameKey),
          quantityKg: c.quantityKg,
          bestPricePerKg: terms[bestBand(terms)] ?? 0,
          holdAmount: c.holdAmount,
          farmerName: farmer?.name ?? null,
          lotCode: lot?.lotCode ?? null,
          distanceKm: breakdown?.distanceKm ?? null,
          logisticsEstimate,
          createdAt: c.createdAt,
        };
      });

    return { lots, demands, matches, simulateEnabled: config.PAYMENT_PROVIDER === 'mock' };
  });

  // The Voice & SMS simulation: render the exact alert templates for a match
  // in any supported locale — what a Twi/Ewe/Dagbani farmer would receive.
  app.get('/engine/alert-preview', { preHandler: [app.authBuyer] }, async (req) => {
    const { contractId, locale } = previewSchema.parse(req.query ?? {});
    const contract = getContract(contractId);
    if (contract.buyerId !== req.user.sub) throw new DomainError('Not your contract', 'FORBIDDEN', 403);
    const farmer = getFarmerById(contract.farmerId);
    const commodity = getCommodityById(contract.commodityId);
    const buyer = db.select().from(schema.buyers).where(eq(schema.buyers.id, contract.buyerId)).get();
    const terms = contractPriceTerms(contract);
    const commodityName = t(locale, commodity.nameKey);

    const sms = t(locale, 'sms.newOffer', {
      kg: contract.quantityKg,
      commodity: commodityName,
      price: formatGhs(terms[bestBand(terms)] ?? 0),
      code: config.USSD_SHORTCODE,
    });
    const voice = [
      t(locale, 'voice.offer.intro', {
        kg: contract.quantityKg,
        commodity: commodityName,
        buyer: buyer?.company ?? buyer?.name ?? '',
        amount: formatGhs(contract.holdAmount),
      }),
      t(locale, 'voice.offer.menu'),
    ];

    const smsRecord = farmer
      ? listNotificationsForPhone(farmer.phone, 20).find((n) => n.templateKey === 'sms.newOffer' && n.contractId === contractId)
      : undefined;
    const callRecord = farmer
      ? listVoiceCallsForPhone(farmer.phone, 20).find((c) => c.flow === 'offer' && c.contractId === contractId)
      : undefined;

    return {
      locales: AVAILABLE_LOCALES,
      locale,
      reviewNote: locale !== 'en',
      farmerName: farmer?.name ?? null,
      farmerPhone: farmer?.phone ?? null,
      sms,
      voice,
      smsStatus: smsRecord?.status ?? null,
      callStatus: callRecord?.status ?? null,
    };
  });

  // Demo-only: play the farmer's "press 1" from the portal. Gated to mock
  // payment mode — in anything real, only the farmer accepts (USSD/IVR).
  app.post('/engine/simulate-accept', { preHandler: [app.authBuyer] }, async (req) => {
    if (config.PAYMENT_PROVIDER !== 'mock') {
      throw new DomainError('Simulated acceptance is available in demo (mock) mode only', 'DEMO_ONLY', 403);
    }
    const { contractId } = simulateSchema.parse(req.body);
    const contract = getContract(contractId);
    if (contract.buyerId !== req.user.sub) throw new DomainError('Not your contract', 'FORBIDDEN', 403);
    const accepted = await acceptOfferAndHold(contractId, contract.farmerId);
    return { contract: { id: accepted.id, state: accepted.state } };
  });
}
