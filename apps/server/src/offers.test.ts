import {
  createDemand,
  db,
  getContract,
  getLot,
  MockPaymentProvider,
  registerBuyer,
  registerFarmer,
  registerLot,
  schema,
  setPaymentProvider,
  type Farmer,
} from '@ftm/core';
import { testBuyer, testBuyerToken, testToken } from '@ftm/core/testing';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from './app';

/*
 * Phase 1 negotiation over the wire (docs/PHASE1.md): REST for both sides and
 * one USSD walk. Trades GROUNDNUT in 50kg bags so no other suite's requests
 * or listings match into these threads.
 */

const DAY = 24 * 60 * 60 * 1000;
let app: FastifyInstance;
let buyerToken: string;

let farmerSeq = 0;
let buyerSeq = 0;
const nextFarmerPhone = () => `+2332074952${String(++farmerSeq).padStart(2, '0')}`;
const nextBuyerPhone = () => `+2332074953${String(++buyerSeq).padStart(2, '0')}`;

beforeAll(async () => {
  setPaymentProvider(new MockPaymentProvider(0));
  app = await buildServer({ logger: false });
  buyerToken = testBuyerToken();
});
afterAll(async () => {
  setPaymentProvider(null);
  await app.close();
});

// A clean groundnut market per test: leftovers would be matched by the engine.
beforeEach(() => {
  const groundnut = db.select().from(schema.commodities).all().find((c) => c.code === 'GROUNDNUT')!;
  db.update(schema.demands)
    .set({ status: 'cancelled' })
    .where(and(eq(schema.demands.commodityId, groundnut.id), inArray(schema.demands.status, ['open', 'partially_matched'])))
    .run();
  db.update(schema.lots)
    .set({ status: 'withdrawn' })
    .where(and(eq(schema.lots.commodityId, groundnut.id), inArray(schema.lots.status, ['registered', 'matched'])))
    .run();
});

function seller(name = 'Groundnut Farmer'): { farmer: Farmer; token: string } {
  const farmer = registerFarmer({ phone: nextFarmerPhone(), name, regionCode: 'NORTHERN' });
  return { farmer, token: testToken('farmer', farmer.id, farmer.phone) };
}

function strangerBuyerToken(): string {
  const buyer = registerBuyer({ phone: nextBuyerPhone(), name: 'Nosy Buyer', company: 'Elsewhere Ltd', regionCode: 'VOLTA' });
  return testToken('buyer', buyer.id, buyer.phone!);
}

function groundnutLot(farmerId: string, bags = 10, extra: { readyDate?: number; askingPricePerUnit?: number } = {}) {
  return registerLot({ farmerId, commodityCode: 'GROUNDNUT', unitCode: 'BAG_50KG', unitQty: bags, declaredBand: 'B', channel: 'web', ...extra });
}

async function call(method: 'GET' | 'POST' | 'PATCH', url: string, token?: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}),
    headers: {
      ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
}

/** Drive POST /ussd the way the gateway does: form-encoded, text is the '*'-joined history. */
async function dial(phone: string, inputs: string[]): Promise<string[]> {
  const sessionId = `offers-${Math.random().toString(36).slice(2)}`;
  const send = async (text: string) => {
    const res = await app.inject({
      method: 'POST',
      url: '/ussd',
      payload: new URLSearchParams({ sessionId, phoneNumber: phone, serviceCode: '*384*7247#', text }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.statusCode).toBe(200);
    return res.body;
  };
  const responses = [await send('')];
  const history: string[] = [];
  for (const input of inputs) {
    history.push(input);
    responses.push(await send(history.join('*')));
    if (responses.at(-1)!.startsWith('END')) break;
  }
  return responses;
}

describe('REST negotiation', () => {
  it('runs bid → farmer counter → buyer accept end to end, and both sides see the deal', async () => {
    const { farmer, token: farmerToken } = seller();
    const lot = groundnutLot(farmer.id, 10, { askingPricePerUnit: 70000 });

    const bid = await call('POST', `/api/lots/${lot.id}/bids`, buyerToken, { units: 4, pricePerUnit: 60000 });
    expect(bid.statusCode).toBe(201);
    const offerId = bid.json().offer.id as string;
    expect(bid.json().offer).toMatchObject({ status: 'open', turn: 'farmer', current: { units: 4, pricePerUnit: 60000, total: 240000, by: 'buyer' } });

    const farmerList = await call('GET', '/api/farmer/offers', farmerToken);
    expect(farmerList.statusCode).toBe(200);
    const seen = farmerList.json().offers.find((o: { id: string }) => o.id === offerId);
    expect(seen).toMatchObject({ turn: 'farmer', lot: { id: lot.id, askingPricePerUnit: 70000, unitsAvailable: 10 } });

    // Not the buyer's turn.
    const early = await call('POST', `/api/offers/${offerId}/accept`, buyerToken, {});
    expect(early.statusCode).toBe(409);
    expect(early.json().error.code).toBe('NOT_YOUR_TURN');

    const counter = await call('POST', `/api/farmer/offers/${offerId}/counter`, farmerToken, { pricePerUnit: 66000 });
    expect(counter.statusCode).toBe(200);
    expect(counter.json().offer).toMatchObject({ turn: 'buyer', current: { units: 4, pricePerUnit: 66000, by: 'farmer' } });

    const buyerList = await call('GET', '/api/offers?status=open', buyerToken);
    expect(buyerList.statusCode).toBe(200);
    const mine = buyerList.json().offers.find((o: { id: string }) => o.id === offerId);
    expect(mine.turn).toBe('buyer');
    expect(mine.history.map((h: { by: string; action: string }) => `${h.by}:${h.action}`)).toEqual(['buyer:bid', 'farmer:counter']);
    expect(mine.history[1]).toMatchObject({ pricePerUnit: 66000, previousPricePerUnit: 60000, total: 264000 });

    const accept = await call('POST', `/api/offers/${offerId}/accept`, buyerToken, {});
    expect(accept.statusCode).toBe(200);
    const contractId = accept.json().contract.id as string;
    expect(accept.json().contract.state).toBe('ACCEPTED');
    expect(getContract(contractId)).toMatchObject({ agreedTotal: 264000, holdAmount: 264000, quantityKg: 200, lotId: lot.id });
    expect(getLot(lot.id).remainingKg).toBe(300);

    const buyerView = await call('GET', `/api/offers/${offerId}`, buyerToken);
    expect(buyerView.json().offer).toMatchObject({ status: 'accepted', turn: null, contractId });
    const farmerView = await call('GET', `/api/farmer/offers/${offerId}`, farmerToken);
    expect(farmerView.json().offer).toMatchObject({ status: 'accepted', contractId });

    const closed = await call('GET', '/api/farmer/offers?status=closed', farmerToken);
    expect(closed.json().offers.map((o: { id: string }) => o.id)).toContain(offerId);
  });

  it('refuses a bad bid with a readable error', async () => {
    const { farmer } = seller();
    const lot = groundnutLot(farmer.id, 2);
    const tooMany = await call('POST', `/api/lots/${lot.id}/bids`, buyerToken, { units: 3, pricePerUnit: 60000 });
    expect(tooMany.statusCode).toBe(409);
    expect(tooMany.json().error).toMatchObject({ code: 'NOT_ENOUGH_LEFT', message: expect.stringMatching(/Only 2 50kg bags left/) });

    const partUnit = await call('POST', `/api/lots/${lot.id}/bids`, buyerToken, { units: 1.5, pricePerUnit: 60000 });
    expect(partUnit.statusCode).toBe(400);
    const noPrice = await call('POST', `/api/lots/${lot.id}/bids`, buyerToken, { units: 1, pricePerUnit: 0 });
    expect(noPrice.statusCode).toBe(400);
  });
});

describe('who may see and move a thread', () => {
  it('keeps each side to its own threads and its own routes', async () => {
    const { farmer, token: farmerToken } = seller();
    const lot = groundnutLot(farmer.id, 10);
    const bid = await call('POST', `/api/lots/${lot.id}/bids`, buyerToken, { units: 2, pricePerUnit: 60000 });
    const offerId = bid.json().offer.id as string;

    // No login, or the wrong role, never reaches the route.
    expect((await call('GET', `/api/offers/${offerId}`)).statusCode).toBe(401);
    expect((await call('POST', `/api/lots/${lot.id}/bids`, farmerToken, { units: 1, pricePerUnit: 60000 })).statusCode).toBe(401);
    expect((await call('POST', `/api/farmer/offers/${offerId}/counter`, buyerToken, { pricePerUnit: 61000 })).statusCode).toBe(401);
    expect((await call('POST', `/api/offers/${offerId}/accept`, farmerToken, {})).statusCode).toBe(401);

    // A buyer who is not in the thread can neither read nor move it.
    const nosy = strangerBuyerToken();
    expect((await call('GET', `/api/offers/${offerId}`, nosy)).statusCode).toBe(403);
    expect((await call('POST', `/api/offers/${offerId}/withdraw`, nosy, {})).statusCode).toBe(403);
    // Nor can another farmer.
    const { token: otherFarmer } = seller('Other Farmer');
    expect((await call('GET', `/api/farmer/offers/${offerId}`, otherFarmer)).statusCode).toBe(403);
    expect((await call('POST', `/api/farmer/offers/${offerId}/accept`, otherFarmer, {})).statusCode).toBe(403);

    // The rightful buyer, waiting, may withdraw.
    const withdrawn = await call('POST', `/api/offers/${offerId}/withdraw`, buyerToken, {});
    expect(withdrawn.statusCode).toBe(200);
    expect(withdrawn.json().offer.status).toBe('withdrawn');
  });
});

describe('buyer requests on the farmer web', () => {
  it('lists an open request and lets the farmer offer on it', async () => {
    const buyer = testBuyer();
    const { farmer, token: farmerToken } = seller();
    // Ready after the request's window, so the engine leaves this pair alone and the farmer answers by hand.
    const lot = groundnutLot(farmer.id, 10, { readyDate: Date.now() + 40 * DAY });
    const request = createDemand({
      buyerId: buyer.id,
      commodityCode: 'GROUNDNUT',
      quantityKg: 400,
      minBand: 'B',
      basePricePerKg: 1300,
      windowStart: Date.now(),
      windowEnd: Date.now() + 30 * DAY,
      regionCode: 'NORTHERN',
    });
    expect(request.remainingKg).toBe(400);

    const list = await call('GET', '/api/farmer/requests', farmerToken);
    expect(list.statusCode).toBe(200);
    const row = list.json().requests.find((r: { id: string }) => r.id === request.id);
    expect(row).toMatchObject({
      commodityCode: 'GROUNDNUT',
      remainingKg: 400,
      minBand: 'B',
      targetPricePerKg: 1300,
      regionCode: 'NORTHERN',
      regionName: 'Northern',
      buyerName: buyer.company,
    });

    const offered = await call('POST', `/api/farmer/requests/${request.id}/offers`, farmerToken, { lotId: lot.id, units: 4, pricePerUnit: 64000 });
    expect(offered.statusCode).toBe(201);
    expect(offered.json().offer).toMatchObject({ turn: 'buyer', requestId: request.id, current: { units: 4, pricePerUnit: 64000, by: 'farmer' } });

    const after = await call('GET', '/api/farmer/requests', farmerToken);
    expect(after.json().requests.find((r: { id: string }) => r.id === request.id).remainingKg).toBe(200);

    const buyerList = await call('GET', '/api/offers', buyerToken);
    expect(buyerList.json().offers.find((o: { id: string }) => o.id === offered.json().offer.id).turn).toBe('buyer');

    const tooMuch = await call('POST', `/api/farmer/requests/${request.id}/offers`, farmerToken, { lotId: lot.id, units: 5, pricePerUnit: 64000 });
    expect(tooMuch.statusCode).toBe(409);
    expect((await call('GET', '/api/farmer/requests', buyerToken)).statusCode).toBe(401);
  });
});

describe('managing a listing on the farmer web', () => {
  it('PATCH changes quantity and price per unit, and refuses junk, strangers and going below what is sold', async () => {
    const { farmer, token: farmerToken } = seller();
    const lot = groundnutLot(farmer.id, 10);

    const patched = await call('PATCH', `/api/farmer/lots/${lot.id}`, farmerToken, { units: 12, askingPricePerUnit: 72000, community: 'Tolon' });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().lot).toMatchObject({ unitQty: 12, quantityKg: 600, remainingKg: 600, askingPricePerUnit: 72000, askingPricePerKg: 1440, community: 'Tolon' });

    expect((await call('PATCH', `/api/farmer/lots/${lot.id}`, farmerToken, { colour: 'red' })).statusCode).toBe(400);
    expect((await call('PATCH', `/api/farmer/lots/${lot.id}`, buyerToken, { units: 3 })).statusCode).toBe(401);
    const { token: otherFarmer } = seller('Not Mine');
    expect((await call('PATCH', `/api/farmer/lots/${lot.id}`, otherFarmer, { units: 3 })).statusCode).toBe(403);

    const bid = await call('POST', `/api/lots/${lot.id}/bids`, buyerToken, { units: 5, pricePerUnit: 70000 });
    await call('POST', `/api/farmer/offers/${bid.json().offer.id}/accept`, farmerToken, {});
    const below = await call('PATCH', `/api/farmer/lots/${lot.id}`, farmerToken, { units: 4 });
    expect(below.statusCode).toBe(400);
    expect(below.json().error.code).toBe('BELOW_SOLD');
  });

  it('POST /sold takes the listing off the market and closes the open bid on it', async () => {
    const { farmer, token: farmerToken } = seller();
    const lot = groundnutLot(farmer.id, 10);
    const bid = await call('POST', `/api/lots/${lot.id}/bids`, buyerToken, { units: 2, pricePerUnit: 60000 });
    const offerId = bid.json().offer.id as string;

    const sold = await call('POST', `/api/farmer/lots/${lot.id}/sold`, farmerToken, {});
    expect(sold.statusCode).toBe(200);
    expect(sold.json().lot).toMatchObject({ id: lot.id, status: 'sold' });

    const view = await call('GET', `/api/offers/${offerId}`, buyerToken);
    expect(view.json().offer.status).toBe('withdrawn');
    const again = await call('POST', `/api/lots/${lot.id}/bids`, buyerToken, { units: 1, pricePerUnit: 60000 });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('LOT_CLOSED');
  });
});

describe('USSD: answering a bid with a counter', () => {
  it('walks My offers → the bid → Counter → price → keep units → confirm', async () => {
    const { farmer } = seller('Abena Keypad');
    const lot = groundnutLot(farmer.id, 10);
    const bid = await call('POST', `/api/lots/${lot.id}/bids`, buyerToken, { units: 4, pricePerUnit: 60000 });
    const offerId = bid.json().offer.id as string;

    const screens = await dial(farmer.phone, ['2', '1', '2', '650', '0', '1']);
    const [home, list, detail, askPrice, askUnits, confirm, done] = screens;
    expect(home).toMatch(/^CON /);
    expect(home).toContain('2. My offers (1)');
    expect(list).toContain('Your offers:');
    expect(list).toContain('4 50kg bag Groundnut at GHS 600.00 - your answer');
    expect(detail).toContain('offers 4 50kg bag of Groundnut at GHS 600.00 each (GHS 2400.00)');
    expect(detail).toContain('2. Counter');
    expect(askPrice).toContain('Your price per 50kg bag in GHS (they offered GHS 600.00)');
    expect(askUnits).toContain('Send 0 to keep 4');
    expect(confirm).toContain('Offer 4 50kg bag of Groundnut at GHS 650.00 each (GHS 2600.00)?');
    expect(done).toMatch(/^END Sent to /);
    expect(done).toContain(testBuyer().company!);

    const view = await call('GET', `/api/offers/${offerId}`, buyerToken);
    expect(view.json().offer).toMatchObject({ turn: 'buyer', current: { units: 4, pricePerUnit: 65000, by: 'farmer' } });
    expect(view.json().offer.history.at(-1)).toMatchObject({ by: 'farmer', action: 'counter', channel: 'ussd', previousPricePerUnit: 60000 });
  });
});
