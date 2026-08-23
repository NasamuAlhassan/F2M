import {
  createDemand,
  db,
  getContract,
  listContractsForFarmer,
  MockPaymentProvider,
  registerFarmer,
  registerLot,
  schema,
  setPaymentProvider,
  t,
  verifyBuyerLogin,
} from '@ftm/core';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from './app';

const DAY = 24 * 60 * 60 * 1000;
let app: FastifyInstance;
let token: string;

beforeAll(async () => {
  setPaymentProvider(new MockPaymentProvider(0));
  app = await buildServer({ logger: false });
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: JSON.stringify({ email: 'buyer@demo.ftm', password: 'demo-buyer-2026' }),
    headers: { 'content-type': 'application/json' },
  });
  token = login.json().token;
});
afterAll(async () => {
  setPaymentProvider(null);
  await app.close();
});

async function get<T>(url: string): Promise<T> {
  const res = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
  expect(res.statusCode).toBe(200);
  return res.json() as T;
}

async function offeredContract(phone: string) {
  const yam = db.select().from(schema.commodities).all().find((c) => c.code === 'YAM')!;
  db.update(schema.demands)
    .set({ status: 'cancelled' })
    .where(and(eq(schema.demands.commodityId, yam.id), inArray(schema.demands.status, ['open', 'partially_matched'])))
    .run();
  db.update(schema.lots)
    .set({ status: 'withdrawn' })
    .where(and(eq(schema.lots.commodityId, yam.id), eq(schema.lots.status, 'registered')))
    .run();
  const buyer = verifyBuyerLogin('buyer@demo.ftm', 'demo-buyer-2026');
  const farmer = registerFarmer({ phone, name: 'Engine Farmer', regionCode: 'BONO_EAST' });
  registerLot({ farmerId: farmer.id, commodityCode: 'YAM', unitCode: 'HUNDRED', unitQty: 2, declaredBand: 'B' });
  createDemand({
    buyerId: buyer.id,
    commodityCode: 'YAM',
    quantityKg: 600, // 500kg lot fills it partially — the demand stays on the active feed
    minBand: 'B',
    basePricePerKg: 400,
    windowStart: Date.now(),
    windowEnd: Date.now() + 7 * DAY,
    regionCode: 'GREATER_ACCRA',
  });
  return { farmer, contract: listContractsForFarmer(farmer.id, ['OFFERED'])[0]! };
}

describe('AI engine section (M19)', () => {
  it('serves the active intent feed with lots, buy orders, and scored matches', async () => {
    const { contract } = await offeredContract('+233207440101');
    interface Feed {
      lots: Array<{ lotCode: string; commodityName: string; remainingKg: number }>;
      demands: Array<{ commodityName: string; mine: boolean }>;
      matches: Array<{
        contractId: string;
        state: string;
        scorePct: number | null;
        distanceKm: number | null;
        logisticsEstimate: number | null;
      }>;
      simulateEnabled: boolean;
    }
    const feed = await get<Feed>('/api/engine/feed');

    expect(feed.simulateEnabled).toBe(true); // mock payment mode
    expect(feed.demands.some((d) => d.commodityName === 'Yam' && d.mine)).toBe(true);
    const match = feed.matches.find((m) => m.contractId === contract.id)!;
    expect(match.state).toBe('OFFERED');
    expect(match.scorePct).toBeGreaterThan(0);
    expect(match.scorePct).toBeLessThanOrEqual(100);
    expect(match.distanceKm).toBeGreaterThan(0);
    expect(match.logisticsEstimate).toBeGreaterThan(0); // auto-calculated logistics cost
  });

  it('renders the alert simulation in Twi, Ewe, and Dagbani with the review flag', async () => {
    const { contract } = await offeredContract('+233207440202');
    interface Preview {
      locales: Array<{ code: string }>;
      reviewNote: boolean;
      sms: string;
      voice: string[];
    }

    const en = await get<Preview>(`/api/engine/alert-preview?contractId=${contract.id}&locale=en`);
    expect(en.locales.map((l) => l.code)).toEqual(['en', 'tw', 'ee', 'dag']);
    expect(en.reviewNote).toBe(false);
    expect(en.sms).toContain('500kg Yam');

    const tw = await get<Preview>(`/api/engine/alert-preview?contractId=${contract.id}&locale=tw`);
    expect(tw.reviewNote).toBe(true);
    expect(tw.sms).toContain(t('tw', 'commodity.YAM')); // Bayerɛ
    expect(tw.voice[1]).toBe(t('tw', 'voice.offer.menu'));

    const ee = await get<Preview>(`/api/engine/alert-preview?contractId=${contract.id}&locale=ee`);
    expect(ee.sms).toContain(t('ee', 'commodity.YAM')); // Te

    const dag = await get<Preview>(`/api/engine/alert-preview?contractId=${contract.id}&locale=dag`);
    expect(dag.sms).toContain(t('dag', 'commodity.YAM')); // Nyuya
    // Params interpolate in every locale — no raw {placeholders} left behind.
    for (const p of [tw, ee, dag]) expect(p.sms).not.toMatch(/\{\w+\}/);
  });

  it('simulate-accept runs the farmer acceptance in demo mode, ownership-guarded', async () => {
    const { contract } = await offeredContract('+233207440303');
    const res = await app.inject({
      method: 'POST',
      url: '/api/engine/simulate-accept',
      payload: JSON.stringify({ contractId: contract.id }),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().contract.state).toBe('ACCEPTED');
    expect(getContract(contract.id).state).toBe('ACCEPTED');
  });

  it('falls back to English for keys the simulation catalogs do not cover', async () => {
    // sms.jobOffer exists only in en — a tw lookup must not break.
    expect(t('tw', 'sms.jobOffer', { code: 'DLV-1', kg: 1, km: 1, fee: 'GHS 1', ussd: '*1#' })).toContain('Delivery job');
  });
});
