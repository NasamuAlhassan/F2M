import {
  createDemand,
  demandPriceTerms,
  DomainError,
  getContractByMatchId,
  getDemand,
  getFarmerById,
  getLot,
  gradeBandSchema,
  listDemandsByBuyer,
  listMatchesForDemand,
  listOffersForDemand,
  priceTermsSchema,
} from '@ftm/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { offerView } from './offers';

const createDemandSchema = z.object({
  commodityCode: z.string(),
  quantityKg: z.number().positive().optional(),
  unitCode: z.string().optional(),
  unitQty: z.number().positive().optional(),
  minBand: gradeBandSchema,
  basePricePerKg: z.number().int().positive().optional(),
  priceTerms: priceTermsSchema.optional(),
  windowStart: z.number(),
  windowEnd: z.number(),
  regionCode: z.string(),
  gpsLat: z.number().optional(),
  gpsLng: z.number().optional(),
});

export async function demandRoutes(app: FastifyInstance): Promise<void> {
  app.post('/demands', { preHandler: [app.authBuyer] }, async (req, reply) => {
    const demand = await createDemand({ ...createDemandSchema.parse(req.body), buyerId: req.user.sub });
    return reply.code(201).send({ demand: { ...demand, priceTerms: demandPriceTerms(demand) } });
  });

  app.get('/demands', { preHandler: [app.authBuyer] }, async (req) => {
    return {
      demands: (await listDemandsByBuyer(req.user.sub)).map((d) => ({ ...d, priceTerms: demandPriceTerms(d) })),
    };
  });

  app.get('/demands/:id', { preHandler: [app.authBuyer] }, async (req) => {
    const { id } = req.params as { id: string };
    const demand = await getDemand(id);
    // A demand carries this buyer's price schedule and the full match list —
    // farmer names, regions, lot codes, scores. Being a logged-in buyer is not
    // enough; it has to be YOUR demand (same rule as ownedContract()).
    if (demand.buyerId !== req.user.sub) {
      throw new DomainError('Not your demand', 'FORBIDDEN', 403);
    }
    const matches = await Promise.all((await listMatchesForDemand(id)).map(async (m) => {
          const contract = await getContractByMatchId(m.id);
          const lot = await getLot(m.lotId);
          const farmer = await getFarmerById(lot.farmerId);
          return {
            id: m.id,
            lotId: m.lotId,
            lotCode: lot.lotCode,
            farmerName: farmer?.name ?? null,
            farmerRegion: farmer?.regionCode ?? null,
            allocatedKg: m.allocatedKg,
            score: m.score,
            breakdown: m.breakdown,
            status: m.status,
            offeredAt: m.offeredAt,
            expiresAt: m.expiresAt,
            contractId: contract?.id ?? null,
            contractState: contract?.state ?? null,
          };
        }));
    // Phase 1: the negotiations this request started or received, beside the
    // older match list (which only shows how the engine scored each lot).
    const offers = await Promise.all((await listOffersForDemand(id)).map(offerView));
    return { demand: { ...demand, priceTerms: demandPriceTerms(demand) }, matches, offers };
  });
}
