import {
  createDemand,
  db,
  getContract,
  listContractsForFarmer,
  listNotificationsForPhone,
  MockPaymentProvider,
  registerFarmer,
  registerLot,
  schema,
  setPaymentProvider,
  verifyBuyerLogin,
} from '@ftm/core';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from './app';

const DAY = 24 * 60 * 60 * 1000;
let app: FastifyInstance;
let buyerToken: string;

beforeAll(async () => {
  setPaymentProvider(new MockPaymentProvider(0));
  app = await buildServer({ logger: false });
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: JSON.stringify({ email: 'buyer@demo.ftm', password: 'demo-buyer-2026' }),
    headers: { 'content-type': 'application/json' },
  });
  buyerToken = login.json().token;
});
afterAll(async () => {
  setPaymentProvider(null);
  await app.close();
});

async function post(url: string, payload: unknown, token?: string) {
  return app.inject({
    method: 'POST',
    url,
    payload: JSON.stringify(payload),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
}

function yamJanitor() {
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

async function farmerToken(phone: string): Promise<string> {
  const otpRes = await post('/api/auth/farmer-otp', { phone });
  expect(otpRes.statusCode).toBe(200);
  const sms = listNotificationsForPhone(phone, 5).find((n) => n.templateKey === 'sms.loginCode');
  expect(sms).toBeDefined();
  const code = /code is (\d{6})/.exec(sms!.message)![1];
  const loginRes = await post('/api/auth/farmer-login', { phone, code });
  expect(loginRes.statusCode).toBe(200);
  return loginRes.json().token as string;
}

describe('farmer web portal (M22)', () => {
  it('logs in with an OTP from the SMS outbox and accepts an offer — full parity with USSD', async () => {
    yamJanitor();
    const phone = '+233207460101';
    const buyer = verifyBuyerLogin('buyer@demo.ftm', 'demo-buyer-2026');
    const farmer = registerFarmer({ phone, name: 'Portal Farmer', regionCode: 'BONO_EAST' });
    registerLot({ farmerId: farmer.id, commodityCode: 'YAM', unitCode: 'HUNDRED', unitQty: 2, declaredBand: 'B' });
    createDemand({
      buyerId: buyer.id,
      commodityCode: 'YAM',
      quantityKg: 600,
      minBand: 'B',
      basePricePerKg: 400,
      windowStart: Date.now(),
      windowEnd: Date.now() + 7 * DAY,
      regionCode: 'GREATER_ACCRA',
    });
    const offered = listContractsForFarmer(farmer.id, ['OFFERED'])[0]!;

    // A wrong code is rejected before the right one works.
    await post('/api/auth/farmer-otp', { phone });
    const bad = await post('/api/auth/farmer-login', { phone, code: '000000' });
    expect(bad.statusCode).toBe(401);

    const token = await farmerToken(phone);
    const dash = await app.inject({ method: 'GET', url: '/api/farmer/dashboard', headers: { authorization: `Bearer ${token}` } });
    expect(dash.statusCode).toBe(200);
    const body = dash.json();
    expect(body.profile.name).toBe('Portal Farmer');
    const offer = body.offers.find((o: { id: string }) => o.id === offered.id);
    expect(offer).toBeDefined();
    expect(offer.holdAmount).toBeGreaterThan(0);

    const accept = await post(`/api/farmer/contracts/${offered.id}/accept`, {}, token);
    expect(accept.statusCode).toBe(200);
    expect(getContract(offered.id).state).toBe('ACCEPTED');
  });

  it('lists a lot from the web with an ask price the marketplace then shows', async () => {
    yamJanitor();
    const phone = '+233207460202';
    const farmer = registerFarmer({ phone, name: 'Web Lister', regionCode: 'ASHANTI' });
    const token = await farmerToken(phone);

    const res = await post(
      '/api/farmer/lots',
      { commodityCode: 'YAM', unitCode: 'HUNDRED', unitQty: 1, declaredBand: 'A', askingPricePerKg: 450 },
      token,
    );
    expect(res.statusCode).toBe(201);
    const lot = res.json().lot;
    expect(lot.askingPricePerKg).toBe(450);
    expect(lot.farmerId).toBe(farmer.id);

    const market = await app.inject({
      method: 'GET',
      url: '/api/market/lots',
      headers: { authorization: `Bearer ${buyerToken}` },
    });
    const row = market.json().lots.find((l: { id: string }) => l.id === lot.id);
    expect(row).toBeDefined();
    expect(row.priceSource).toBe('asking');
    expect(row.pricePerKg).toBe(450);
  });

  it('stamps the listing channel per surface and shows the phone only for basic-phone listings (D-036)', async () => {
    yamJanitor();
    const phone = '+233207460404';
    const farmer = registerFarmer({ phone, name: 'Channel Farmer', regionCode: 'ASHANTI' });
    const token = await farmerToken(phone);

    // Web listing → channel 'web', NO phone on the marketplace card.
    const webRes = await post('/api/farmer/lots', { commodityCode: 'YAM', unitCode: 'HUNDRED', unitQty: 1, declaredBand: 'B' }, token);
    expect(webRes.statusCode).toBe(201);
    expect(webRes.json().lot.channel).toBe('web');

    // Core default (the USSD path) → channel 'ussd', phone shown to buyers.
    const ussdLot = registerLot({ farmerId: farmer.id, commodityCode: 'YAM', unitCode: 'HUNDRED', unitQty: 1, declaredBand: 'B' });
    expect(ussdLot.channel).toBe('ussd');

    // Listing photo upload lands as card art on the web lot.
    const boundary = 'X-FTM-TEST-BOUNDARY';
    // Tiny valid JPEG (1x1) — enough for sharp to process.
    const jpeg = Buffer.from(
      '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==',
      'base64',
    );
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="photo"; filename="p.jpg"\r\ncontent-type: image/jpeg\r\n\r\n`),
      jpeg,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const photoRes = await app.inject({
      method: 'POST',
      url: `/api/farmer/lots/${webRes.json().lot.id}/photos`,
      payload: body,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, authorization: `Bearer ${token}` },
    });
    expect(photoRes.statusCode).toBe(201);

    const market = await app.inject({ method: 'GET', url: '/api/market/lots', headers: { authorization: `Bearer ${buyerToken}` } });
    const rows = market.json().lots as Array<{ id: string; channel: string; farmerPhone: string | null; photoUrl: string | null }>;
    const webRow = rows.find((r) => r.id === webRes.json().lot.id)!;
    expect(webRow.channel).toBe('web');
    expect(webRow.farmerPhone).toBeNull();
    expect(webRow.photoUrl).toMatch(/^\/photos\//);
    const ussdRow = rows.find((r) => r.id === ussdLot.id)!;
    expect(ussdRow.channel).toBe('ussd');
    expect(ussdRow.farmerPhone).toBe(phone);
    expect(ussdRow.photoUrl).toBeNull();
  });

  it('rejects wrong-role tokens and unknown farmers', async () => {
    const dash = await app.inject({
      method: 'GET',
      url: '/api/farmer/dashboard',
      headers: { authorization: `Bearer ${buyerToken}` },
    });
    expect(dash.statusCode).toBe(401);
    const otp = await post('/api/auth/farmer-otp', { phone: '+233209999999' });
    expect(otp.statusCode).toBe(404);
  });
});

describe('public trace (M24, D-033)', () => {
  it('serves the chain of custody without auth — and without phones or money', async () => {
    yamJanitor();
    const buyer = verifyBuyerLogin('buyer@demo.ftm', 'demo-buyer-2026');
    const farmer = registerFarmer({ phone: '+233207460303', name: 'Trace Farmer', regionCode: 'NORTHERN' });
    const lot = registerLot({ farmerId: farmer.id, commodityCode: 'YAM', unitCode: 'HUNDRED', unitQty: 2, declaredBand: 'B' });
    createDemand({
      buyerId: buyer.id,
      commodityCode: 'YAM',
      quantityKg: 600,
      minBand: 'B',
      basePricePerKg: 400,
      windowStart: Date.now(),
      windowEnd: Date.now() + 7 * DAY,
      regionCode: 'GREATER_ACCRA',
    });

    const res = await app.inject({ method: 'GET', url: `/api/public/trace/${lot.id}` }); // no token
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.lot.lotCode).toBe(lot.lotCode);
    expect(body.farmer.name).toBe('Trace Farmer');
    expect(body.farmer.phone).toBeUndefined();
    expect(body.events.length).toBeGreaterThanOrEqual(3); // registered, matched, offered

    const raw = JSON.stringify(body);
    expect(raw).not.toContain('233207460303'); // no phone anywhere
    expect(raw).not.toContain('amount'); // no money fields
    expect(raw).not.toContain('expiresAt'); // offer internals stay private
    const offeredEvent = body.events.find((e: { type: string }) => e.type === 'CONTRACT_OFFERED');
    expect(offeredEvent.payload).toEqual({ allocatedKg: 500 });

    const missing = await app.inject({ method: 'GET', url: '/api/public/trace/00000000-0000-0000-0000-000000000000' });
    expect(missing.statusCode).toBe(404);
  });
});

describe('farmer language profile (M30, D-040)', () => {
  it('PATCH /farmer/profile sets the locale, the dashboard exposes it, and junk is refused', async () => {
    const phone = '+233207460505';
    registerFarmer({ phone, name: 'Lang Farmer', regionCode: 'NORTHERN' });
    const token = await farmerToken(phone);

    let dash = await app.inject({ method: 'GET', url: '/api/farmer/dashboard', headers: { authorization: `Bearer ${token}` } });
    expect(dash.json().profile.locale).toBe('en');

    const patched = await app.inject({
      method: 'PATCH',
      url: '/api/farmer/profile',
      payload: JSON.stringify({ locale: 'dag' }),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().profile.locale).toBe('dag');

    dash = await app.inject({ method: 'GET', url: '/api/farmer/dashboard', headers: { authorization: `Bearer ${token}` } });
    expect(dash.json().profile.locale).toBe('dag');

    const bad = await app.inject({
      method: 'PATCH',
      url: '/api/farmer/profile',
      payload: JSON.stringify({ locale: 'xx' }),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('INVALID_LOCALE');
  });
});
