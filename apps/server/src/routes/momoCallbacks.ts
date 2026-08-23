import { pollPaymentByReference } from '@ftm/core';
import type { FastifyInstance } from 'fastify';

/**
 * MoMo callback endpoints. Payloads are NEVER trusted — a callback only
 * triggers an immediate status re-query of that reference, which also makes
 * these idempotent for free (D-009).
 */
export async function momoCallbackRoutes(app: FastifyInstance): Promise<void> {
  for (const direction of ['collection', 'disbursement'] as const) {
    app.put(`/callbacks/momo/${direction}/:referenceId`, async (req, reply) => {
      const { referenceId } = req.params as { referenceId: string };
      pollPaymentByReference(referenceId).catch((err) => req.log.error(err, 'callback-triggered poll failed'));
      return reply.code(200).send({ ok: true });
    });
    // Some sandbox configs POST instead of PUT.
    app.post(`/callbacks/momo/${direction}/:referenceId`, async (req, reply) => {
      const { referenceId } = req.params as { referenceId: string };
      pollPaymentByReference(referenceId).catch((err) => req.log.error(err, 'callback-triggered poll failed'));
      return reply.code(200).send({ ok: true });
    });
  }
}
