import {
  createDemand,
  demandPriceTerms,
  getContractByMatchId,
  getDemand,
  getFarmerById,
  getLot,
  gradeBandSchema,
  listDemandsByBuyer,
  listMatchesForDemand,
  priceTermsSchema,
} from '@ftm/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

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
    const demand = createDemand({ ...createDemandSchema.parse(req.body), buyerId: req.user.sub });
    return reply.code(201).send({ demand: { ...demand, priceTerms: demandPriceTerms(demand) } });
  });

  app.get('/demands', { preHandler: [app.authBuyer] }, async (req) => {
    return {
      demands: listDemandsByBuyer(req.user.sub).map((d) => ({ ...d, priceTerms: demandPriceTerms(d) })),
    };
  });

  app.get('/demands/:id', { preHandler: [app.authBuyer] }, async (req) => {
    const { id } = req.params as { id: string };
    const demand = getDemand(id);
    const matches = listMatchesForDemand(id).map((m) => {
      const contract = getContractByMatchId(m.id);
      const lot = getLot(m.lotId);
      const farmer = getFarmerById(lot.farmerId);
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
    });
    return { demand: { ...demand, priceTerms: demandPriceTerms(demand) }, matches };
  });
}
