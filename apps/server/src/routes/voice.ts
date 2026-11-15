import fs from 'node:fs';
import path from 'node:path';
import {
  carrierCallbackUrl,
  carrierRequestAllowed,
  config,
  DomainError,
  finishVoiceCall,
  getFarmerByPhone,
  getInboundCallForSession,
  getLot,
  getVoiceCall,
  normalizePhone,
  processVoiceListing,
  startInboundCall,
  t,
  getMediaStore,
  mediaUrlAbsolute,
} from '@ftm/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { handleVoiceAnswer } from '../ivr/index';
import { sayResponse } from '../ivr/xml';

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
  // Only the carrier (or, while it is on, the simulator) may drive calls (D-047).
  app.addHook('onRequest', async (req, reply) => {
    if (!carrierRequestAllowed((req.query as { token?: unknown }).token)) {
      await reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Unknown caller' } });
    }
  });

  // The web handset simulator's stand-in for a carrier's recorded-call upload
  // (D-038 real audio path): the browser records the farmer's mic with
  // MediaRecorder, POSTs the blob here, and gets back a URL it hands to
  // /voice/answer as recordingUrl — the same field a real Africa's Talking
  // callback would carry. No DB row: unlike lot photos, a recording is
  // input to the ASR step, not a marketplace asset worth keeping after.
  // Simulator-only: a real carrier hosts its own recordings.
  if (config.simulatorEnabled) app.post('/voice/upload-recording', async (req, reply) => {
    const file = await req.file();
    if (!file) throw new DomainError('Attach an audio file', 'NO_FILE', 400);
    // Keep the container the client actually sent: the simulator now uploads
    // WAV (the language Space can't read WebM), older clients still send WebM.
    const isWav = file.mimetype.includes('wav') || file.filename.toLowerCase().endsWith('.wav');
    const fileName = `${crypto.randomUUID()}.${isWav ? 'wav' : 'webm'}`;
    const key = `recordings/${fileName}`;
    await getMediaStore().put(key, await file.toBuffer(), isWav ? 'audio/wav' : 'audio/webm');
    return reply.code(201).send({ recordingUrl: mediaUrlAbsolute(key) });
  });

  app.post('/voice/answer', async (req, reply) => {
    const body = answerSchema.parse(req.body ?? {});
    const { callId, hold } = req.query as { callId?: string; hold?: string };
    const phone = body.callerNumber ?? body.phoneNumber ?? '';
    const callbackUrl = (id: string, extra?: string) => carrierCallbackUrl(`/voice/answer?callId=${id}${extra ? `&${extra}` : ''}`);
    const answer = (id: string) =>
      handleVoiceAnswer({
        callId: id,
        phone,
        sessionId: body.sessionId,
        dtmfDigits: body.dtmfDigits,
        recordingUrl: body.recordingUrl,
        transcript: body.transcript,
        hold: hold === '1',
        callbackUrl,
      });

    // A voice gateway can only parse XML. Without this the global error
    // handler answers a DomainError with JSON — the caller hears dead air and
    // the leg hangs. /ussd has had the same guard from the start; this is the
    // twin surface catching up, degrading to a spoken apology like it does.
    try {
      return await answerCall();
    } catch (err) {
      req.log.error(err, 'voice answer handler failed');
      const locale = (await getFarmerByPhone(phone))?.locale ?? 'en';
      return reply
        .type('application/xml')
        .send(await sayResponse(t(locale, 'voice.list.failed', { code: config.USSD_SHORTCODE }), locale));
    }

    async function answerCall() {
    // No callId = an INBOUND call to the listing line. Phase 2: the farmer gets
    // a call row and the line's menu (sell, my listings, offers waiting), and
    // every later answer carries that call's id. Outbound flows keep theirs.
    if (!callId) {
      const farmer = await getFarmerByPhone(phone);
      const locale = farmer?.locale ?? 'en';
      const live = await getInboundCallForSession(body.sessionId);
      if (live) return reply.type('application/xml').send(await answer(live.id));
      if (!body.recordingUrl && body.transcript === undefined) {
        if (!farmer) {
          return reply
            .type('application/xml')
            .send(await sayResponse(t(locale, 'voice.list.notRegistered', { code: config.USSD_SHORTCODE }), locale));
        }
        const call = await startInboundCall({ phone: normalizePhone(phone), locale, sessionRef: body.sessionId });
        return reply.type('application/xml').send(await answer(call.id));
      }
      // A whole listing in one recording with no call around it (D-038's
      // one-breath line, still used by older simulator builds): list or refuse.

      const result = await processVoiceListing({
        phone,
        audioRef: body.recordingUrl ?? null,
        transcriptHint: body.transcript ?? null,
      });
      if (result.status === 'listed' && result.lotId && result.parsed) {
        const lot = await getLot(result.lotId);
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

    return reply.type('application/xml').send(await answer(callId));
    }
  });

  // Final call status events (hangup, no-answer). Payloads are advisory only —
  // a call we already completed stays completed.
  app.post('/voice/events', async (req, reply) => {
    const { callId } = req.query as { callId?: string };
    if (callId) {
      const call = await getVoiceCall(callId);
      if (call && ['placing', 'in_progress'].includes(call.status)) {
        await finishVoiceCall(callId, 'no_answer');
      }
    }
    return reply.code(200).send({ ok: true });
  });
}
