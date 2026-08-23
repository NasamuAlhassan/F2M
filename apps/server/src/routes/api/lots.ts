import {
  getCommodityById,
  getFarmerById,
  getLot,
  getTrace,
  gradeBandSchema,
  listLotsByFarmer,
  registerLot,
  t,
} from '@ftm/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const registerLotSchema = z.object({
  farmerId: z.string(),
  commodityCode: z.string(),
  unitCode: z.string(),
  unitQty: z.number().positive(),
  declaredBand: gradeBandSchema,
  readyDate: z.number().optional(),
  askingPricePerKg: z.number().int().positive().optional(),
  gpsLat: z.number().optional(),
  gpsLng: z.number().optional(),
});

export async function lotRoutes(app: FastifyInstance): Promise<void> {
  app.post('/lots', async (req, reply) => {
    const lot = registerLot(registerLotSchema.parse(req.body));
    return reply.code(201).send({ lot });
  });

  app.get('/lots/:id', async (req) => {
    const { id } = req.params as { id: string };
    const lot = getLot(id);
    const farmer = getFarmerById(lot.farmerId);
    const commodity = getCommodityById(lot.commodityId);
    return {
      lot,
      farmer: farmer ? { id: farmer.id, name: farmer.name, phone: farmer.phone, regionCode: farmer.regionCode } : null,
      commodity: { code: commodity.code, name: t('en', commodity.nameKey), clockType: commodity.clockType },
    };
  });

  app.get('/lots/:id/trace', async (req) => {
    const { id } = req.params as { id: string };
    getLot(id); // 404 on unknown lot
    return { events: getTrace(id) };
  });

  app.get('/farmers/:farmerId/lots', async (req) => {
    const { farmerId } = req.params as { farmerId: string };
    return { lots: listLotsByFarmer(farmerId) };
  });
}
