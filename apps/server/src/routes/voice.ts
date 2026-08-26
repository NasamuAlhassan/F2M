import fs from 'node:fs';
import path from 'node:path';
import {
  config,
  DomainError,
  finishVoiceCall,
  getFarmerByPhone,
  getLot,
  getVoiceCall,
  processVoiceListing,
  t,
} from '@ftm/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { handleVoiceAnswer } from '../ivr/index';
import { recordResponse, sayResponse } from '../ivr/xml';

// Africa's Talking Voice wire format: form-encoded POSTs, XML replies.
const answerSchema = z.object({
  sessionId: z.string().default(''),
  isActive: z.string().optional(),
  callerNumber: z.string().optional(),
  phoneNumber: z.string().optional(),
  dtmfDigits: z.string().optional(),
  recordingUrl: z.string().optional(),
  // Mock-mode stand-in for the recording (the IVR tester types the speech).
  transcript: z.string().optional(),
});

export async function voiceRoutes(app: FastifyInstance): Promise<void> {
  // The web handset simulator's stand-in for a carrier's recorded-call upload
  // (D-038 real audio path): the browser records the farmer's mic with
  // MediaRecorder, POSTs the blob here, and gets back a URL it hands to
  // /voice/answer as recordingUrl — the same field a real Africa's Talking
  // callback would carry. No DB row: unlike lot photos, a recording is
  // input to the ASR step, not a marketplace asset worth keeping after.
  app.post('/voice/upload-recording', async (req, reply) => {
    const file = await req.file();
    if (!file) throw new DomainError('Attach an audio file', 'NO_FILE', 400);
    const dir = path.join(config.storageDir, 'recordings');
    fs.mkdirSync(dir, { recursive: true });
    const fileName = `${crypto.randomUUID()}.webm`;
    fs.writeFileSync(path.join(dir, fileName), await file.toBuffer());
    return reply.code(201).send({ recordingUrl: `${config.PUBLIC_BASE_URL}/recordings/${fileName}` });
  });

  app.post('/voice/answer', async (req, reply) => {
    const body = answerSchema.parse(req.body ?? {});
    const { callId } = req.query as { callId?: string };
    const phone = body.callerNumber ?? body.phoneNumber ?? '';

    // No callId = an INBOUND call to the listing line (D-038): one open-ended
    // recording becomes a marketplace lot. Outbound flows keep their callId.
    if (!callId) {
      const farmer = getFarmerByPhone(phone);
      const locale = farmer?.locale ?? 'en';
      if (!body.recordingUrl && body.transcript === undefined) {
        if (!farmer) {
          return reply
            .type('application/xml')
            .send(await sayResponse(t(locale, 'voice.list.notRegistered', { code: config.USSD_SHORTCODE }), locale));
        }
        return reply
          .type('application/xml')
          .send(await recordResponse(t(locale, 'voice.list.prompt'), locale, `${config.PUBLIC_BASE_URL}/voice/answer`));
      }

      const result = await processVoiceListing({
        phone,
        audioRef: body.recordingUrl ?? null,
        transcriptHint: body.transcript ?? null,
      });
      if (result.status === 'listed' && result.lotId && result.parsed) {
        const lot = getLot(result.lotId);
        const parsed = JSON.parse(result.parsed) as { commodityCode: string; declaredBand: string };
        return reply.type('application/xml').send(
          await sayResponse(
            t(locale, 'voice.list.confirm', {
              commodity: t(locale, `commodity.${parsed.commodityCode}`),
              kg: lot.quantityKg,
              band: parsed.declaredBand,
            }),
            locale,
          ),
        );
      }
      const failKey = result.error === 'not_registered' ? 'voice.list.notRegistered' : 'voice.list.failed';
      return reply.type('application/xml').send(await sayResponse(t(locale, failKey, { code: config.USSD_SHORTCODE }), locale));
    }

    const xml = await handleVoiceAnswer({
      callId,
      phone,
      sessionId: body.sessionId,
      dtmfDigits: body.dtmfDigits,
      callbackUrl: `${config.PUBLIC_BASE_URL}/voice/answer?callId=${callId}`,
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
