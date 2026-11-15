import { registerFarmer, registerLot } from '@ftm/core';
import { testBuyerToken, testToken } from '@ftm/core/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from './buildServer';

let app: FastifyInstance;
let buyerToken: string;
let farmerToken: string;

beforeAll(async () => {
  app = await buildServer({ logger: false });
  buyerToken = await testBuyerToken();
  const farmer = await registerFarmer({ phone: '+233207590001', name: 'Watch Farmer', regionCode: 'NORTHERN' });
  farmerToken = await testToken('farmer', farmer.id, farmer.phone);
  await registerLot({ farmerId: farmer.id, commodityCode: 'YAM', unitCode: 'TUBER', unitQty: 40, declaredBand: 'B' });
});
afterAll(async () => {
  await app.close();
});

const call = (method: 'GET' | 'POST' | 'DELETE', url: string, token?: string, body?: unknown) =>
  app.inject({
    method,
    url,
    payload: body === undefined ? undefined : JSON.stringify(body),
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });

describe('alerts ("tell me when…")', () => {
  it('needs a login', async () => {
    expect((await call('GET', '/api/watches')).statusCode).toBe(401);
    expect((await call('POST', '/api/watches', undefined, { commodityCode: 'MAIZE', kind: 'price_above', ghsPerKg: 5 })).statusCode).toBe(401);
  });

  it('lets a buyer set, list and remove an alert, with the price in cedis', async () => {
    const created = await call('POST', '/api/watches', buyerToken, { commodityCode: 'maize', kind: 'price_above', ghsPerKg: 5.25 });
    expect(created.statusCode).toBe(201);
    expect(created.json().watch.thresholdPerKg).toBe(525); // stored as pesewas

    const list = (await call('GET', '/api/watches', buyerToken)).json().watches;
    const mine = list.find((w: { commodityCode: string }) => w.commodityCode === 'MAIZE');
    expect(mine).toMatchObject({ kind: 'price_above', commodityName: 'Maize', thresholdPerKg: 525 });

    expect((await call('DELETE', `/api/watches/${mine.id}`, buyerToken)).statusCode).toBe(200);
    expect((await call('GET', '/api/watches', buyerToken)).json().watches.some((w: { id: string }) => w.id === mine.id)).toBe(false);
  });

  it('keeps one person’s alerts from another', async () => {
    const created = (await call('POST', '/api/watches', buyerToken, { commodityCode: 'ONION', kind: 'listing', ghsPerKg: 6 })).json().watch;
    expect((await call('DELETE', `/api/watches/${created.id}`, farmerToken)).statusCode).toBe(404);
    expect((await call('GET', '/api/watches', farmerToken)).json().watches).toHaveLength(0);
    await call('DELETE', `/api/watches/${created.id}`, buyerToken);
  });

  it('refuses a nonsense price or an unknown crop', async () => {
    expect((await call('POST', '/api/watches', buyerToken, { commodityCode: 'MAIZE', kind: 'price_above', ghsPerKg: -2 })).statusCode).toBe(400);
    expect((await call('POST', '/api/watches', buyerToken, { commodityCode: 'MAIZE', kind: 'sometimes', ghsPerKg: 2 })).statusCode).toBe(400);
    expect((await call('POST', '/api/watches', buyerToken, { commodityCode: 'UNOBTAINIUM', kind: 'price_above', ghsPerKg: 2 })).statusCode).toBe(404);
  });
});

describe('who has what, by region', () => {
  it('totals listed kilograms per region without naming anyone', async () => {
    const res = await call('GET', '/api/prices/crop/yam');
    expect(res.statusCode).toBe(200);
    const north = res.json().whereItIs.find((r: { regionCode: string }) => r.regionCode === 'NORTHERN');
    expect(north).toMatchObject({ supplyKg: 100, sellers: 1 }); // 40 tubers x 2.5 kg
    expect(JSON.stringify(res.json().whereItIs)).not.toContain('Watch Farmer');
  });
});
