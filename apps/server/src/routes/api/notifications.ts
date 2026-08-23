import { listBuyerNotifications, markNotificationsRead, unreadNotificationCount } from '@ftm/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const readSchema = z.object({ ids: z.array(z.string()).optional() }).default({});

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/notifications', { preHandler: [app.authBuyer] }, async (req) => {
    const buyerId = req.user.sub;
    return {
      unread: unreadNotificationCount(buyerId),
      notifications: listBuyerNotifications(buyerId).map((n) => ({
        id: n.id,
        message: n.message,
        contractId: n.contractId,
        lotId: n.lotId,
        jobId: n.jobId,
        readAt: n.readAt,
        createdAt: n.createdAt,
      })),
    };
  });

  app.post('/notifications/read', { preHandler: [app.authBuyer] }, async (req) => {
    const { ids } = readSchema.parse(req.body ?? {});
    return { marked: markNotificationsRead(req.user.sub, ids) };
  });
}
