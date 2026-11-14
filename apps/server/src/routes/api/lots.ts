import { DomainError, getLot, getTrace, listContractsForLot } from '@ftm/core';
import type { FastifyInstance } from 'fastify';

/**
 * Lots are created through the channels that know who the farmer is — USSD,
 * the voice line, and the farmer's own portal (POST /farmer/lots) — never by
 * an anonymous API call (D-047). Anyone may read a lot's public, whitelisted
 * story at /public/trace/:lotId (D-033).
 */
export async function lotRoutes(app: FastifyInstance): Promise<void> {
  // The full trace, money amounts included — only for a buyer trading on this lot.
  app.get('/lots/:id/trace', { preHandler: [app.authBuyer] }, async (req) => {
    const { id } = req.params as { id: string };
    getLot(id); // 404 on unknown lot
    if (!listContractsForLot(id).some((c) => c.buyerId === req.user.sub)) {
      throw new DomainError('Not your lot', 'FORBIDDEN', 403);
    }
    return { events: getTrace(id) };
  });
}
