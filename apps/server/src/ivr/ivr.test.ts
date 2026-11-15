import {
  createDemand,
  db,
  expireStaleVoiceCalls,
  getContract,
  getOffer,
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
} from '@ftm/core';
import { and, eq, inArray } from 'drizzle-orm';
import { acceptFor, openOfferFor, testBuyer } from '@ftm/core/testing';
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

async function isolateYamLane(): Promise<void> {
  const yam = (await db.select().from(schema.commodities)).find((c) => c.code === 'YAM')!;
  (await db.update(schema.demands)
        .set({ status: 'cancelled' })
        .where(and(eq(schema.demands.commodityId, yam.id), inArray(schema.demands.status, ['open', 'partially_matched']))));
  (await db.update(schema.lots)
        .set({ status: 'withdrawn' })
        .where(and(eq(schema.lots.commodityId, yam.id), eq(schema.lots.status, 'registered'))));
}

/**
 * A fresh farmer's 2 hundreds of yam (500kg) and a buyer request that fits:
 * the engine turns it into a bid waiting on her (Phase 1) — 2 Hundred at the
 * request's grade-B price, GHS 4.00/kg × 250kg = GHS 1000.00 each.
 */
async function openBid(phone: string) {
  await isolateYamLane();
  const buyer = await testBuyer();
  const farmer = await registerFarmer({ phone, name: `Voice ${phone.slice(-4)}`, regionCode: 'NORTHERN' });
  await registerLot({ farmerId: farmer.id, commodityCode: 'YAM', unitCode: 'HUNDRED', unitQty: 2, declaredBand: 'B' });
  await createDemand({
        buyerId: buyer.id,
        commodityCode: 'YAM',
        quantityKg: 500,
        minBand: 'B',
        basePricePerKg: 400,
        windowStart: Date.now(),
        windowEnd: Date.now() + 7 * DAY,
        regionCode: 'GREATER_ACCRA',
      });
  const offer = (await openOfferFor(farmer.id))!;
  return { farmer, offer };
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
  it('queues a call beside the SMS on every new bid, and the sweep places it', async () => {
    const phone = '+233207770301';
    const { farmer, offer } = await openBid(phone);

    // SMS fallback is unconditional (Phase 1: the bid SMS, not the old sms.newOffer)…
    expect((await listNotificationsForPhone(farmer.phone)).some((n) => n.templateKey === 'sms.bidReceived')).toBe(true);
    // …and the voice call is queued, tied to the offer thread rather than a contract.
    let calls = await listVoiceCallsForPhone(farmer.phone);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.flow).toBe('bid');
    expect(calls[0]!.offerId).toBe(offer.id);
    expect(calls[0]!.status).toBe('pending');

    await placePendingVoiceCalls();
    calls = await listVoiceCallsForPhone(farmer.phone);
    expect(calls[0]!.status).toBe('placing');
  });

  it('lets the farmer HEAR the bid and press 1 to accept', async () => {
    const phone = '+233207770302';
    const { farmer, offer } = await openBid(phone);
    await placePendingVoiceCalls();
    const call = (await listVoiceCallsForPhone(farmer.phone))[0]!;

    // Answered: the prompt speaks the proposal in the listing's unit and gathers one digit.
    const prompt = await voiceLeg(call.id, phone, 's1');
    expect(prompt).toContain('<GetDigits');
    expect(prompt).toContain('offers 2 Hundred (100 tubers) of your Yam at GHS 1000.00 each, GHS 2000.00 in all');
    expect(prompt).toContain('Press 1 to accept');

    // Invalid digit repeats the menu.
    const repeat = await voiceLeg(call.id, phone, 's1', '7');
    expect(repeat).toContain('<GetDigits');
    expect(repeat).toContain('Press 1 to accept');

    // 1 = accept — same domain call as USSD and web: the order exists only now.
    const accepted = await voiceLeg(call.id, phone, 's1', '1');
    expect(accepted).not.toContain('<GetDigits');
    expect(accepted).toContain('The deal is agreed for GHS 2000.00');

    const closed = await getOffer(offer.id);
    expect(closed.status).toBe('accepted');
    const contract = await getContract(closed.contractId!);
    expect(contract.state).toBe('ACCEPTED');
    expect(contract.agreedTotal).toBe(200000);
    const done = (await listVoiceCallsForPhone(farmer.phone))[0]!;
    expect(done.status).toBe('completed');
  });

  it('records the answered bid call in the lot trace', async () => {
    const phone = '+233207770307';
    const { farmer, offer } = await openBid(phone);
    await placePendingVoiceCalls();
    const call = (await listVoiceCallsForPhone(farmer.phone))[0]!;
    await voiceLeg(call.id, phone, 's7');
    await voiceLeg(call.id, phone, 's7', '1');
    // The call that agreed the deal belongs in the chain of custody, as it did for 'offer' calls.
    expect((await getTrace(offer.lotId)).map((e) => e.type)).toContain('VOICE_CALL');
  });

  it('lets the farmer press 2 to reject', async () => {
    const phone = '+233207770303';
    const { farmer, offer } = await openBid(phone);
    await placePendingVoiceCalls();
    const call = (await listVoiceCallsForPhone(farmer.phone))[0]!;
    await voiceLeg(call.id, phone, 's2');
    const rejected = await voiceLeg(call.id, phone, 's2', '2');
    expect(rejected).toContain('You turned down the offer');
    expect((await getOffer(offer.id)).status).toBe('rejected');
    expect(await listContractsForFarmer(farmer.id)).toHaveLength(0); // no order was ever made
  });

  it('says goodbye gracefully when the bid is already answered', async () => {
    const phone = '+233207770304';
    const { farmer } = await openBid(phone);
    await acceptFor(farmer.id); // accepted via USSD before the call landed
    await placePendingVoiceCalls();
    const call = (await listVoiceCallsForPhone(farmer.phone)).find((c) => c.flow === 'bid')!;
    const gone = await voiceLeg(call.id, phone, 's3');
    expect(gone).not.toContain('<GetDigits');
    expect(gone).toContain('no longer available');
  });

  it('speaks via <Play> when the TTS provider yields audio, on prompt and hangup legs alike (M30)', async () => {
    const phone = '+233207770306';
    const { farmer } = await openBid(phone);
    await placePendingVoiceCalls();
    const call = (await listVoiceCallsForPhone(farmer.phone))[0]!;
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
    const { farmer } = await openBid(phone);
    await placePendingVoiceCalls(); // attempt 1 → placing
    await expireStaleVoiceCalls(Date.now() + 3 * 60 * 1000); // → back to pending (earlier tests' strays may expire too)
    expect((await listVoiceCallsForPhone(farmer.phone))[0]!.status).toBe('pending');

    await placePendingVoiceCalls(); // attempt 2 → placing
    await expireStaleVoiceCalls(Date.now() + 6 * 60 * 1000); // → no_answer, final
    const call = (await listVoiceCallsForPhone(farmer.phone))[0]!;
    expect(call.status).toBe('no_answer');
    expect(call.attempts).toBe(2);
    expect((await listNotificationsForPhone(farmer.phone)).some((n) => n.templateKey === 'sms.bidReceived')).toBe(true);
  });
});
