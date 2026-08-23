import { getFarmerByPhone, registerFarmer } from '@ftm/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const registerSchema = z.object({
  phone: z.string(),
  name: z.string().min(1),
  regionCode: z.string(),
  district: z.string().optional(),
  gpsLat: z.number().optional(),
  gpsLng: z.number().optional(),
});

export async function farmerRoutes(app: FastifyInstance): Promise<void> {
  app.post('/farmers', async (req, reply) => {
    const farmer = registerFarmer(registerSchema.parse(req.body));
    return reply.code(201).send({ farmer });
  });

  app.get('/farmers/by-phone/:phone', async (req) => {
    const { phone } = req.params as { phone: string };
    const farmer = getFarmerByPhone(phone);
    return { farmer: farmer ?? null };
  });
}
