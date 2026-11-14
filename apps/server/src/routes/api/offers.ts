import {
  acceptOfferThread,
  counterOffer,
  db,
  describeOffer,
  DomainError,
  getCommodityById,
  getFarmerById,
  getOffer,
  getRegion,
  haversineKm,
  listListingPhotos,
  listOpenRequests,
  listOffersForBuyer,
  listOffersForFarmer,
  offerOnRequest,
  placeBid,
  priceTermsSchema,
  rejectOffer,
  resolvePoint,
  schema,
  t,
  withdrawOffer,
  type GradeBand,
  type Offer,
  type Party,
} from '@ftm/core';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

/**
 * Negotiation (Phase 1, docs/PHASE1.md). Buyers bid on listings and answer
 * counters at /offers; farmers answer at /farmer/offers and offer on buyer
 * requests at /farmer/requests. Each side only ever sees and moves its own
 * threads; the phone channels (USSD, voice) call the same core functions.
 */

const proposalSchema = z.object({
  units: z.number().int().positive(),
  pricePerUnit: z.number().int().positive(),
});
const counterSchema = z.object({
  units: z.number().int().positive().optional(),
  pricePerUnit: z.number().int().positive(),
});
const statusQuery = z.object({ status: z.enum(['open', 'closed']).optional() });

const photoUrl = (lotId: string): string | null => {
  const photo = listListingPhotos(lotId)[0];
  return photo ? `/${photo.path}` : null;
};
export const offerView = (offer: Offer) => describeOffer(offer, { photoUrl });

function ownedOffer(req: FastifyRequest, party: Party, id: string): Offer {
  const offer = getOffer(id);
  const owner = party === 'buyer' ? offer.buyerId : offer.farmerId;
  if (owner !== req.user.sub) throw new DomainError('Not your offer', 'FORBIDDEN', 403);
  return offer;
}

function moveRoutes(app: FastifyInstance, prefix: string, party: Party, guard: typeof app.authBuyer): void {
  app.get(`${prefix}/offers`, { preHandler: [guard] }, async (req) => {
    const { status } = statusQuery.parse(req.query ?? {});
    const list = party === 'buyer' ? listOffersForBuyer(req.user.sub, status) : listOffersForFarmer(req.user.sub, status);
    return { offers: list.map(offerView) };
  });
  app.get(`${prefix}/offers/:id`, { preHandler: [guard] }, async (req) => {
    const { id } = req.params as { id: string };
    return { offer: offerView(ownedOffer(req, party, id)) };
  });
  app.post(`${prefix}/offers/:id/counter`, { preHandler: [guard] }, async (req) => {
    const { id } = req.params as { id: string };
    ownedOffer(req, party, id);
    return { offer: offerView(counterOffer(id, party, req.user.sub, counterSchema.parse(req.body ?? {}))) };
  });
  app.post(`${prefix}/offers/:id/accept`, { preHandler: [guard] }, async (req) => {
    const { id } = req.params as { id: string };
    ownedOffer(req, party, id);
    const { offer, contract } = await acceptOfferThread(id, party, req.user.sub);
    return { offer: offerView(offer), contract: { id: contract.id, state: contract.state } };
  });
  app.post(`${prefix}/offers/:id/reject`, { preHandler: [guard] }, async (req) => {
    const { id } = req.params as { id: string };
    ownedOffer(req, party, id);
    return { offer: offerView(rejectOffer(id, party, req.user.sub)) };
  });
  app.post(`${prefix}/offers/:id/withdraw`, { preHandler: [guard] }, async (req) => {
    const { id } = req.params as { id: string };
    ownedOffer(req, party, id);
    return { offer: offerView(withdrawOffer(id, party, req.user.sub)) };
  });
}

export async function offerRoutes(app: FastifyInstance): Promise<void> {
  // ── buyer ──
  app.post('/lots/:lotId/bids', { preHandler: [app.authBuyer] }, async (req, reply) => {
    const { lotId } = req.params as { lotId: string };
    const offer = placeBid({ buyerId: req.user.sub, lotId, ...proposalSchema.parse(req.body ?? {}) });
    return reply.code(201).send({ offer: offerView(offer) });
  });
  moveRoutes(app, '', 'buyer', app.authBuyer);

  // ── farmer ──
  moveRoutes(app, '/farmer', 'farmer', app.authFarmer);

  // Open buyer requests, nearest first — what the market wants right now.
  app.get('/farmer/requests', { preHandler: [app.authFarmer] }, async (req) => {
    const farmer = getFarmerById(req.user.sub)!;
    const here = resolvePoint(farmer.gpsLat, farmer.gpsLng, farmer.regionCode);
    const now = Date.now();
    const requests = listOpenRequests({ now })
      .map((d) => {
        const commodity = getCommodityById(d.commodityId);
        const buyer = db.select().from(schema.buyers).where(eq(schema.buyers.id, d.buyerId)).get();
        const terms = priceTermsSchema.parse(JSON.parse(d.priceTerms));
        return {
          id: d.id,
          commodityCode: commodity.code,
          commodityName: t('en', commodity.nameKey),
          remainingKg: d.remainingKg,
          minBand: d.minBand,
          targetPricePerKg: terms[d.minBand as GradeBand] ?? null,
          windowStart: d.windowStart,
          windowEnd: d.windowEnd,
          regionCode: d.regionCode,
          regionName: t('en', getRegion(d.regionCode).nameKey),
          buyerName: buyer?.company ?? buyer?.name ?? 'Buyer',
          distanceKm: Math.round(haversineKm(here, resolvePoint(d.gpsLat, d.gpsLng, d.regionCode))),
        };
      })
      .sort((a, b) => a.distanceKm - b.distanceKm);
    return { requests };
  });

  app.post('/farmer/requests/:id/offers', { preHandler: [app.authFarmer] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = proposalSchema.extend({ lotId: z.string().min(1) }).parse(req.body ?? {});
    const offer = offerOnRequest({ farmerId: req.user.sub, demandId: id, ...body });
    return reply.code(201).send({ offer: offerView(offer) });
  });
}
