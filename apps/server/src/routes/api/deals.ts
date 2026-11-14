import { DomainError, getContract, getDealView, dealRoleOf, listDealsFor } from '@ftm/core';
import type { FastifyInstance } from 'fastify';

/**
 * The deal page (one page per sale for its buyer, farmer and driver). Anyone
 * who is not a party gets 404, not 403: a stranger should not even learn the
 * deal exists.
 */
export async function dealRoutes(app: FastifyInstance): Promise<void> {
  app.get('/deals', { preHandler: [app.authAnyRole] }, async (req) => {
    const login = { kind: req.user.kind, sub: req.user.sub };
    return {
      deals: listDealsFor(login).map((id) => {
        const view = getDealView(id, dealRoleOf(getContract(id), login)!);
        return { ...view.deal, viewer: view.viewer, next: view.next, people: view.people, money: view.money };
      }),
    };
  });

  app.get('/deals/:id', { preHandler: [app.authAnyRole] }, async (req) => {
    const { id } = req.params as { id: string };
    let role = null;
    try {
      role = dealRoleOf(getContract(id), { kind: req.user.kind, sub: req.user.sub });
    } catch {
      role = null;
    }
    if (!role) throw new DomainError('Deal not found', 'NOT_FOUND', 404);
    return getDealView(id, role);
  });
}
