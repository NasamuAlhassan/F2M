import { config, finishVoiceCall, getVoiceCall } from '@ftm/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { handleVoiceAnswer } from '../ivr/index';

// Africa's Talking Voice wire format: form-encoded POSTs, XML replies.
const answerSchema = z.object({
  sessionId: z.string().default(''),
  isActive: z.string().optional(),
  callerNumber: z.string().optional(),
  phoneNumber: z.string().optional(),
  dtmfDigits: z.string().optional(),
});

export async function voiceRoutes(app: FastifyInstance): Promise<void> {
  app.post('/voice/answer', async (req, reply) => {
    const body = answerSchema.parse(req.body ?? {});
    const { callId } = req.query as { callId?: string };
    const phone = body.callerNumber ?? body.phoneNumber ?? '';
    const xml = await handleVoiceAnswer({
      callId,
      phone,
      sessionId: body.sessionId,
      dtmfDigits: body.dtmfDigits,
      callbackUrl: `${config.PUBLIC_BASE_URL}/voice/answer${callId ? `?callId=${callId}` : ''}`,
    });
    return reply.type('application/xml').send(xml);
  });

  // Final call status events (hangup, no-answer). Payloads are advisory only —
  // a call we already completed stays completed.
  app.post('/voice/events', async (req, reply) => {
    const { callId } = req.query as { callId?: string };
    if (callId) {
      const call = getVoiceCall(callId);
      if (call && ['placing', 'in_progress'].includes(call.status)) {
        finishVoiceCall(callId, 'no_answer');
      }
    }
    return reply.code(200).send({ ok: true });
  });
}
