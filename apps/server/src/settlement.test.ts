import {
  acceptJob,
  addPhoto,
  agreeGrading,
  confirmPickup,
  config,
  contractEscrowBalance,
  db,
  fileClaim,
  getClaim,
  getContract,
  getJob,
  listLotsByFarmer,
  listNotificationsForPhone,
  listVoiceCallsForPhone,
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
import { handleUssdRequest } from './ussd/index';

/**
 * Phase 3 over the wire (docs/PHASE3.md): receipt and claims on REST, the
 * farmer's answer on REST, USSD and a call, F2M's decision on the simulator
 * route, and the driver's milestones on REST and USSD. Sorghum and the
 * +2332074972xx/73xx numbers are this suite's own: the database is shared.
 */

const UNITS = 5; // 5 × 100kg bags
const PRICE = 60_000; // GHS 600 a bag
const TOTAL = UNITS * PRICE;
const ADVANCE = Math.round((TOTAL * config.FARMER_ADVANCE_PERCENT) / 100);

let app: FastifyInstance;
let farmerSeq = 0;
let driverSeq = 0;
const farmerPhone = () => `+2332074972${String(++farmerSeq).padStart(2, '0')}`;
const driverPhone = () => `+2332074973${String(++driverSeq).padStart(2, '0')}`;

beforeAll(async () => {
  app = await buildServer({ logger: false });
  setPaymentProvider(new MockPaymentProvider(0));
  setGradingProvider({
    name: 'mock',
    grade: async () => ({
      gradeBand: 'B',
      confidence: 0.9,
      reasons: [{ criterion: 'moisture', observation: 'dry grain', bandForCriterion: 'B' }],
      provider: 'mock',
    }),
  });
});
afterAll(async () => {
  setPaymentProvider(null);
  setGradingProvider(null);
  await app.close();
});
beforeEach(async () => {
  // A stray open sorghum request would make the engine bid on our listings too.
  const sorghum = (await db.select().from(schema.commodities)).find((c) => c.code === 'SORGHUM')!;
  (await db.update(schema.demands)
        .set({ status: 'cancelled' })
        .where(and(eq(schema.demands.commodityId, sorghum.id), inArray(schema.demands.status, ['open', 'partially_matched']))));
});

function post(url: string, body: unknown, token?: string) {
  return app.inject({
    method: 'POST',
    url,
    payload: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
}
function get(url: string, token: string) {
  return app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
}

async function landAll() {
  await pollPaymentsOnce();
  await pollPaymentsOnce();
}

async function photo(): Promise<Buffer> {
  return sharp({ create: { width: 1200, height: 900, channels: 3, background: { r: 170, g: 90, b: 60 } } })
    .jpeg()
    .toBuffer();
}

async function fundedOrder() {
  const buyer = await testBuyer();
  const farmer = await registerFarmer({ phone: farmerPhone(), name: 'Sorghum Farmer', regionCode: 'NORTHERN' });
  const lot = await registerLot({ farmerId: farmer.id, commodityCode: 'SORGHUM', unitCode: 'BAG_100KG', unitQty: UNITS, declaredBand: 'B' });
  await placeBid({ buyerId: buyer.id, lotId: lot.id, units: UNITS, pricePerUnit: PRICE });
  const order = await acceptFor(farmer.id, lot.id);
  await pollPaymentsOnce();
  expect(await getContract(order.id)).toMatchObject({ state: 'FUNDS_HELD', agreedTotal: TOTAL });
  return { buyer, farmer, lot, contractId: order.id };
}

async function grade(contractId: string) {
  await addPhoto({ contractId, buffer: await photo(), actor: { type: 'buyer', id: (await testBuyer()).id } });
  await runGrading(contractId);
  await pollPaymentsOnce(); // the advance lands
}

/** No transport job: graded, the farmer agrees, the buyer's 24 h clock runs. */
async function deliveredOrder() {
  const order = await fundedOrder();
  await confirmPickup(order.contractId, { type: 'farmer', id: order.farmer.id });
  await grade(order.contractId);
  await agreeGrading(order.contractId, order.farmer.id);
  expect((await getContract(order.contractId)).state).toBe('DELIVERED');
  return order;
}

/** A funded order with a hired driver whose fee is secured, before pickup. */
async function orderWithDriver() {
  const order = await fundedOrder();
  const driver = await registerDriver({ phone: driverPhone(), name: 'Sorghum Driver', regionCode: 'NORTHERN', vehicleClassCode: 'van', pin: '1234' });
  const requested = await requestTransport(order.contractId, order.buyer.id, undefined, driver.id);
  await acceptJob(requested.id, driver.id);
  await pollPaymentsOnce();
  expect((await getJob(requested.id)).state).toBe('FUNDS_HELD');
  return { ...order, driver, job: await getJob(requested.id) };
}

async function otherBuyerToken(phone: string): Promise<string> {
  const other = await registerBuyer({ phone, name: 'Other Buyer', regionCode: 'GREATER_ACCRA' });
  return testToken('buyer', other.id, other.phone!);
}

async function dial(phone: string, inputs: string[]): Promise<string[]> {
  const sessionId = `stl-${Math.random().toString(36).slice(2)}`;
  const responses = [await handleUssdRequest({ sessionId, phoneNumber: phone, text: '' })];
  const history: string[] = [];
  for (const input of inputs) {
    history.push(input);
    responses.push(await handleUssdRequest({ sessionId, phoneNumber: phone, text: history.join('*') }));
    if (responses.at(-1)!.startsWith('END')) break;
  }
  return responses;
}

/** The keypress that opens this lot on USSD My lots. */
async function lotKey(farmerId: string, lotId: string): Promise<string> {
  return String((await listLotsByFarmer(farmerId)).slice(0, 5).findIndex((l) => l.id === lotId) + 1);
}

const said = (xml: string) => [...xml.matchAll(/<Say[^>]*>([^<]*)<\/Say>/g)].map((m) => m[1]).join(' ').replaceAll('&amp;', '&');

/** A voice call driven the way the gateway drives it: each answer goes to the callbackUrl the last response named. */
class Call {
  xml = '';
  private readonly sessionId = `c-${Math.random().toString(36).slice(2)}`;
  constructor(private readonly phone: string) {}

  private async post(url: string, fields: Record<string, string>) {
    const u = new URL(url, 'http://localhost:3000');
    const res = await app.inject({
      method: 'POST',
      url: u.pathname + u.search,
      payload: new URLSearchParams({ sessionId: this.sessionId, callerNumber: this.phone, isActive: '1', ...fields }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.statusCode).toBe(200);
    this.xml = res.body;
    return this;
  }

  answer(callId: string) {
    return this.post(`/voice/answer?callId=${callId}`, {});
  }

  press(digits: string) {
    const tag = /callbackUrl="([^"]+)"/.exec(this.xml);
    if (!tag) throw new Error(`no GetDigits in: ${this.xml}`);
    return this.post(tag[1]!.replaceAll('&amp;', '&'), { dtmfDigits: digits });
  }

  get text() {
    return said(this.xml);
  }

  get ended() {
    return !this.xml.includes('<GetDigits') && !this.xml.includes('<Record') && !this.xml.includes('<Redirect');
  }
}

describe('receipt over REST', () => {
  it('the order page shows where the money stands; only its buyer can confirm receipt, which settles it', async () => {
    const { contractId } = await deliveredOrder();
    const token = await testBuyerToken();

    const before = await get(`/api/contracts/${contractId}`, token);
    expect(before.statusCode).toBe(200);
    expect(before.json().settlement).toMatchObject({
      total: TOTAL,
      advance: ADVANCE,
      paidToFarmer: ADVANCE,
      onTheWay: 0,
      stillHeld: TOTAL - ADVANCE,
      deduction: 0,
      receivedAt: null,
    });
    expect(before.json().settlement.receiptDueAt).toBeGreaterThan(Date.now());
    expect(before.json().claims).toEqual([]);

    const stranger = await post(`/api/contracts/${contractId}/receive`, {}, await otherBuyerToken('+233207497480'));
    expect(stranger.statusCode).toBe(403);
    expect((await getContract(contractId)).state).toBe('DELIVERED');

    const received = await post(`/api/contracts/${contractId}/receive`, {}, token);
    expect(received.statusCode).toBe(200);
    expect(received.json().contract.state).toBe('RECEIVED');
    expect(received.json().settlement).toMatchObject({ paidToFarmer: ADVANCE, onTheWay: TOTAL - ADVANCE, stillHeld: 0 });

    await landAll();
    const after = (await get(`/api/contracts/${contractId}`, token)).json();
    expect(after.contract.state).toBe('SETTLED');
    expect(after.settlement).toMatchObject({ paidToFarmer: TOTAL, onTheWay: 0, stillHeld: 0 });
  });
});

describe('claims over REST', () => {
  it('a claim is checked, shown on the order, refused by the farmer, and decided on the simulator route', async () => {
    const { farmer, contractId } = await deliveredOrder();
    const token = await testBuyerToken();
    const url = `/api/contracts/${contractId}/claims`;

    expect((await post(url, { reason: 'too_expensive', deduction: 1000 }, token)).statusCode).toBe(400);
    expect((await post(url, { reason: 'short_weight', deduction: 1000 }, await otherBuyerToken('+233207497481'))).statusCode).toBe(403);
    const tooMuch = await post(url, { reason: 'short_weight', deduction: TOTAL - ADVANCE + 1 }, token);
    expect(tooMuch.statusCode).toBe(409);
    expect(tooMuch.json().error.code).toBe('DEDUCTION_TOO_LARGE');
    expect((await getContract(contractId)).state).toBe('DELIVERED');

    const filed = await post(url, { reason: 'short_weight', note: 'one bag short', deduction: 40_000 }, token);
    expect(filed.statusCode).toBe(201);
    const claimId = filed.json().claim.id as string;

    const page = (await get(`/api/contracts/${contractId}`, token)).json();
    expect(page.contract.state).toBe('CLAIMED');
    expect(page.claims).toHaveLength(1);
    expect(page.claims[0]).toMatchObject({ id: claimId, reason: 'short_weight', note: 'one bag short', proposedDeduction: 40_000, status: 'awaiting_farmer', reviewStatus: 'pending' });

    // The farmer's side.
    const farmerToken = await testToken('farmer', farmer.id, farmer.phone);
    const mine = (await get('/api/farmer/claims', farmerToken)).json().claims as Array<{ id: string; contractState: string }>;
    expect(mine.find((c) => c.id === claimId)?.contractState).toBe('CLAIMED');

    const neighbour = await registerFarmer({ phone: farmerPhone(), name: 'Neighbour', regionCode: 'NORTHERN' });
    const notHers = await post(`/api/farmer/claims/${claimId}/answer`, { accept: false }, await testToken('farmer', neighbour.id, neighbour.phone));
    expect(notHers.statusCode).toBe(403);

    const refused = await post(`/api/farmer/claims/${claimId}/answer`, { accept: false }, farmerToken);
    expect(refused.statusCode).toBe(200);
    expect(refused.json().claim).toMatchObject({ status: 'awaiting_review', farmerAnswer: 'refused' });
    await landAll();
    expect((await get(`/api/contracts/${contractId}`, token)).json().settlement).toMatchObject({ paidToFarmer: TOTAL - 40_000, stillHeld: 40_000 });

    // F2M's decision, standing in for the Phase 4 reviewer screen.
    const queue = await app.inject({ method: 'GET', url: '/api/dev/claims' });
    expect((queue.json().claims as Array<{ id: string }>).map((c) => c.id)).toContain(claimId);
    const resolved = await post(`/api/dev/claims/${claimId}/resolve`, { deduction: 10_000, note: 'about a quarter bag' });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().claim).toMatchObject({ status: 'resolved', finalDeduction: 10_000, reviewStatus: 'reviewed', reviewedBy: 'simulator' });

    await landAll();
    const done = (await get(`/api/contracts/${contractId}`, token)).json();
    expect(done.contract.state).toBe('SETTLED');
    expect(done.settlement).toMatchObject({ paidToFarmer: TOTAL - 10_000, deduction: 10_000, onTheWay: 0 });
    expect(await contractEscrowBalance(contractId)).toBe(0); // the 10,000 went back to the buyer
  });
});

describe('the farmer answers a claim by phone', () => {
  it('on USSD: My lots → the order → 2 refuses, the undisputed part goes out', async () => {
    const { buyer, farmer, lot, contractId } = await deliveredOrder();
    const claim = await fileClaim({ contractId, buyerId: buyer.id, reason: 'quality', deduction: 30_000 });
    const key = await lotKey(farmer.id, lot.id);

    const [, , detail] = await dial(farmer.phone, ['3', key]);
    expect(detail).toContain('The buyer says the quality is not as agreed. They ask to deduct GHS 300.00.');
    expect(detail).toContain('1. Accept the deduction');
    expect(detail).toContain('2. Refuse (F2M will review)');

    const screens = await dial(farmer.phone, ['3', key, '2']);
    expect(screens.at(-1)).toMatch(/^END You refused\. GHS 1800\.00 is on its way to your MoMo now/);
    expect(await getClaim(claim.id)).toMatchObject({ status: 'awaiting_review', farmerAnswer: 'refused' });

    const [, , later] = await dial(farmer.phone, ['3', key]);
    expect(later).toContain('F2M is reviewing it');
  });

  it('on the claim call: she hears it, presses 4 to hear it again, then 1 to accept, and the order settles', async () => {
    const { buyer, farmer, contractId } = await deliveredOrder();
    const claim = await fileClaim({ contractId, buyerId: buyer.id, reason: 'short_weight', deduction: 20_000 });
    const queued = (await listVoiceCallsForPhone(farmer.phone, 10)).find((c) => c.flow === 'claim' && c.contractId === contractId);
    expect(queued).toBeDefined();

    const call = new Call(farmer.phone);
    await call.answer(queued!.id);
    expect(call.text).toContain('Accra Fresh Markets Ltd reports a problem with your Sorghum: fewer bags or less weight than agreed.');
    expect(call.text).toContain('They ask to deduct GHS 200.00 of the GHS 2100.00 still to come.');
    expect(call.text).toContain('Press 1 to accept the deduction.');
    const heard = call.text;
    await call.press('4');
    expect(call.text).toBe(heard);

    await call.press('1');
    expect(call.ended).toBe(true);
    expect(call.text).toContain('You accepted. GHS 1900.00 is on its way to your mobile money.');
    expect((await getClaim(claim.id)).status).toBe('accepted');
    await landAll();
    expect((await getContract(contractId)).state).toBe('SETTLED');
  });
});

describe('driver milestones', () => {
  it('over REST: at pickup, loaded, set off, arrived — each only by the job’s own driver and in order', async () => {
    const { farmer, contractId, driver, job } = await orderWithDriver();
    const token = await testToken('driver', driver.id, driver.phone);
    const stranger = await registerDriver({ phone: driverPhone(), name: 'Stranger', regionCode: 'NORTHERN', vehicleClassCode: 'van', pin: '1234' });
    const strangerToken = await testToken('driver', stranger.id, stranger.phone);
    const route = (step: string) => `/api/jobs/${job.id}/${step}`;

    expect((await post(route('at-pickup'), {}, strangerToken)).statusCode).toBe(403);
    expect((await post(route('departed'), {}, token)).statusCode).toBe(409); // not loaded yet

    const atPickup = await post(route('at-pickup'), {}, token);
    expect(atPickup.statusCode).toBe(200);
    expect(atPickup.json().job.state).toBe('FUNDS_HELD');
    expect((await listNotificationsForPhone(farmer.phone, 10)).some((n) => n.templateKey === 'sms.driverAtPickup')).toBe(true);

    expect((await post(route('pickup'), {}, token)).json().job.state).toBe('PICKED_UP');
    await grade(contractId);
    expect((await getContract(contractId)).state).toBe('GRADED');

    const departed = await post(route('departed'), {}, token);
    expect(departed.statusCode).toBe(200);
    expect(departed.json().job.state).toBe('PICKED_UP');

    expect((await post(route('arrived'), {}, strangerToken)).statusCode).toBe(403);
    const arrived = await post(route('arrived'), {}, token);
    expect(arrived.statusCode).toBe(200);
    expect(arrived.json().job.state).toBe('ARRIVED');
    expect((await getContract(contractId)).state).toBe('DELIVERED');

    // The buyer's receipt pays the driver and settles the order.
    expect((await post(`/api/contracts/${contractId}/receive`, {}, await testBuyerToken())).statusCode).toBe(200);
    await landAll();
    expect((await getJob(job.id)).state).toBe('PAID');
    expect((await getContract(contractId)).state).toBe('SETTLED');
  });

  it('on USSD: My job → 2 at pickup; after loading, 1 set off and 2 arrived', async () => {
    const { contractId, driver, job } = await orderWithDriver();

    const [, waiting] = await dial(driver.phone, ['2']);
    expect(waiting).toContain('1. Confirm goods loaded');
    expect(waiting).toContain('2. I am at the pickup point');
    expect((await dial(driver.phone, ['2', '2'])).at(-1)).toBe(`END Job ${job.jobCode}: the farmer and buyer know you are at the pickup point.`);

    expect((await dial(driver.phone, ['2', '1'])).at(-1)).toMatch(/pickup confirmed/);
    expect((await getJob(job.id)).state).toBe('PICKED_UP');
    await grade(contractId);

    const [, moving] = await dial(driver.phone, ['2']);
    expect(moving).toContain('1. I have set off');
    expect(moving).toContain('2. I have arrived and handed over');
    expect((await dial(driver.phone, ['2', '1'])).at(-1)).toBe(`END Job ${job.jobCode}: the buyer knows you are on your way.`);
    expect((await dial(driver.phone, ['2', '2'])).at(-1)).toMatch(new RegExp(`^END Job ${job.jobCode}: arrived\\. You are paid when the buyer confirms`));

    expect((await getJob(job.id)).state).toBe('ARRIVED');
    expect((await getContract(contractId)).state).toBe('DELIVERED');
    const [, after] = await dial(driver.phone, ['2']);
    expect(after).toContain('Arrived - waiting for the buyer');
  });
});
