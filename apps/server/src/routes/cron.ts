import { timingSafeEqual } from 'node:crypto';
import { config } from '@ftm/core';
import type { FastifyInstance } from 'fastify';
import { fastLaneOnce, sweepOnce } from '../jobs/sweep';

/**
 * The sweep as an endpoint (docs/HOSTING.md). On Vercel nothing runs between
 * requests, so Supabase's pg_cron calls this: every minute for the full sweep,
 * every 20 seconds for the fast lane (payments, SMS, calls). Locally the
 * timers in jobs/sweep.ts do the same work and this stays closed unless
 * CRON_SECRET is set.
 */
function authorised(header: string | undefined): boolean {
  const secret = config.CRON_SECRET;
  if (!secret || !header?.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice('Bearer '.length));
  const want = Buffer.from(secret);
  return given.length === want.length && timingSafeEqual(given, want);
}

export async function cronRoutes(app: FastifyInstance): Promise<void> {
  app.post('/cron/sweep', async (req, reply) => {
    if (!authorised(req.headers.authorization)) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    const lane = (req.body as { lane?: string } | null)?.lane;
    if (lane === 'fast') {
      await fastLaneOnce();
      return { ok: true, lane: 'fast' };
    }
    const result = await sweepOnce();
    await fastLaneOnce();
    return { ok: true, lane: 'slow', result };
  });
}
