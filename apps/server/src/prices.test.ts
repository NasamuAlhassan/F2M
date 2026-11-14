import { config, getCommodityByCode, recordPrice } from '@ftm/core';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from './app';

const DAY = 24 * 60 * 60 * 1000;
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildServer({ logger: false });
  // Plantain: a run of recent deals, nobody else's crop.
  const c = getCommodityByCode('PLANTAIN').id;
  for (let i = 0; i < 6; i += 1) recordPrice({ commodityId: c, pricePerKg: 500 + i, source: 'deal', refId: `route-pl-${i}`, observedAt: Date.now() - (i + 1) * DAY });
});
afterAll(async () => {
  await app.close();
});

const get = (url: string) => app.inject({ method: 'GET', url });

describe('GET /api/prices/overview', () => {
  it('is public and lists every crop with price, supply and demand', async () => {
    const res = await get('/api/prices/overview');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const plantain = body.crops.find((c: { commodityCode: string }) => c.commodityCode === 'PLANTAIN');
    expect(plantain.commodityName).toBeTruthy();
    expect(plantain.estimate.pricePerKg).toBeGreaterThan(450);
    expect(plantain.unit.kgPerUnit).toBe(12);
    expect(plantain).toHaveProperty('supplyKg');
    expect(plantain).toHaveProperty('demandKg');
    expect(body.crops.length).toBeGreaterThanOrEqual(13);
  });
});

describe('GET /api/prices/crop/:code', () => {
  it('gives the series, trend inputs, markets and the unit', async () => {
    const res = await get('/api/prices/crop/plantain');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.commodityCode).toBe('PLANTAIN');
    expect(body.recent.length).toBeGreaterThan(0);
    expect(body.estimate.confidence).toMatch(/high|medium/);
  });
  it('404s an unknown crop', async () => {
    expect((await get('/api/prices/crop/unobtainium')).statusCode).toBe(404);
  });
});

describe('GET /api/prices/check', () => {
  it('judges a price per unit and says so in words', async () => {
    // A 12 kg bunch of plantain at ~GHS 5.03/kg is ~GHS 60.
    const fair = (await get('/api/prices/check?commodity=PLANTAIN&unit=BUNCH&price=6100&side=sell')).json();
    expect(fair.verdict).toBe('fair');
    expect(fair.message).toContain('GHS');
    const high = (await get('/api/prices/check?commodity=PLANTAIN&unit=BUNCH&price=20000&side=sell')).json();
    expect(['high', 'very_high']).toContain(high.verdict);
    expect(high.message.length).toBeGreaterThan(10);
  });
  it('answers "what is it worth" without a price', async () => {
    const body = (await get('/api/prices/check?commodity=PLANTAIN&unit=BUNCH')).json();
    expect(body.suggested.perUnit.low).toBeLessThan(body.suggested.perUnit.high);
  });
  it('rejects a nonsense query', async () => {
    expect((await get('/api/prices/check?commodity=PLANTAIN&price=-3')).statusCode).toBe(400);
  });
});

describe('POST /api/feeds/prices', () => {
  const body = { dataset: 'route-test', observations: [{ commodity: 'MAIZE', market: 'Tamale', regionCode: 'NORTHERN', ghsPerKg: 4.4 }] };
  const post = (token?: string) =>
    app.inject({
      method: 'POST',
      url: '/api/feeds/prices',
      payload: JSON.stringify(body),
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });

  it('is closed (404) until a token is configured', async () => {
    expect(config.PRICE_INGEST_TOKEN).toBeUndefined();
    expect((await post('anything-at-all-goes-here')).statusCode).toBe(404);
  });

  it('accepts rows with the right token and refuses the wrong one', async () => {
    const token = 'a-long-enough-test-ingest-token';
    (config as { PRICE_INGEST_TOKEN?: string }).PRICE_INGEST_TOKEN = token;
    try {
      expect((await post()).statusCode).toBe(401);
      expect((await post('a-long-enough-test-ingest-tokeX')).statusCode).toBe(401);
      const ok = await post(token);
      expect(ok.statusCode).toBe(200);
      expect(ok.json().accepted).toBe(1);
    } finally {
      delete (config as { PRICE_INGEST_TOKEN?: string }).PRICE_INGEST_TOKEN;
    }
  });
});
