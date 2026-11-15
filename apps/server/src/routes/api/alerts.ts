import { createWatch, deleteWatch, getCommodityById, listWatches, t, WATCH_KINDS } from '@ftm/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const watchBody = z.object({
  commodityCode: z.string().min(1),
  regionCode: z.string().optional().nullable(),
  kind: z.enum(WATCH_KINDS),
  /** Cedis per kg, as typed. */
  ghsPerKg: z.number().positive().max(1000),
});

/**
 * "Tell me when…" (D-055): a buyer or farmer says what they want to hear about.
 * Buyers hear in the app, farmers by SMS in their own language.
 */
export async function alertRoutes(app: FastifyInstance): Promise<void> {
  app.get('/watches', { preHandler: [app.authBuyerOrFarmer] }, async (req) => {
    const role = req.user.kind === 'farmer' ? 'farmer' : 'buyer';
    return {
      watches: (await listWatches(role, req.user.sub)).map((w) => {
        const c = getCommodityById(w.commodityId);
        return {
          id: w.id,
          commodityCode: c.code,
          commodityName: t('en', c.nameKey),
          regionCode: w.regionCode,
          kind: w.kind,
          thresholdPerKg: w.thresholdPerKg,
          lastNotifiedAt: w.lastNotifiedAt,
        };
      }),
    };
  });

  app.post('/watches', { preHandler: [app.authBuyerOrFarmer] }, async (req, reply) => {
    const body = watchBody.parse(req.body);
    const role = req.user.kind === 'farmer' ? 'farmer' : 'buyer';
    const watch = await createWatch({
          role,
          ownerId: req.user.sub,
          commodityCode: body.commodityCode.toUpperCase(),
          regionCode: body.regionCode ?? null,
          kind: body.kind,
          thresholdPerKg: Math.round(body.ghsPerKg * 100),
        });
    return reply.code(201).send({ watch });
  });

  app.delete<{ Params: { id: string } }>('/watches/:id', { preHandler: [app.authBuyerOrFarmer] }, async (req) => {
    await deleteWatch(req.params.id, req.user.kind === 'farmer' ? 'farmer' : 'buyer', req.user.sub);
    return { ok: true };
  });
}
