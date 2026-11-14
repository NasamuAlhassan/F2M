import {
  config,
  createDemand,
  db,
  getContract,
  getOffer,
  MockPaymentProvider,
  registerBuyer,
  registerFarmer,
  registerLot,
  schema,
  setPaymentProvider,
  t,
  tDraft,
} from '@ftm/core';
import { and, eq, inArray } from 'drizzle-orm';
import { acceptFor, openOfferFor, testBuyer, testBuyerToken, testToken } from '@ftm/core/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from './app';

const DAY = 24 * 60 * 60 * 1000;
let app: FastifyInstance;
let token: string;

beforeAll(async () => {
  setPaymentProvider(new MockPaymentProvider(0));
  app = await buildServer({ logger: false });
  token = testBuyerToken();
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
  const buyer = testBuyer();
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
  // Phase 1: the engine's match is a bid (offer thread) waiting on the farmer, not an OFFERED contract.
  return { farmer, offer: openOfferFor(farmer.id)! };
}

describe('AI engine section (M19)', () => {
  it('serves the active intent feed with lots, buy orders, open bids, and scored matches', async () => {
    const { farmer, offer } = await offeredContract('+233207440101');
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
      offers: Array<{ id: string; turn: string; current: { units: number; pricePerUnit: number } }>;
      simulateEnabled: boolean;
    }
    const feed = await get<Feed>('/api/engine/feed');

    expect(feed.simulateEnabled).toBe(true); // mock payment mode
    expect(feed.demands.some((d) => d.commodityName === 'Yam' && d.mine)).toBe(true);
    // The engine's bid is on the feed while it waits on the farmer: 2 Hundred at GHS 4.00/kg × 250kg.
    const bid = feed.offers.find((o) => o.id === offer.id)!;
    expect(bid.turn).toBe('farmer');
    expect(bid.current).toMatchObject({ units: 2, pricePerUnit: 100000 });

    // Once she accepts, the order is a scored match with its logistics estimate.
    const contract = await acceptFor(farmer.id);
    const after = await get<Feed>('/api/engine/feed');
    expect(after.offers.some((o) => o.id === offer.id)).toBe(false); // no longer open
    const match = after.matches.find((m) => m.contractId === contract.id)!;
    expect(match.state).toBe('ACCEPTED'); // hold started; the poll would resolve it
    expect(match.scorePct).toBeGreaterThan(0);
    expect(match.scorePct).toBeLessThanOrEqual(100);
    expect(match.distanceKm).toBeGreaterThan(0);
    expect(match.logisticsEstimate).toBeGreaterThan(0); // auto-calculated logistics cost
  });

  it('renders the alert simulation in Twi, Ewe, and Dagbani with the review flag', async () => {
    const { offer } = await offeredContract('+233207440202');
    interface Preview {
      locales: Array<{ code: string }>;
      reviewNote: boolean;
      sms: string;
      voice: string[];
      smsStatus: string | null;
      callStatus: string | null;
    }

    // Phase 1 previews the bid alerts (sms.bidReceived + voice.bid.*) for an offer thread.
    const en = await get<Preview>(`/api/engine/alert-preview?offerId=${offer.id}&locale=en`);
    expect(en.locales.map((l) => l.code)).toEqual(['en', 'tw', 'ee', 'dag', 'ha', 'kus']);
    expect(en.reviewNote).toBe(false);
    expect(en.sms).toContain('2 Hundred (100 tubers) of your Yam at GHS 1000.00 each (GHS 2000.00)');
    expect(en.voice[0]).toContain('2 Hundred (100 tubers) of your Yam at GHS 1000.00 each, GHS 2000.00 in all');
    expect(en.smsStatus).not.toBeNull(); // the real SMS that went out
    expect(en.callStatus).toBe('pending'); // and the call queued beside it

    // The drawer is the sanctioned PREVIEW surface (D-040): it shows drafts via
    // tDraft even while the gated t() still resolves these locales to English.
    const tw = await get<Preview>(`/api/engine/alert-preview?offerId=${offer.id}&locale=tw`);
    expect(tw.reviewNote).toBe(true);
    expect(tw.sms).toContain(tDraft('tw', 'commodity.YAM')); // Bayerɛ
    expect(tw.voice[1]).toBe(tDraft('tw', 'voice.bid.menu', { code: config.USSD_SHORTCODE }));
    expect(t('tw', 'commodity.YAM')).toBe('Yam'); // the gate, closed

    const ee = await get<Preview>(`/api/engine/alert-preview?offerId=${offer.id}&locale=ee`);
    expect(ee.sms).toContain(tDraft('ee', 'commodity.YAM')); // Te

    const dag = await get<Preview>(`/api/engine/alert-preview?offerId=${offer.id}&locale=dag`);
    expect(dag.sms).toContain(tDraft('dag', 'commodity.YAM')); // Nyuya
    // Params interpolate in every locale — no raw {placeholders} left behind.
    for (const p of [tw, ee, dag]) {
      expect(p.sms).not.toMatch(/\{\w+\}/);
      for (const line of p.voice) expect(line).not.toMatch(/\{\w+\}/);
    }
  });

  it('simulate-accept runs the farmer acceptance in demo mode, ownership-guarded', async () => {
    const { offer } = await offeredContract('+233207440303');
    const simulate = (bearer: string) =>
      app.inject({
        method: 'POST',
        url: '/api/engine/simulate-accept',
        payload: JSON.stringify({ offerId: offer.id }),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
      });

    // Another buyer cannot accept on this buyer's thread.
    const stranger = registerBuyer({ phone: '0555000444', name: 'Other Buyer', regionCode: 'ASHANTI' });
    const refused = await simulate(testToken('buyer', stranger.id, stranger.phone!));
    expect(refused.statusCode).toBe(403);
    expect(getOffer(offer.id).status).toBe('open');

    const res = await simulate(token);
    expect(res.statusCode).toBe(200);
    expect(res.json().contract.state).toBe('ACCEPTED');
    const accepted = getOffer(offer.id);
    expect(accepted.status).toBe('accepted');
    expect(accepted.contractId).toBe(res.json().contract.id);
    expect(getContract(res.json().contract.id).agreedTotal).toBe(200000);
  });

  it('falls back to English for keys the simulation catalogs do not cover', async () => {
    // sms.jobOffer exists only in en — a tw lookup must not break.
    expect(t('tw', 'sms.jobOffer', { code: 'DLV-1', kg: 1, km: 1, fee: 'GHS 1', ussd: '*1#' })).toContain('Delivery job');
  });
});
