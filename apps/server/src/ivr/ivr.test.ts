import {
  acceptOfferAndHold,
  createDemand,
  db,
  expireStaleVoiceCalls,
  getContract,
  getTrace,
  listContractsForFarmer,
  listNotificationsForPhone,
  listVoiceCallsForPhone,
  MockPaymentProvider,
  placePendingVoiceCalls,
  registerFarmer,
  registerLot,
  schema,
  setPaymentProvider,
  setTtsProvider,
  verifyBuyerLogin,
} from '@ftm/core';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../app';

const DAY = 24 * 60 * 60 * 1000;
let app: FastifyInstance;

beforeAll(async () => {
  setPaymentProvider(new MockPaymentProvider(0));
  app = await buildServer({ logger: false });
});
afterAll(async () => {
  setPaymentProvider(null);
  await app.close();
});

function isolateYamLane(): void {
  const yam = db.select().from(schema.commodities).all().find((c) => c.code === 'YAM')!;
  db.update(schema.demands)
    .set({ status: 'cancelled' })
    .where(and(eq(schema.demands.commodityId, yam.id), inArray(schema.demands.status, ['open', 'partially_matched'])))
    .run();
  db.update(schema.lots)
    .set({ status: 'withdrawn' })
    .where(and(eq(schema.lots.commodityId, yam.id), eq(schema.lots.status, 'registered')))
    .run();
}

async function offeredContract(phone: string) {
  isolateYamLane();
  const buyer = verifyBuyerLogin('buyer@demo.ftm', 'demo-buyer-2026');
  const farmer = registerFarmer({ phone, name: `Voice ${phone.slice(-4)}`, regionCode: 'NORTHERN' });
  registerLot({ farmerId: farmer.id, commodityCode: 'YAM', unitCode: 'HUNDRED', unitQty: 2, declaredBand: 'B' });
  createDemand({
    buyerId: buyer.id,
    commodityCode: 'YAM',
    quantityKg: 500,
    minBand: 'B',
    basePricePerKg: 400,
    windowStart: Date.now(),
    windowEnd: Date.now() + 7 * DAY,
    regionCode: 'GREATER_ACCRA',
  });
  const contract = listContractsForFarmer(farmer.id, ['OFFERED'])[0]!;
  return { farmer, contract };
}

/** Speak the AT Voice callback format at /voice/answer for one call leg. */
async function voiceLeg(callId: string, phone: string, sessionId: string, dtmfDigits?: string): Promise<string> {
  const body = new URLSearchParams({ sessionId, isActive: '1', callerNumber: phone });
  if (dtmfDigits !== undefined) body.set('dtmfDigits', dtmfDigits);
  const res = await app.inject({
    method: 'POST',
    url: `/voice/answer?callId=${callId}`,
    payload: body.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  expect(res.headers['content-type']).toContain('application/xml');
  return res.body;
}

describe('voice/IVR (M16)', () => {
  it('queues a call beside the SMS on every new offer, and the sweep places it', async () => {
    const phone = '+233207770301';
    const { farmer } = await offeredContract(phone);

    // SMS fallback is unconditional…
    expect(listNotificationsForPhone(farmer.phone).some((n) => n.templateKey === 'sms.newOffer')).toBe(true);
    // …and the voice call is queued.
    let calls = listVoiceCallsForPhone(farmer.phone);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.flow).toBe('offer');
    expect(calls[0]!.status).toBe('pending');

    await placePendingVoiceCalls();
    calls = listVoiceCallsForPhone(farmer.phone);
    expect(calls[0]!.status).toBe('placing');
  });

  it('lets the farmer HEAR the offer and press 1 to accept', async () => {
    const phone = '+233207770302';
    const { farmer, contract } = await offeredContract(phone);
    await placePendingVoiceCalls();
    const call = listVoiceCallsForPhone(farmer.phone)[0]!;

    // Answered: the prompt speaks the terms and gathers one digit.
    const prompt = await voiceLeg(call.id, phone, 's1');
    expect(prompt).toContain('<GetDigits');
    expect(prompt).toContain('500 kilos of your Yam');
    expect(prompt).toContain('Press 1 to accept');

    // Invalid digit repeats the menu.
    const repeat = await voiceLeg(call.id, phone, 's1', '7');
    expect(repeat).toContain('<GetDigits');
    expect(repeat).toContain('Press 1 to accept');

    // 1 = accept — same domain call as USSD and web.
    const accepted = await voiceLeg(call.id, phone, 's1', '1');
    expect(accepted).not.toContain('<GetDigits');
    expect(accepted).toContain('You accepted');

    expect(getContract(contract.id).state).toBe('ACCEPTED');
    const done = listVoiceCallsForPhone(farmer.phone)[0]!;
    expect(done.status).toBe('completed');
    expect(getTrace(contract.lotId).map((e) => e.type)).toContain('VOICE_CALL');
  });

  it('lets the farmer press 2 to decline', async () => {
    const phone = '+233207770303';
    const { farmer, contract } = await offeredContract(phone);
    await placePendingVoiceCalls();
    const call = listVoiceCallsForPhone(farmer.phone)[0]!;
    await voiceLeg(call.id, phone, 's2');
    const declined = await voiceLeg(call.id, phone, 's2', '2');
    expect(declined).toContain('You declined');
    expect(getContract(contract.id).state).toBe('DECLINED');
  });

  it('says goodbye gracefully when the offer is already gone', async () => {
    const phone = '+233207770304';
    const { farmer, contract } = await offeredContract(phone);
    await acceptOfferAndHold(contract.id, farmer.id); // accepted via USSD before the call landed
    await placePendingVoiceCalls();
    const call = listVoiceCallsForPhone(farmer.phone).find((c) => c.flow === 'offer')!;
    const gone = await voiceLeg(call.id, phone, 's3');
    expect(gone).not.toContain('<GetDigits');
    expect(gone).toContain('no longer available');
  });

  it('speaks via <Play> when the TTS provider yields audio, on prompt and hangup legs alike (M30)', async () => {
    const phone = '+233207770306';
    const { farmer } = await offeredContract(phone);
    await placePendingVoiceCalls();
    const call = listVoiceCallsForPhone(farmer.phone)[0]!;
    setTtsProvider({ name: 'mock', synthesize: async () => ({ url: 'http://localhost:3000/tts/en/abc.mp3' }) });
    try {
      const prompt = await voiceLeg(call.id, phone, 's6');
      expect(prompt).toContain('<GetDigits');
      expect(prompt).toContain('<Play url="http://localhost:3000/tts/en/abc.mp3"/>');
      expect(prompt).not.toContain('<Say');
      const accepted = await voiceLeg(call.id, phone, 's6', '1');
      expect(accepted).toContain('<Play');
    } finally {
      setTtsProvider(null);
    }
  });

  it('retries an unanswered call once, then records no_answer with SMS already out', async () => {
    const phone = '+233207770305';
    const { farmer } = await offeredContract(phone);
    await placePendingVoiceCalls(); // attempt 1 → placing
    expireStaleVoiceCalls(Date.now() + 3 * 60 * 1000); // → back to pending (earlier tests' strays may expire too)
    expect(listVoiceCallsForPhone(farmer.phone)[0]!.status).toBe('pending');

    await placePendingVoiceCalls(); // attempt 2 → placing
    expireStaleVoiceCalls(Date.now() + 6 * 60 * 1000); // → no_answer, final
    const call = listVoiceCallsForPhone(farmer.phone)[0]!;
    expect(call.status).toBe('no_answer');
    expect(call.attempts).toBe(2);
    expect(listNotificationsForPhone(farmer.phone).some((n) => n.templateKey === 'sms.newOffer')).toBe(true);
  });
});
