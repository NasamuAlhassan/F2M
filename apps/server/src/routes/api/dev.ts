import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sweepOnce } from '../../jobs/sweep';

const sweepSchema = z.object({ now: z.number().optional() }).default({});

/** Dev/test-only helpers — deterministic clock control for expiry tests. */
export async function devRoutes(app: FastifyInstance): Promise<void> {
  app.post('/dev/sweep', async (req) => {
    const { now } = sweepSchema.parse(req.body ?? {});
    return sweepOnce(now ?? Date.now());
  });
}
