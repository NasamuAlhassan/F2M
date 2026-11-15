import {
  acceptOfferAndHold,
  acceptOfferThread,
  describeOffer,
  getOffer,
  listOffersForBuyer,
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
  getRegion,
  listNotificationsForPhone,
  listVoiceCallsForPhone,
  quoteTransportOptions,
  schema,
  scoreBreakdownSchema,
  isLocaleReviewed,
  t,
  tDraft,
} from '@ftm/core';
import { desc, eq, gt, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

// Phase 1: offers are threads; contractId stays accepted for the older drawer until the web moves.
const simulateSchema = z.object({ offerId: z.string().optional(), contractId: z.string().optional() });
const previewSchema = z.object({ offerId: z.string().optional(), contractId: z.string().optional(), locale: z.string().default('en') });

/**
 * The AI Intent & Auto-Matching Engine's window: the live intent feed (buy
 * orders vs produce listings), the engine's matches with scores and logistics
 * estimates, and the multilingual alert simulation.
 */
export async function engineRoutes(app: FastifyInstance): Promise<void> {
  app.get('/engine/feed', { preHandler: [app.authBuyer] }, async (req) => {
    const buyerId = req.user.sub;

    const lots = await Promise.all((await db
              .select()
              .from(schema.lots)
              .where(inArray(schema.lots.status, ['registered', 'matched']))
              .orderBy(desc(schema.lots.createdAt)))
          .filter((l) => l.remainingKg > 0)
          .slice(0, 20)
          .map(async (l) => {
            const commodity = getCommodityById(l.commodityId);
            const farmer = await getFarmerById(l.farmerId);
            return {
              lotCode: l.lotCode,
              commodityName: t('en', commodity.nameKey),
              remainingKg: l.remainingKg,
              declaredBand: l.declaredBand,
              regionCode: l.regionCode,
              regionName: t('en', getRegion(l.regionCode).nameKey),
              readyDate: l.readyDate,
              farmerName: farmer?.name ?? null,
              createdAt: l.createdAt,
            };
          }));

    const demands = (await db
          .select()
          .from(schema.demands)
          .where(gt(schema.demands.remainingKg, 0))
          .orderBy(desc(schema.demands.createdAt)))
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
          regionName: t('en', getRegion(d.regionCode).nameKey),
          mine: d.buyerId === buyerId,
          createdAt: d.createdAt,
        };
      });

    const matches = await Promise.all((await db
              .select()
              .from(schema.contracts)
              .where(eq(schema.contracts.buyerId, buyerId))
              .orderBy(desc(schema.contracts.createdAt)))
          .slice(0, 8)
          .map(async (c) => {
            const match = (await db.select().from(schema.matches).where(eq(schema.matches.id, c.matchId)))[0];
            const breakdown = match ? scoreBreakdownSchema.parse(JSON.parse(match.scoreBreakdown)) : null;
            const commodity = getCommodityById(c.commodityId);
            const farmer = await getFarmerById(c.farmerId);
            const lot = (await db.select().from(schema.lots).where(eq(schema.lots.id, c.lotId)))[0];
            let logisticsEstimate: number | null = null;
            try {
              logisticsEstimate = (await quoteTransportOptions(c.id))[0]?.quoteAmount ?? null;
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
          }));

    const offers = await Promise.all((await listOffersForBuyer(buyerId, 'open')).map((o) => describeOffer(o)));
    return { lots, demands, matches, offers, simulateEnabled: config.PAYMENT_PROVIDER === 'mock' && config.simulatorEnabled };
  });

  // The Voice & SMS simulation: render the exact alert templates for a match
  // in any supported locale — what a Twi/Ewe/Dagbani farmer would receive.
  app.get('/engine/alert-preview', { preHandler: [app.authBuyer] }, async (req) => {
    const { offerId, contractId: legacyContractId, locale } = previewSchema.parse(req.query ?? {});
    if (offerId) {
      const offer = await getOffer(offerId);
      if (offer.buyerId !== req.user.sub) throw new DomainError('Not your offer', 'FORBIDDEN', 403);
      const v = await describeOffer(offer);
      const farmer = await getFarmerById(offer.farmerId);
      const params = {
        buyer: v.buyer.company ?? v.buyer.name,
        units: v.current.units,
        unit: tDraft(locale, `unit.${v.lot.unitCode}`),
        commodity: tDraft(locale, `commodity.${v.lot.commodityCode}`),
        price: formatGhs(v.current.pricePerUnit),
        total: formatGhs(v.current.total),
        code: config.USSD_SHORTCODE,
      };
      const smsRecord = farmer ? (await listNotificationsForPhone(farmer.phone, 20)).find((n) => n.templateKey === 'sms.bidReceived' && n.lotId === offer.lotId) : undefined;
      const callRecord = farmer ? (await listVoiceCallsForPhone(farmer.phone, 20)).find((c) => c.flow === 'bid' && c.offerId === offer.id) : undefined;
      return {
        locales: AVAILABLE_LOCALES.map((l) => ({ ...l, reviewed: isLocaleReviewed(l.code) })),
        locale,
        reviewNote: !isLocaleReviewed(locale),
        farmerName: farmer?.name ?? null,
        farmerPhone: farmer?.phone ?? null,
        sms: tDraft(locale, 'sms.bidReceived', params),
        voice: [tDraft(locale, 'voice.bid.intro', params), tDraft(locale, 'voice.bid.menu2', params)],
        smsStatus: smsRecord?.status ?? null,
        callStatus: callRecord?.status ?? null,
      };
    }
    if (!legacyContractId) throw new DomainError('Say which offer to preview', 'VALIDATION', 400);
    const contractId = legacyContractId;
    const contract = await getContract(contractId);
    if (contract.buyerId !== req.user.sub) throw new DomainError('Not your contract', 'FORBIDDEN', 403);
    const farmer = await getFarmerById(contract.farmerId);
    const commodity = getCommodityById(contract.commodityId);
    const buyer = (await db.select().from(schema.buyers).where(eq(schema.buyers.id, contract.buyerId)))[0];
    const terms = contractPriceTerms(contract);
    // tDraft: this drawer is the sanctioned PREVIEW surface (D-040) — it shows
    // machine-drafted text the review gate keeps off real farmer channels.
    const commodityName = tDraft(locale, commodity.nameKey);

    const sms = tDraft(locale, 'sms.newOffer', {
      kg: contract.quantityKg,
      commodity: commodityName,
      price: formatGhs(terms[bestBand(terms)] ?? 0),
      code: config.USSD_SHORTCODE,
    });
    const voice = [
      tDraft(locale, 'voice.offer.intro', {
        kg: contract.quantityKg,
        commodity: commodityName,
        buyer: buyer?.company ?? buyer?.name ?? '',
        amount: formatGhs(contract.holdAmount),
      }),
      tDraft(locale, 'voice.offer.menu'),
    ];

    const smsRecord = farmer
      ? (await listNotificationsForPhone(farmer.phone, 20)).find((n) => n.templateKey === 'sms.newOffer' && n.contractId === contractId)
      : undefined;
    const callRecord = farmer
      ? (await listVoiceCallsForPhone(farmer.phone, 20)).find((c) => c.flow === 'offer' && c.contractId === contractId)
      : undefined;

    return {
      locales: AVAILABLE_LOCALES.map((l) => ({ ...l, reviewed: isLocaleReviewed(l.code) })),
      locale,
      reviewNote: !isLocaleReviewed(locale),
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
    // Demo-only (D-029): a buyer must never accept on a farmer's behalf where
    // money is real, nor outside the closed simulator test group (D-047).
    if (config.PAYMENT_PROVIDER !== 'mock' || !config.simulatorEnabled) {
      throw new DomainError('Simulated acceptance is available in simulator mode with simulated payments only', 'DEMO_ONLY', 403);
    }
    const { offerId, contractId } = simulateSchema.parse(req.body ?? {});
    if (offerId) {
      const offer = await getOffer(offerId);
      if (offer.buyerId !== req.user.sub) throw new DomainError('Not your offer', 'FORBIDDEN', 403);
      const { contract } = await acceptOfferThread(offerId, 'farmer', offer.farmerId, 'system');
      return { contract: { id: contract.id, state: contract.state } };
    }
    if (!contractId) throw new DomainError('Say which offer to accept', 'VALIDATION', 400);
    const contract = await getContract(contractId);
    if (contract.buyerId !== req.user.sub) throw new DomainError('Not your contract', 'FORBIDDEN', 403);
    const accepted = await acceptOfferAndHold(contractId, contract.farmerId);
    return { contract: { id: accepted.id, state: accepted.state } };
  });
}
