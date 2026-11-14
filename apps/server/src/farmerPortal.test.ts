import {
  createDemand,
  db,
  getContract,
  listContractsForFarmer,
  getFarmerByPhone,
  listNotificationsForPhone,
  MockPaymentProvider,
  registerFarmer,
  registerLot,
  schema,
  setPaymentProvider,
} from '@ftm/core';
import { and, eq, inArray } from 'drizzle-orm';
import { acceptFor, openOfferFor, testBuyer, testBuyerToken, testToken } from '@ftm/core/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from './app';

const DAY = 24 * 60 * 60 * 1000;
let app: FastifyInstance;
let buyerToken: string;

beforeAll(async () => {
  setPaymentProvider(new MockPaymentProvider(0));
  app = await buildServer({ logger: false });
  buyerToken = testBuyerToken();
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

/** A web login acting as the farmer registered on this phone (D-047). */
function farmerToken(phone: string): string {
  const farmer = getFarmerByPhone(phone)!;
  return testToken('farmer', farmer.id, farmer.phone);
}

describe('farmer web portal (M22)', () => {
  it('logs in and accepts a bid from the web — full parity with USSD', async () => {
    yamJanitor();
    const phone = '+233207460101';
    const buyer = testBuyer();
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
    // Phase 1: the engine's match is an offer thread waiting on her, shown in offerThreads.
    const waiting = openOfferFor(farmer.id)!;

    const token = farmerToken(phone);
    const dash = await app.inject({ method: 'GET', url: '/api/farmer/dashboard', headers: { authorization: `Bearer ${token}` } });
    expect(dash.statusCode).toBe(200);
    const body = dash.json();
    expect(body.profile.name).toBe('Portal Farmer');
    const offer = body.offerThreads.find((o: { id: string }) => o.id === waiting.id);
    expect(offer).toBeDefined();
    expect(offer.turn).toBe('farmer');
    expect(offer.current).toMatchObject({ units: 2, pricePerUnit: 100000, total: 200000 }); // 2 Hundred at GHS 4.00/kg × 250kg

    // The same acceptOfferThread USSD "1. Accept" calls.
    const accept = await post(`/api/farmer/offers/${waiting.id}/accept`, {}, token);
    expect(accept.statusCode).toBe(200);
    const contractId = accept.json().contract.id;
    expect(getContract(contractId).state).toBe('ACCEPTED');
    expect(getContract(contractId).holdAmount).toBe(200000);
    expect(listContractsForFarmer(farmer.id).map((c) => c.id)).toEqual([contractId]);
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
  });
});

describe('public trace (M24, D-033)', () => {
  it('serves the chain of custody without auth — and without phones or money', async () => {
    yamJanitor();
    const buyer = testBuyer();
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
    await acceptFor(farmer.id); // the deal is struck, so the trace carries the order too

    const res = await app.inject({ method: 'GET', url: `/api/public/trace/${lot.id}` }); // no token
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.lot.lotCode).toBe(lot.lotCode);
    expect(body.farmer.name).toBe('Trace Farmer');
    expect(body.farmer.phone).toBeUndefined();
    const types = body.events.map((e: { type: string }) => e.type);
    expect(types).toEqual(expect.arrayContaining(['LOT_REGISTERED', 'MATCHED', 'CONTRACT_ACCEPTED'])); // registered, bid on, agreed

    const raw = JSON.stringify(body);
    expect(raw).not.toContain('233207460303'); // no phone anywhere
    expect(raw).not.toContain('amount'); // no money fields
    expect(raw).not.toContain('pricePerUnit'); // nor the negotiated price
    expect(raw).not.toContain('expiresAt'); // offer internals stay private
    expect(raw).not.toContain('offerId');
    // Phase 1: the engine's bid is the MATCHED event; only the kilograms are public.
    const matchedEvent = body.events.find((e: { type: string }) => e.type === 'MATCHED');
    expect(matchedEvent.payload).toEqual({ allocatedKg: 500 });
    expect(body.events.find((e: { type: string }) => e.type === 'CONTRACT_ACCEPTED').payload).toBeNull();

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
