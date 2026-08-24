import { db, getLot, listNotificationsForPhone, parseListingText, registerFarmer, schema, setTtsProvider } from '@ftm/core';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from './app';

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
    expect(parseListingText('I have plenty cassava to sell')).toBeNull(); // crop we don't carry
    expect(parseListingText('maize, no amount said')).toBeNull(); // no quantity
  });

  it('the listing prompt rides <Play> before <Record> when TTS yields audio (M30)', async () => {
    const phone = '+233207470102';
    registerFarmer({ phone, name: 'Play Farmer', regionCode: 'NORTHERN' });
    setTtsProvider({ name: 'mock', synthesize: async () => ({ url: 'http://localhost:3000/tts/en/rec.mp3' }) });
    try {
      const xml = await callListingLine(phone);
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
    registerFarmer({ phone, name: 'Voice Farmer', regionCode: 'NORTHERN' });

    // First leg: the prompt + <Record>.
    const promptXml = await callListingLine(phone);
    expect(promptXml).toContain('tell us everything');
    expect(promptXml).toContain('<Record');

    // Second leg: the "recording" arrives (typed transcript in mock mode).
    const confirmXml = await callListingLine(phone, 'Hello, I have ten bags of maize, good quality, ready now');
    expect(confirmXml).toContain('We listed your');
    expect(confirmXml).toContain('Maize');

    const row = db
      .select()
      .from(schema.voiceListings)
      .where(eq(schema.voiceListings.phone, phone))
      .all()
      .find((r) => r.status === 'listed');
    expect(row).toBeDefined();
    expect(row!.transcript).toContain('ten bags of maize');
    const lot = getLot(row!.lotId!);
    expect(lot.channel).toBe('ivr');
    expect(lot.quantityKg).toBe(500); // ten 50kg bags

    // SMS receipt — the farmer's only written record of what went live.
    const receipt = listNotificationsForPhone(phone, 5).find((n) => n.templateKey === 'sms.listingCreated');
    expect(receipt).toBeDefined();
    expect(receipt!.message).toContain('500kg');
    expect(receipt!.message).toContain(lot.lotCode);

    // The marketplace shows it as a voice listing with the farmer's phone.
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: JSON.stringify({ email: 'buyer@demo.ftm', password: 'demo-buyer-2026' }),
      headers: { 'content-type': 'application/json' },
    });
    const market = await app.inject({
      method: 'GET',
      url: '/api/market/lots',
      headers: { authorization: `Bearer ${login.json().token}` },
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
    registerFarmer({ phone, name: 'Mumble Farmer', regionCode: 'VOLTA' });
    const xml = await callListingLine(phone, 'ehm the weather is fine thank you');
    expect(xml).toContain('could not understand');

    const row = db
      .select()
      .from(schema.voiceListings)
      .where(eq(schema.voiceListings.phone, phone))
      .get();
    expect(row!.status).toBe('failed');
    expect(row!.lotId).toBeNull();
    const sms = listNotificationsForPhone(phone, 5).find((n) => n.templateKey === 'sms.listingFailed');
    expect(sms).toBeDefined();
  });
});
