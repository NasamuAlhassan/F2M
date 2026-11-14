import {
  acceptJob,
  addPhoto,
  confirmJobPickup,
  db,
  driverArrived,
  getContract,
  getJob,
  MockPaymentProvider,
  placeBid,
  pollPaymentsOnce,
  registerBuyer,
  registerDriver,
  registerFarmer,
  registerLot,
  requestTransport,
  runGrading,
  schema,
  setGradingProvider,
  setPaymentProvider,
} from '@ftm/core';
import { acceptFor, testBuyer, testBuyerToken, testToken } from '@ftm/core/testing';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from './app';

/**
 * The deal page: one sale seen by its buyer, farmer and driver, with whose
 * move it is next and every step on one timeline. Cowpea and the
 * +2332074975xx numbers are this suite's own: the database is shared.
 */

let app: FastifyInstance;
let seq = 0;
const phone = () => `+2332074975${String(++seq).padStart(2, '0')}`;

beforeAll(async () => {
  app = await buildServer({ logger: false });
  setPaymentProvider(new MockPaymentProvider(0));
  setGradingProvider({
    name: 'mock',
    grade: async () => ({ gradeBand: 'B', confidence: 0.9, reasons: [{ criterion: 'moisture', observation: 'dry', bandForCriterion: 'B' }], provider: 'mock' }),
  });
});
afterAll(async () => {
  setPaymentProvider(null);
  setGradingProvider(null);
  await app.close();
});
beforeEach(() => {
  const cowpea = db.select().from(schema.commodities).all().find((c) => c.code === 'COWPEA')!;
  db.update(schema.demands)
    .set({ status: 'cancelled' })
    .where(and(eq(schema.demands.commodityId, cowpea.id), inArray(schema.demands.status, ['open', 'partially_matched'])))
    .run();
});

const view = (id: string, token: string) => app.inject({ method: 'GET', url: `/api/deals/${id}`, headers: { authorization: `Bearer ${token}` } });

/** A cowpea sale carried by a driver, graded, with the driver at the buyer's door. */
async function arrivedDeal() {
  const buyer = testBuyer();
  const farmer = registerFarmer({ phone: phone(), name: 'Ama Cowpea', regionCode: 'UPPER_EAST', district: 'Bawku' });
  const lot = registerLot({ farmerId: farmer.id, commodityCode: 'COWPEA', unitCode: 'BAG_100KG', unitQty: 4, declaredBand: 'A' });
  placeBid({ buyerId: buyer.id, lotId: lot.id, units: 4, pricePerUnit: 95_000 });
  const order = await acceptFor(farmer.id, lot.id);
  await pollPaymentsOnce();
  const driver = registerDriver({ phone: phone(), name: 'Kofi Van', regionCode: 'UPPER_EAST', vehicleClassCode: 'van', pin: '1234' });
  const job = requestTransport(order.id, buyer.id, undefined, driver.id);
  await acceptJob(job.id, driver.id);
  await pollPaymentsOnce();
  confirmJobPickup(job.id, driver.id);
  const buffer = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 200, g: 180, b: 150 } } }).jpeg().toBuffer();
  await addPhoto({ contractId: order.id, buffer, actor: { type: 'buyer', id: buyer.id } });
  await runGrading(order.id);
  await pollPaymentsOnce(); // the advance lands
  driverArrived(getJob(job.id).id, driver.id);
  expect(getContract(order.id).state).toBe('DELIVERED');
  return {
    contractId: order.id,
    farmer,
    driver,
    buyerToken: testBuyerToken(),
    farmerToken: testToken('farmer', farmer.id, farmer.phone),
    driverToken: testToken('driver', driver.id, driver.phone),
  };
}

describe('the deal page', () => {
  it('the buyer sees whose move it is (theirs, with the deadline), the money, and every step', async () => {
    const d = await arrivedDeal();
    const res = await view(d.contractId, d.buyerToken);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.viewer).toBe('buyer');
    expect(body.next).toMatchObject({ actor: 'buyer', action: 'confirm_receipt' });
    expect(body.next.dueAt).toBe(getContract(d.contractId).receiptDueAt);
    expect(body.money).toMatchObject({ total: 380_000, advance: 114_000, paidToFarmer: 114_000, stillHeld: 266_000 });
    expect(body.deal).toMatchObject({ crop: { code: 'COWPEA' }, unit: { code: 'BAG_100KG', qty: 4 }, declaredGrade: 'A', finalGrade: 'B' });

    const kinds = body.timeline.map((i: { kind: string }) => i.kind);
    for (const k of ['offer_made', 'accepted', 'funds_held', 'driver_assigned', 'loaded', 'graded', 'advance_paid', 'arrived', 'delivered']) {
      expect(kinds).toContain(k);
    }
    // The buyer can see the farmer was reached on her own phone.
    const notices = body.timeline.filter((i: { kind: string }) => i.kind === 'notice_sent');
    expect(notices.some((n: { channel: string }) => n.channel === 'sms')).toBe(true);
    expect(notices.some((n: { channel: string }) => n.channel === 'voice')).toBe(true);
    // In time order.
    const times = body.timeline.map((i: { at: number }) => i.at);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    // Phones while the deal is live; nobody's MoMo number.
    expect(body.people.farmer.phone).toBe(d.farmer.phone);
    expect(JSON.stringify(body)).not.toContain('momo');
  });

  it('the driver sees the job, not the prices, the money or the haggling', async () => {
    const d = await arrivedDeal();
    const body = (await view(d.contractId, d.driverToken)).json();
    expect(body.viewer).toBe('driver');
    expect(body.money).toBeNull();
    expect(body.deal.total).toBeNull();
    expect(body.deal.pricePerKg).toBeNull();
    expect(body.claims).toEqual([]);
    const kinds = body.timeline.map((i: { kind: string }) => i.kind);
    expect(kinds).not.toContain('offer_made');
    expect(kinds).not.toContain('advance_paid');
    expect(kinds).not.toContain('notice_sent');
    // No amounts, except the driver's own fee once it is paid.
    for (const item of body.timeline) if (item.kind !== 'driver_paid') expect(item.data.amount).toBeUndefined();
  });

  it('the farmer sees the same next step as the buyer: it is the buyer’s turn', async () => {
    const d = await arrivedDeal();
    const body = (await view(d.contractId, d.farmerToken)).json();
    expect(body.viewer).toBe('farmer');
    expect(body.next).toMatchObject({ actor: 'buyer', action: 'confirm_receipt' });
    expect(body.people.farmer.phone).toBeNull(); // her own number is not news to her
  });

  it('is invisible to anyone else: 404, not 403', async () => {
    const d = await arrivedDeal();
    const stranger = registerBuyer({ phone: phone(), name: 'Other Buyer', company: 'Elsewhere Ltd', regionCode: 'ASHANTI' });
    const res = await view(d.contractId, testToken('buyer', stranger.id, stranger.phone!));
    expect(res.statusCode).toBe(404);
    expect((await view('no-such-deal', d.buyerToken)).statusCode).toBe(404);
  });

  it('lists a party’s deals with their next step', async () => {
    const d = await arrivedDeal();
    const res = await app.inject({ method: 'GET', url: '/api/deals', headers: { authorization: `Bearer ${d.driverToken}` } });
    expect(res.statusCode).toBe(200);
    const mine = res.json().deals.find((x: { id: string }) => x.id === d.contractId);
    expect(mine).toMatchObject({ viewer: 'driver', total: null, money: null, next: { actor: 'buyer' } });
  });
});
