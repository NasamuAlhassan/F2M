import { db, getLot, listNotificationsForPhone, parseListingText, registerFarmer, schema, setTtsProvider } from '@ftm/core';
import { eq } from 'drizzle-orm';
import { testBuyerToken } from '@ftm/core/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from './buildServer';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildServer({ logger: false });
});
afterAll(async () => {
  await app.close();
});

async function callListingLine(phone: string, transcript?: string) {
  const params: Record<string, string> = { callerNumber: phone };
  if (transcript !== undefined) params.transcript = transcript;
  const res = await app.inject({
    method: 'POST',
    url: '/voice/answer',
    payload: new URLSearchParams(params).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  expect(res.statusCode).toBe(200);
  return res.body;
}

/** Answer a step at the callback URL the last response named, as the gateway does. */
async function pressOn(xml: string, phone: string, digits: string) {
  const url = /callbackUrl="([^"]+)"/.exec(xml)![1]!.replaceAll('&amp;', '&');
  const res = await app.inject({
    method: 'POST',
    url: new URL(url).pathname + new URL(url).search,
    payload: new URLSearchParams({ callerNumber: phone, dtmfDigits: digits }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  expect(res.statusCode).toBe(200);
  return res.body;
}

describe('voice listing pipeline (M29, D-038)', () => {
  it('parses open speech against the live registries', () => {
    expect(parseListingText('I have ten bags of maize, good quality')).toMatchObject({
      commodityCode: 'MAIZE',
      unitQty: 10,
      declaredBand: 'B',
    });
    expect(parseListingText('Twenty crates of tomatoes, excellent produce')).toMatchObject({
      commodityCode: 'TOMATO',
      unitCode: 'CRATE',
      unitQty: 20,
      declaredBand: 'A',
    });
    expect(parseListingText('I want to sell 5 sacks of pepper, fair quality')).toMatchObject({
      commodityCode: 'PEPPER',
      unitCode: 'SACK',
      unitQty: 5,
      declaredBand: 'C',
    });
    expect(parseListingText('some corn, three bags')).toMatchObject({ commodityCode: 'MAIZE', unitQty: 3 }); // synonym
    expect(parseListingText('I have plenty cocoyam to sell')).toBeNull(); // crop we don't carry
    expect(parseListingText('maize, no amount said')).toBeNull(); // no quantity
  });

  it('the listing prompt rides <Play> before <Record> when TTS yields audio (M30)', async () => {
    const phone = '+233207470102';
    await registerFarmer({ phone, name: 'Play Farmer', regionCode: 'NORTHERN' });
    setTtsProvider({ name: 'mock', synthesize: async () => ({ url: 'http://localhost:3000/tts/en/rec.mp3' }) });
    try {
      // Phase 2: the line answers with its menu; 1 = sell, which records.
      const menu = await callListingLine(phone);
      const xml = await pressOn(menu, phone, '1');
      expect(xml).toContain('<Play url="http://localhost:3000/tts/en/rec.mp3"/>');
      expect(xml.indexOf('<Play')).toBeLessThan(xml.indexOf('<Record'));
      expect(xml).not.toContain('<Say');
    } finally {
      setTtsProvider(null);
    }
  });

  it('an unregistered caller hears register-first and no lot is created', async () => {
    const xml = await callListingLine('+233207470999');
    expect(xml).toContain('not registered');
    expect(xml).not.toContain('<Record');
  });

  it('prompt → speech → parsed lot on the marketplace with channel ivr and the phone shown', async () => {
    const phone = '+233207470101';
    await registerFarmer({ phone, name: 'Voice Farmer', regionCode: 'NORTHERN' });

    // First leg: the line's menu (Phase 2), keys not a recording.
    const promptXml = await callListingLine(phone);
    expect(promptXml).toContain('Press 1 to sell produce');
    expect(promptXml).toContain('<GetDigits');

    // Second leg: the "recording" arrives (typed transcript in mock mode).
    const confirmXml = await callListingLine(phone, 'Hello, I have ten bags of maize, good quality, ready now');
    expect(confirmXml).toContain('We listed your');
    expect(confirmXml).toContain('Maize');

    const row = (await db
          .select()
          .from(schema.voiceListings)
          .where(eq(schema.voiceListings.phone, phone)))
      .find((r) => r.status === 'listed');
    expect(row).toBeDefined();
    expect(row!.transcript).toContain('ten bags of maize');
    const lot = await getLot(row!.lotId!);
    expect(lot.channel).toBe('ivr');
    expect(lot.quantityKg).toBe(500); // ten 50kg bags

    // SMS receipt — the farmer's only written record of what went live.
    const receipt = (await listNotificationsForPhone(phone, 5)).find((n) => n.templateKey === 'sms.listingCreated');
    expect(receipt).toBeDefined();
    expect(receipt!.message).toContain('500kg');
    expect(receipt!.message).toContain(lot.lotCode);

    // The marketplace shows it as a voice listing with the farmer's phone.
    const market = await app.inject({
      method: 'GET',
      url: '/api/market/lots',
      headers: { authorization: `Bearer ${await testBuyerToken()}` },
    });
    const card = (market.json().lots as Array<{ id: string; channel: string; farmerPhone: string | null }>).find(
      (l) => l.id === lot.id,
    );
    expect(card).toBeDefined();
    expect(card!.channel).toBe('ivr');
    expect(card!.farmerPhone).toBe(phone);
  });

  it('unintelligible speech fails honestly: no lot, an SMS pointing to USSD, and the call says so', async () => {
    const phone = '+233207470202';
    await registerFarmer({ phone, name: 'Mumble Farmer', regionCode: 'VOLTA' });
    const xml = await callListingLine(phone, 'ehm the weather is fine thank you');
    expect(xml).toContain('could not understand');

    const row = (await db
          .select()
          .from(schema.voiceListings)
          .where(eq(schema.voiceListings.phone, phone)))[0];
    expect(row!.status).toBe('failed');
    expect(row!.lotId).toBeNull();
    const sms = (await listNotificationsForPhone(phone, 5)).find((n) => n.templateKey === 'sms.listingFailed');
    expect(sms).toBeDefined();
  });

  it('keeps the container the client sent: a WAV upload stays .wav (the language Space cannot read WebM), anything else stays .webm', async () => {
    async function upload(filename: string, type: string): Promise<string> {
      const boundary = '----ftmtest';
      const payload = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`),
        Buffer.from([1, 2, 3, 4]),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const res = await app.inject({
        method: 'POST',
        url: '/voice/upload-recording',
        payload,
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      });
      expect(res.statusCode).toBe(201);
      return (res.json() as { recordingUrl: string }).recordingUrl;
    }
    expect(await upload('recording.wav', 'audio/wav')).toMatch(/\/recordings\/[0-9a-f-]+\.wav$/);
    expect(await upload('recording', 'video/webm')).toMatch(/\/recordings\/[0-9a-f-]+\.webm$/);
  });
});
