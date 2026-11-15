import { listClaimsForReview, listNotificationsForPhone, listVoiceCallsForPhone, normalizePhone, resolveClaim } from '@ftm/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sweepOnce } from '../../jobs/sweep';
import { endUssdSession } from '../../ussd/machine';

const sweepSchema = z.object({ now: z.number().optional() }).default({});

/** Dev/test-only helpers — deterministic clock control + the tester's SMS inbox. */
export async function devRoutes(app: FastifyInstance): Promise<void> {
  // Phase 3: F2M's decision on a claim (a deduction from 0 to what the buyer
  // asked), standing in for the Phase 4 reviewer screen. Simulator only, like
  // every /api/dev route.
  app.post('/dev/claims/:id/resolve', async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { deduction?: number; note?: string };
    return { claim: await resolveClaim(id, { deduction: body.deduction, note: body.note, reviewer: 'simulator' }) };
  });

  app.get('/dev/claims', async () => ({ claims: await listClaimsForReview() }));

  app.post('/dev/sweep', async (req) => {
    const { now } = sweepSchema.parse(req.body ?? {});
    return sweepOnce(now ?? Date.now());
  });

  // The handset's End key. A real carrier reports the abandoned dial itself;
  // the simulator has to say so, or the session outlives the caller's intent.
  app.post('/dev/ussd-end', async (req) => {
    const { sessionId } = z.object({ sessionId: z.string().min(1) }).parse(req.body ?? {});
    await endUssdSession(sessionId);
    return { ok: true };
  });

  // Powers the incoming-call panel in ivr-tester.html.
  app.get('/dev/voice-calls', async (req) => {
    const { phone } = req.query as { phone?: string };
    if (!phone) return { calls: [] };
    let normalized: string;
    try {
      normalized = normalizePhone(phone);
    } catch {
      return { calls: [] };
    }
    return {
      calls: (await listVoiceCallsForPhone(normalized)).map((c) => ({
        id: c.id,
        flow: c.flow,
        status: c.status,
        createdAt: c.createdAt,
      })),
    };
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
      messages: (await listNotificationsForPhone(normalized)).map((n) => ({
        message: n.message,
        status: n.status,
        createdAt: n.createdAt,
      })),
    };
  });
}
