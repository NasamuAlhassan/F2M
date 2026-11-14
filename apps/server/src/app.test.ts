import { registerBuyer, registerFarmer } from '@ftm/core';
import { testBuyerToken, testLoginToken, testToken } from '@ftm/core/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from './app';

let app: FastifyInstance;
let token: string;
let farmerToken: string;
let farmerId: string;
let lotId: string;

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

beforeAll(async () => {
  app = await buildServer({ logger: false });
  token = testBuyerToken();
});
afterAll(async () => {
  await app.close();
});

describe('API spine (M1)', () => {
  it('serves registries', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/registries' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.commodities.map((c: { code: string }) => c.code)).toEqual([
      'MAIZE',
      'TOMATO',
      'YAM',
      'RICE',
      'GROUNDNUT',
      'PEPPER',
      'ONION',
      'PLANTAIN',
    ]);
    expect(body.regions).toHaveLength(16);
  });

  it('serves public market prices (M10)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/market-prices' });
    expect(res.statusCode).toBe(200);
    const { prices } = res.json();
    expect(prices.length).toBe(8 * 4); // 8 commodities × 4 markets
    const maizeTechiman = prices.find(
      (p: { commodityCode: string; market: string }) => p.commodityCode === 'MAIZE' && p.market === 'Techiman',
    );
    expect(maizeTechiman.pricePerKg).toBe(380);
  });

  it('turns a web login into one F2M profile (D-047): phone from the login, one role per phone', async () => {
    // No token, and a token that is not a valid login, are both refused.
    expect((await app.inject({ method: 'GET', url: '/api/account/me' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/account/me', headers: bearer('forged') })).statusCode).toBe(401);

    // Signed in, no profile yet: the web shows signup's second step.
    const login = testLoginToken('auth-new-farmer', '0201112223');
    const me = await app.inject({ method: 'GET', url: '/api/account/me', headers: bearer(login) });
    expect(me.statusCode).toBe(200);
    expect(me.json().account).toBeNull();

    // The phone is never taken from the form — a body that tries is refused outright.
    const smuggled = await app.inject({
      method: 'POST',
      url: '/api/account/register',
      headers: bearer(login),
      payload: { role: 'farmer', name: 'Kwame Boateng', regionCode: 'ASHANTI', phone: '0249999999' },
    });
    expect(smuggled.statusCode).toBe(400);

    const res = await app.inject({
      method: 'POST',
      url: '/api/account/register',
      headers: bearer(login),
      payload: { role: 'farmer', name: 'Kwame Boateng', regionCode: 'ASHANTI', district: 'Ejura' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().account).toMatchObject({ role: 'farmer', phone: '+233201112223', name: 'Kwame Boateng' });
    farmerId = res.json().account.id;
    farmerToken = login;
    expect((await app.inject({ method: 'GET', url: '/api/account/me', headers: bearer(login) })).json().account.id).toBe(farmerId);

    // Registering the same login twice, or another login with the same phone, is refused.
    const again = await app.inject({
      method: 'POST',
      url: '/api/account/register',
      headers: bearer(login),
      payload: { role: 'farmer', name: 'Again', regionCode: 'ASHANTI' },
    });
    expect(again.json().error.code).toBe('ACCOUNT_EXISTS');
    const samePhone = await app.inject({
      method: 'POST',
      url: '/api/account/register',
      headers: bearer(testLoginToken('auth-other', '0201112223')),
      payload: { role: 'buyer', name: 'Someone Else', regionCode: 'BONO' },
    });
    expect(samePhone.json().error.code).toBe('PHONE_TAKEN');
  });

  it('links a farmer who registered by USSD instead of duplicating them, and keeps one role per phone', async () => {
    const ussdFarmer = registerFarmer({ phone: '0201113334', name: 'Ama USSD', regionCode: 'VOLTA' });
    const linked = await app.inject({
      method: 'POST',
      url: '/api/account/register',
      headers: bearer(testLoginToken('auth-ussd-farmer', '0201113334')),
      payload: { role: 'farmer', name: 'Ama Web', regionCode: 'VOLTA' },
    });
    expect(linked.statusCode).toBe(201);
    expect(linked.json().account.id).toBe(ussdFarmer.id); // the same lots, the same history

    registerFarmer({ phone: '0201115556', name: 'Yaw Farmer', regionCode: 'VOLTA' });
    const asBuyer = await app.inject({
      method: 'POST',
      url: '/api/account/register',
      headers: bearer(testLoginToken('auth-role-clash', '0201115556')),
      payload: { role: 'buyer', name: 'Yaw Buyer', regionCode: 'VOLTA' },
    });
    expect(asBuyer.json().error.code).toBe('ROLE_TAKEN');
  });

  it('refuses a valid login of the wrong role, and the anonymous create routes are gone', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/demands', headers: bearer(farmerToken) })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/farmers', payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/lots', payload: {} })).statusCode).toBe(404);
  });

  it('a farmer lists a lot in olonka from their own login', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/farmer/lots',
      headers: bearer(farmerToken),
      payload: { commodityCode: 'MAIZE', unitCode: 'OLONKA', unitQty: 200, declaredBand: 'B' },
    });
    expect(res.statusCode).toBe(201);
    const lot = res.json().lot;
    lotId = lot.id;
    expect(lot.farmerId).toBe(farmerId);
    expect(lot.quantityKg).toBe(500); // 200 olonka × 2.5kg
    expect(lot.lotCode).toMatch(/^FTM-/);
  });

  it('rejects a perishable forward listing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/farmer/lots',
      headers: bearer(farmerToken),
      payload: {
        commodityCode: 'TOMATO',
        unitCode: 'CRATE',
        unitQty: 5,
        declaredBand: 'A',
        readyDate: Date.now() + 10 * 24 * 60 * 60 * 1000,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('READY_DATE_TOO_FAR');
  });

  it('requires auth to post demand, then accepts one', async () => {
    const payload = {
      commodityCode: 'MAIZE',
      quantityKg: 400,
      minBand: 'B',
      basePricePerKg: 400,
      windowStart: Date.now(),
      windowEnd: Date.now() + 7 * 24 * 60 * 60 * 1000,
      regionCode: 'GREATER_ACCRA',
    };
    const noAuth = await app.inject({ method: 'POST', url: '/api/demands', payload });
    expect(noAuth.statusCode).toBe(401);

    const res = await app.inject({ method: 'POST', url: '/api/demands', payload, headers: bearer(token) });
    expect(res.statusCode).toBe(201);
    const demand = res.json().demand;
    expect(demand.priceTerms.B).toBe(400);
    expect(demand.priceTerms.REJECT).toBe(0);
    // Matching ran on creation: the 500kg lot registered above covers all 400kg.
    expect(demand.remainingKg).toBe(0);
    expect(demand.status).toBe('fulfilled');

    const detail = await app.inject({ method: 'GET', url: `/api/demands/${demand.id}`, headers: bearer(token) });
    const { matches } = detail.json();
    expect(matches).toHaveLength(1);
    expect(matches[0].allocatedKg).toBe(400);
    expect(matches[0].contractState).toBe('OFFERED');
    expect(matches[0].breakdown.weights.farmerHistory).toBe(0.3); // storable weights
  });

  it('the full trace (with amounts) is only for a buyer trading on the lot', async () => {
    expect((await app.inject({ method: 'GET', url: `/api/lots/${lotId}/trace` })).statusCode).toBe(401);
    const mine = await app.inject({ method: 'GET', url: `/api/lots/${lotId}/trace`, headers: bearer(token) });
    expect(mine.statusCode).toBe(200);
    const events = mine.json().events as Array<{ type: string; payload: { unit?: string } }>;
    expect(events[0]!.type).toBe('LOT_REGISTERED');
    expect(events[0]!.payload.unit).toBe('OLONKA');

    const stranger = registerBuyer({ phone: '0555000999', name: 'Stranger', regionCode: 'ASHANTI' });
    const res = await app.inject({
      method: 'GET',
      url: `/api/lots/${lotId}/trace`,
      headers: bearer(testToken('buyer', stranger.id, stranger.phone!)),
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a tomato demand window beyond the perishable clock', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/demands',
      payload: {
        commodityCode: 'TOMATO',
        quantityKg: 100,
        minBand: 'B',
        basePricePerKg: 300,
        windowStart: Date.now(),
        windowEnd: Date.now() + 10 * 24 * 60 * 60 * 1000,
        regionCode: 'ASHANTI',
      },
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('WINDOW_TOO_FAR');
  });
});

describe('locale registry endpoint (M30, D-040)', () => {
  it('lists all six locales with honest reviewed/live flags', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/i18n/locales' });
    expect(res.statusCode).toBe(200);
    const { locales } = res.json() as {
      locales: Array<{ code: string; label: string; endonym: string; reviewed: boolean; live: boolean }>;
    };
    expect(locales.map((l) => l.code)).toEqual(['en', 'tw', 'ee', 'dag', 'ha', 'kus']);
    const en = locales.find((l) => l.code === 'en')!;
    expect(en.reviewed).toBe(true);
    expect(en.live).toBe(true);
    // Default config: nothing reviewed, draft-live off — only English is live.
    for (const l of locales.filter((x) => x.code !== 'en')) {
      expect(l.reviewed).toBe(false);
      expect(l.live).toBe(false);
    }
    expect(locales.find((l) => l.code === 'kus')!.endonym).toBe('Kʋsaal');
  });
});
