import { listNotificationsForPhone, normalizePhone } from '@ftm/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sweepOnce } from '../../jobs/sweep';

const sweepSchema = z.object({ now: z.number().optional() }).default({});

/** Dev/test-only helpers — deterministic clock control + the tester's SMS inbox. */
export async function devRoutes(app: FastifyInstance): Promise<void> {
  app.post('/dev/sweep', async (req) => {
    const { now } = sweepSchema.parse(req.body ?? {});
    return sweepOnce(now ?? Date.now());
  });

  // Powers the SMS inbox panel in ussd-tester.html.
  app.get('/dev/sms', async (req) => {
    const { phone } = req.query as { phone?: string };
    if (!phone) return { messages: [] };
    let normalized: string;
    try {
      normalized = normalizePhone(phone);
    } catch {
      return { messages: [] };
    }
    return {
      messages: listNotificationsForPhone(normalized).map((n) => ({
        message: n.message,
        status: n.status,
        createdAt: n.createdAt,
      })),
    };
  });
}
