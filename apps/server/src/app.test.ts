import { DEMO_BUYER } from '@ftm/core';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from './app';

let app: FastifyInstance;
let token: string;

beforeAll(async () => {
  app = await buildServer({ logger: false });
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

  it('logs the demo buyer in', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: DEMO_BUYER.email, password: DEMO_BUYER.password },
    });
    expect(res.statusCode).toBe(200);
    token = res.json().token;
    expect(token).toBeTruthy();

    const bad = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: DEMO_BUYER.email, password: 'wrong' },
    });
    expect(bad.statusCode).toBe(401);
  });

  let farmerId: string;
  let lotId: string;

  it('registers a farmer, then rejects the duplicate phone', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/farmers',
      payload: { phone: '0201112223', name: 'Kwame Boateng', regionCode: 'ASHANTI', district: 'Ejura' },
    });
    expect(res.statusCode).toBe(201);
    farmerId = res.json().farmer.id;
    expect(res.json().farmer.phone).toBe('+233201112223');

    const dup = await app.inject({
      method: 'POST',
      url: '/api/farmers',
      payload: { phone: '0201112223', name: 'Someone Else', regionCode: 'BONO' },
    });
    expect(dup.statusCode).toBe(409);
  });

  it('registers a lot in olonka and traces LOT_REGISTERED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/lots',
      payload: { farmerId, commodityCode: 'MAIZE', unitCode: 'OLONKA', unitQty: 200, declaredBand: 'B' },
    });
    expect(res.statusCode).toBe(201);
    const lot = res.json().lot;
    lotId = lot.id;
    expect(lot.quantityKg).toBe(500); // 200 olonka × 2.5kg
    expect(lot.lotCode).toMatch(/^FTM-/);

    const trace = await app.inject({ method: 'GET', url: `/api/lots/${lotId}/trace` });
    expect(trace.statusCode).toBe(200);
    const events = trace.json().events;
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('LOT_REGISTERED');
    expect(events[0].payload.unit).toBe('OLONKA');
  });

  it('rejects a perishable forward listing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/lots',
      payload: {
        farmerId,
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

    const res = await app.inject({
      method: 'POST',
      url: '/api/demands',
      payload,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(201);
    const demand = res.json().demand;
    expect(demand.priceTerms.B).toBe(400);
    expect(demand.priceTerms.REJECT).toBe(0);
    // Matching ran on creation: the 500kg lot registered above covers all 400kg.
    expect(demand.remainingKg).toBe(0);
    expect(demand.status).toBe('fulfilled');

    const detail = await app.inject({
      method: 'GET',
      url: `/api/demands/${demand.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const { matches } = detail.json();
    expect(matches).toHaveLength(1);
    expect(matches[0].allocatedKg).toBe(400);
    expect(matches[0].contractState).toBe('OFFERED');
    expect(matches[0].breakdown.weights.farmerHistory).toBe(0.3); // storable weights
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
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('WINDOW_TOO_FAR');
  });
});
