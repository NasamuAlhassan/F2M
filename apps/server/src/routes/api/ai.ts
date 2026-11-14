import { adviseOffer, aiAssistEnabled, checkListingPhoto, DomainError, getLot, getOffer, understandRequest } from '@ftm/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

/**
 * The assist (D-056). Every endpoint is a suggestion the person can ignore, and
 * the language-model ones answer 503 "AI_OFF" rather than pretend when the
 * owner has not switched it on — so a screen can hide the control.
 */
export async function aiRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ai/status', { preHandler: [app.authAnyRole] }, async () => ({ enabled: aiAssistEnabled() }));

  // "I need 5 tonnes of tomatoes in Kumasi by Friday" → the request form's fields, to review and submit.
  app.post('/ai/parse-request', { preHandler: [app.authBuyer] }, async (req) => {
    if (!aiAssistEnabled()) throw new DomainError('The writing assistant is not switched on', 'AI_OFF', 503);
    const { text } = z.object({ text: z.string().trim().min(3).max(600) }).parse(req.body);
    return { fields: await understandRequest(text) };
  });

  // Whether to accept or counter, from the price data alone — works with the assist off.
  app.get<{ Params: { id: string } }>('/offers/:id/advice', { preHandler: [app.authBuyerOrFarmer] }, async (req) => {
    const offer = getOffer(req.params.id);
    const party = req.user.kind === 'farmer' ? 'farmer' : 'buyer';
    const mine = party === 'farmer' ? offer.farmerId === req.user.sub : offer.buyerId === req.user.sub;
    if (!mine) throw new DomainError('Not your offer', 'FORBIDDEN', 403);
    return { advice: adviseOffer(offer.id, party) };
  });

  // Does the photo show the crop the listing names? Advisory.
  app.post<{ Params: { id: string } }>('/farmer/lots/:id/photo-check', { preHandler: [app.authFarmer] }, async (req) => {
    if (!aiAssistEnabled()) throw new DomainError('The photo check is not switched on', 'AI_OFF', 503);
    const lot = getLot(req.params.id);
    if (lot.farmerId !== req.user.sub) throw new DomainError('Not your lot', 'FORBIDDEN', 403);
    return { check: await checkListingPhoto(lot.id) };
  });
}
