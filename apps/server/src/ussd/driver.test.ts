import {
  createDemand,
  getContract,
  getDriverByPhone,
  getJob,
  getJobForContract,
  listContractsForFarmer,
  MockPaymentProvider,
  pollPaymentsOnce,
  registerFarmer,
  registerLot,
  requestTransport,
  schema,
  setDraftLocalesLive,
  setPaymentProvider,
  verifyBuyerLogin,
  db,
  acceptOfferAndHold,
} from '@ftm/core';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../app';
import { handleUssdRequest } from './index';

const DRIVER_PHONE = '+233541237700';
const DAY = 24 * 60 * 60 * 1000;

let app: FastifyInstance;

beforeAll(async () => {
  setPaymentProvider(new MockPaymentProvider(0));
  app = await buildServer({ logger: false });
});
afterAll(async () => {
  setPaymentProvider(null);
  await app.close();
});

async function dial(phone: string, inputs: string[]): Promise<string[]> {
  const sessionId = `drv-${Math.random().toString(36).slice(2)}`;
  const responses: string[] = [];
  responses.push(await handleUssdRequest({ sessionId, phoneNumber: phone, text: '' }));
  const history: string[] = [];
  for (const input of inputs) {
    history.push(input);
    responses.push(await handleUssdRequest({ sessionId, phoneNumber: phone, text: history.join('*') }));
    if (responses[responses.length - 1]!.startsWith('END')) break;
  }
  return responses;
}

async function fundedContract() {
  const yamRow = db.select().from(schema.commodities).all().find((c) => c.code === 'YAM')!;
  db.update(schema.demands)
    .set({ status: 'cancelled' })
    .where(and(eq(schema.demands.commodityId, yamRow.id), inArray(schema.demands.status, ['open', 'partially_matched'])))
    .run();
  db.update(schema.lots)
    .set({ status: 'withdrawn' })
    .where(and(eq(schema.lots.commodityId, yamRow.id), eq(schema.lots.status, 'registered')))
    .run();
  db.update(schema.drivers).set({ active: false }).where(eq(schema.drivers.active, true)).run();

  const buyer = verifyBuyerLogin('buyer@demo.ftm', 'demo-buyer-2026');
  const farmer = registerFarmer({ phone: '+233209871100', name: 'Driver Test Farmer', regionCode: 'ASHANTI' });
  registerLot({ farmerId: farmer.id, commodityCode: 'YAM', unitCode: 'HUNDRED', unitQty: 2, declaredBand: 'B' });
  createDemand({
    buyerId: buyer.id,
    commodityCode: 'YAM',
    quantityKg: 500,
    minBand: 'B',
    basePricePerKg: 400,
    windowStart: Date.now(),
    windowEnd: Date.now() + 7 * DAY,
    regionCode: 'ASHANTI',
  });
  const offer = listContractsForFarmer(farmer.id, ['OFFERED'])[0]!;
  await acceptOfferAndHold(offer.id, farmer.id);
  await pollPaymentsOnce();
  return { buyer, contractId: offer.id };
}

describe('driver surfaces (M14)', () => {
  it('registers a driver over USSD: name, region, vehicle, PIN', async () => {
    const responses = await dial(DRIVER_PHONE, ['2', 'Kwesi Transport', '2', '2', '1234', '1']);
    expect(responses[0]).toContain('2. Register as a driver');
    expect(responses[2]).toContain('Select your home region');
    expect(responses[3]).toContain('What do you drive?');
    expect(responses[3]).toContain('2. 1.5T Truck');
    expect(responses[4]).toContain('4-digit PIN');
    expect(responses[5]).toContain('Register Kwesi Transport, 1.5T Truck, Ashanti?');
    expect(responses[6]).toMatch(/^END Welcome, Kwesi Transport/);

    const driver = getDriverByPhone(DRIVER_PHONE);
    expect(driver?.vehicleClassCode).toBe('van');
  });

  it('accepts a dispatched job and confirms pickup — all over USSD', async () => {
    const { buyer, contractId } = await fundedContract();
    // Our USSD driver was parked by the fixture — reactivate just them.
    const driver = getDriverByPhone(DRIVER_PHONE)!;
    db.update(schema.drivers).set({ active: true }).where(eq(schema.drivers.id, driver.id)).run();

    const job = requestTransport(contractId, buyer.id);

    const [home, list, detail, accepted] = await dial(DRIVER_PHONE, ['1', '1', '1']);
    expect(home).toContain('1. Job offers (1)');
    expect(list).toContain(job.jobCode);
    expect(detail).toContain(`Job ${job.jobCode}: 500kg Yam`);
    expect(detail).toContain('Pays GHS');
    expect(accepted).toMatch(/^END Job DLV-/);
    expect(getJob(job.id).state).toBe('ASSIGNED');

    await pollPaymentsOnce();
    expect(getJob(job.id).state).toBe('FUNDS_HELD');

    const [, active, done] = await dial(DRIVER_PHONE, ['2', '1']);
    expect(active).toContain('Fee secured - go to pickup');
    expect(active).toContain('1. Confirm goods loaded');
    expect(done).toMatch(/pickup confirmed/);

    expect(getJob(job.id).state).toBe('PICKED_UP');
    expect(getContract(contractId).state).toBe('PICKUP_CONFIRMED'); // D-025 via the wire
  });

  it('drives the same actions through the web API with role-checked JWTs', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/driver-login',
      payload: JSON.stringify({ phone: DRIVER_PHONE, pin: '1234' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(login.statusCode).toBe(200);
    const driverToken = login.json().token as string;

    const jobs = await app.inject({
      method: 'GET',
      url: '/api/driver/jobs',
      headers: { authorization: `Bearer ${driverToken}` },
    });
    expect(jobs.statusCode).toBe(200);
    expect(jobs.json().jobs.some((j: { state: string }) => j.state === 'PICKED_UP')).toBe(true);

    // The latent-bug fix: a driver token must NOT pass buyer guards, and vice versa.
    const crossed = await app.inject({
      method: 'GET',
      url: '/api/demands',
      headers: { authorization: `Bearer ${driverToken}` },
    });
    expect(crossed.statusCode).toBe(401);

    const buyerLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: JSON.stringify({ email: 'buyer@demo.ftm', password: 'demo-buyer-2026' }),
      headers: { 'content-type': 'application/json' },
    });
    const buyerToken = buyerLogin.json().token as string;
    const crossedBuyer = await app.inject({
      method: 'GET',
      url: '/api/driver/jobs',
      headers: { authorization: `Bearer ${buyerToken}` },
    });
    expect(crossedBuyer.statusCode).toBe(401);

    // Buyer confirms delivery via the web API → payout → PAID.
    const driver = getDriverByPhone(DRIVER_PHONE)!;
    const job = db
      .select()
      .from(schema.deliveryJobs)
      .where(and(eq(schema.deliveryJobs.driverId, driver.id), eq(schema.deliveryJobs.state, 'PICKED_UP')))
      .get()!;
    const deliver = await app.inject({
      method: 'POST',
      url: `/api/jobs/${job.id}/deliver`,
      headers: { authorization: `Bearer ${buyerToken}` },
    });
    expect(deliver.statusCode).toBe(200);
    await pollPaymentsOnce();
    expect(getJob(job.id).state).toBe('PAID');
    expect(getJobForContract(job.contractId)!.state).toBe('PAID');
  });
});

describe('driver language menu (M30, D-040)', () => {
  it('key 4 fills the dead slot and persists drivers.locale', async () => {
    setDraftLocalesLive(true);
    try {
      const [home, menu, done] = await dial(DRIVER_PHONE, ['4', '2']);
      expect(home).toContain('4. Language');
      expect(menu).toContain('Language for SMS and calls:');
      expect(done).toMatch(/^END/);
      expect(getDriverByPhone(DRIVER_PHONE)!.locale).toBe('tw');
      await dial(DRIVER_PHONE, ['4', '1']); // back to English
      expect(getDriverByPhone(DRIVER_PHONE)!.locale).toBe('en');
    } finally {
      setDraftLocalesLive(null);
    }
  });
});
