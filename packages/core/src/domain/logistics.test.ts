import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../db/client';
import { buyerNotifications, deliveryJobOffers, demands, drivers as driversTable, lots } from '../db/schema';
import { MockPaymentProvider, setPaymentProvider } from '../providers/payment/index';
import { acceptFor, testBuyer } from '../testing/fixtures';
import { getContract } from './contracts';
import { createDemand } from './demands';
import { driverRouteRegions, getDriverById, getDriverByPhone, registerDriver, updateDriverProfile } from './drivers';
import { registerFarmer } from './farmers';
import { accountBalance, ACCOUNTS, allJournalsBalanced, jobEscrowBalance } from './ledger';
import {
  acceptJob,
  cancelStaleJobs,
  confirmJobDelivery,
  confirmJobPickup,
  declineJob,
  dispatchJob,
  expireJobOffers,
  getJob,
  getJobForContract,
  listAvailableDrivers,
  listOpenRequestsForDriver,
  quoteTransport,
  quoteTransportOptions,
  requestTransport,
  retryDispatch,
  suggestTransport,
} from './logistics';
import { registerLot } from './lots';
import { pollPaymentsOnce, refundHold, refundMissedPickups } from './paymentFlow';
import { getCommodityByCode } from './registries';
import { getTrace } from './trace';

const DAY = 24 * 60 * 60 * 1000;

beforeAll(() => {
  setPaymentProvider(new MockPaymentProvider(0));
});
afterAll(() => {
  setPaymentProvider(null);
});

let phoneCounter = 100;
function nextPhone(prefix: string): string {
  phoneCounter += 1;
  return `${prefix}${String(phoneCounter).padStart(6, '0')}9`;
}

/** Park all drivers so each test controls exactly who is available. */
async function parkAllDrivers(): Promise<void> {
  (await db.update(driversTable).set({ active: false }));
}

/** Yam-lane isolated FUNDS_HELD contract (500kg → van class). */
async function fundedContract(regionCode = 'GREATER_ACCRA') {
  const yam = getCommodityByCode('YAM');
  (await db.update(demands)
        .set({ status: 'cancelled' })
        .where(and(eq(demands.commodityId, yam.id), inArray(demands.status, ['open', 'partially_matched']))));
  (await db.update(lots)
        .set({ status: 'withdrawn' })
        .where(and(eq(lots.commodityId, yam.id), eq(lots.status, 'registered'))));

  const buyer = await testBuyer();
  const farmer = await registerFarmer({ phone: nextPhone('024'), name: 'Logistics Farmer', regionCode });
  const lot = await registerLot({ farmerId: farmer.id, commodityCode: 'YAM', unitCode: 'HUNDRED', unitQty: 2, declaredBand: 'B' });
  await createDemand({
        buyerId: buyer.id,
        commodityCode: 'YAM',
        quantityKg: 500,
        minBand: 'B',
        basePricePerKg: 400,
        windowStart: Date.now(),
        windowEnd: Date.now() + 7 * DAY,
        regionCode: 'GREATER_ACCRA',
      });
  // The farmer accepts the engine's bid: the 500kg order is created and the hold starts (Phase 1).
  const order = await acceptFor(farmer.id, lot.id);
  expect(order.quantityKg).toBe(500);
  await pollPaymentsOnce();
  expect((await getContract(order.id)).state).toBe('FUNDS_HELD');
  return { buyer, farmer, lot, contractId: order.id };
}

function vanDriver(regionCode: string, name = 'Test Driver') {
  return registerDriver({
    phone: nextPhone('054'),
    name,
    regionCode,
    vehicleClassCode: 'van',
    pin: '1234',
  });
}

describe('logistics (M13)', () => {
  it('quotes from the rate card: cheapest class that carries the load', async () => {
    await parkAllDrivers();
    const { contractId } = await fundedContract();
    const quote = await quoteTransport(contractId);
    expect(quote.vehicleClass.code).toBe('van'); // 500kg exceeds the 400kg tricycle
    expect(quote.quoteAmount).toBe(quote.vehicleClass.baseFee + Math.round(quote.vehicleClass.perKmRate * quote.distanceKm));
  });

  it('dispatches nearest-first, walks the ladder on decline/expiry, then NO_DRIVER + retry', async () => {
    await parkAllDrivers();
    const { contractId, buyer } = await fundedContract('ASHANTI'); // pickup ≈ Ashanti centroid
    const near = await vanDriver('ASHANTI', 'Near Driver');
    const far = await vanDriver('NORTHERN', 'Far Driver');

    const job = await requestTransport(contractId, buyer.id);
    expect(job.state).toBe('REQUESTED');
    expect((await getTrace(job.lotId)).map((e) => e.type)).toContain('TRANSPORT_REQUESTED');

    // Nearest (Ashanti) holds the one live offer.
    let offers = (await db.select().from(deliveryJobOffers).where(eq(deliveryJobOffers.jobId, job.id)));
    expect(offers).toHaveLength(1);
    expect(offers[0]!.driverId).toBe(near.id);

    // Decline → the far driver is next.
    await declineJob(job.id, near.id);
    offers = (await db.select().from(deliveryJobOffers).where(eq(deliveryJobOffers.jobId, job.id)));
    expect(offers).toHaveLength(2);
    expect(offers.find((o) => o.status === 'offered')!.driverId).toBe(far.id);

    // Expire the far driver's offer → nobody left → NO_DRIVER.
    expect(await expireJobOffers(Date.now() + 11 * 60 * 1000)).toBe(1);
    expect((await getJob(job.id)).state).toBe('NO_DRIVER');

    // Buyer retries once a new driver appears — but both are blocked (one shot), so a fresh driver gets it.
    const fresh = await vanDriver('ASHANTI', 'Fresh Driver');
    await retryDispatch(job.id, buyer.id);
    const liveOffer = (await db
          .select()
          .from(deliveryJobOffers)
          .where(and(eq(deliveryJobOffers.jobId, job.id), eq(deliveryJobOffers.status, 'offered'))))[0];
    expect(liveOffer!.driverId).toBe(fresh.id);
  });

  it('runs a job end to end: accept → fee held → pickup (auto-confirms contract) → delivered → PAID', async () => {
    await parkAllDrivers();
    const { contractId, buyer, lot } = await fundedContract('BONO');
    const driver = await vanDriver('BONO');
    const job = await requestTransport(contractId, buyer.id);

    await acceptJob(job.id, driver.id);
    expect((await getJob(job.id)).state).toBe('ASSIGNED');
    expect((await getJob(job.id)).driverId).toBe(driver.id);

    await pollPaymentsOnce();
    expect((await getJob(job.id)).state).toBe('FUNDS_HELD');
    expect(await jobEscrowBalance(job.id)).toBe(job.quoteAmount);

    // Driver confirms goods on the vehicle — the produce contract's pickup confirms too (D-025).
    await confirmJobPickup(job.id, driver.id);
    expect((await getJob(job.id)).state).toBe('PICKED_UP');
    expect((await getContract(contractId)).state).toBe('PICKUP_CONFIRMED');

    await confirmJobDelivery(job.id, buyer.id);
    expect((await getJob(job.id)).state).toBe('DELIVERED');
    await pollPaymentsOnce();

    const done = await getJob(job.id);
    expect(done.state).toBe('PAID');
    expect(await jobEscrowBalance(job.id)).toBe(0);
    expect(await accountBalance(ACCOUNTS.driverPayable(driver.id))).toBe(job.quoteAmount);
    expect(await allJournalsBalanced()).toBe(true);

    const types = (await getTrace(lot.id)).map((e) => e.type);
    for (const expected of ['TRANSPORT_REQUESTED', 'DRIVER_ASSIGNED', 'TRANSPORT_FUNDED', 'IN_TRANSIT', 'TRANSPORT_DELIVERED', 'DRIVER_PAID']) {
      expect(types).toContain(expected);
    }
  });

  it('guards actors: wrong driver cannot pick up, wrong buyer cannot confirm delivery', async () => {
    await parkAllDrivers();
    const { contractId, buyer } = await fundedContract('VOLTA');
    const driver = await vanDriver('VOLTA');
    const stranger = await vanDriver('AHAFO', 'Stranger');
    const job = await requestTransport(contractId, buyer.id);
    await acceptJob(job.id, driver.id);
    await pollPaymentsOnce();

    await expect((() => confirmJobPickup(job.id, stranger.id))()).rejects.toThrow(/Not your job/);
    await expect(confirmJobDelivery(job.id, 'not-the-buyer')).rejects.toThrow();
  });

  it('cancels and refunds a funded job when the produce contract dies', async () => {
    await parkAllDrivers();
    const { contractId, buyer } = await fundedContract('CENTRAL');
    const driver = await vanDriver('CENTRAL');
    const job = await requestTransport(contractId, buyer.id);
    await acceptJob(job.id, driver.id);
    await pollPaymentsOnce();
    expect((await getJob(job.id)).state).toBe('FUNDS_HELD');

    await refundHold(contractId, { reason: 'test' }); // produce contract → CANCELLED_REFUNDED
    expect(await cancelStaleJobs()).toBe(1);

    expect((await getJob(job.id)).state).toBe('CANCELLED_REFUNDED');
    expect(await jobEscrowBalance(job.id)).toBe(0);
    expect(await allJournalsBalanced()).toBe(true);
  });

  it('never treats goods-on-a-truck as a missed pickup', async () => {
    await parkAllDrivers();
    const { contractId, buyer } = await fundedContract('EASTERN');
    const driver = await vanDriver('EASTERN');
    const job = await requestTransport(contractId, buyer.id);
    await acceptJob(job.id, driver.id);
    await pollPaymentsOnce();
    await confirmJobPickup(job.id, driver.id);

    // The far-future sweep may legitimately refund OTHER stale contracts from
    // earlier tests — the claim here is that THIS in-transit one survives.
    await refundMissedPickups(Date.now() + 30 * DAY);
    expect((await getContract(contractId)).state).toBe('PICKUP_CONFIRMED');
    expect((await getJob(job.id)).state).toBe('PICKED_UP');
  });

  it('registers drivers (PIN optional — web signups have none) and blocks role collisions', async () => {
    const phone = nextPhone('055');
    await registerDriver({ phone, name: 'Pin Driver', regionCode: 'BONO', vehicleClassCode: 'tricycle', pin: '4321' });
    expect((await getDriverByPhone(phone))!.pinHash).toBeTruthy();
    const webPhone = nextPhone('055');
    expect((await registerDriver({ phone: webPhone, name: 'Web Driver', regionCode: 'BONO', vehicleClassCode: 'tricycle' })).pinHash).toBeNull();
    await expect((() => registerDriver({ phone: nextPhone('055'), name: 'X', regionCode: 'BONO', vehicleClassCode: 'van', pin: '12' }))()).rejects.toThrow(/4 digits/);

    const farmerPhone = nextPhone('026');
    await registerFarmer({ phone: farmerPhone, name: 'Role Farmer', regionCode: 'BONO' });
    await expect((() =>
            registerDriver({ phone: farmerPhone, name: 'X', regionCode: 'BONO', vehicleClassCode: 'van', pin: '1111' }))()).rejects.toThrow(/already registered as a farmer/);
  });

  it('quotes every fitting vehicle class and honors an explicit choice (M18)', async () => {
    await parkAllDrivers();
    const { contractId, buyer } = await fundedContract('BONO_EAST');

    // 500kg fits the 1.5T and 5T trucks but not the 400kg tricycle.
    const options = await quoteTransportOptions(contractId);
    expect(options.map((o) => o.vehicleClass.code)).toEqual(['van', 'light_truck']);
    expect(options[1]!.quoteAmount).toBeGreaterThan(options[0]!.quoteAmount);

    await expect((() => quoteTransport(contractId, 'tricycle'))()).rejects.toThrow(/cannot carry/);

    // The buyer picks the bigger truck explicitly — the job freezes that class.
    const job = await requestTransport(contractId, buyer.id, 'light_truck');
    expect(job.vehicleClassCode).toBe('light_truck');
    expect(job.quoteAmount).toBe(options[1]!.quoteAmount);
  });

  it('driver profile: availability toggle, vehicle change, and route-filtered dispatch (M18)', async () => {
    await parkAllDrivers();
    const { contractId, buyer } = await fundedContract('ASHANTI'); // pickup region ASHANTI

    // A van driver whose routes exclude Ashanti must not be dispatched...
    const northOnly = await vanDriver('NORTHERN', 'North Routes');
    await updateDriverProfile(northOnly.id, { routeRegions: ['NORTHERN', 'SAVANNAH'] });
    expect(driverRouteRegions((await getDriverById(northOnly.id))!)).toEqual(['NORTHERN', 'SAVANNAH']);

    // ...an OFFLINE driver must not be dispatched either...
    const offline = await vanDriver('ASHANTI', 'Offline Driver');
    await updateDriverProfile(offline.id, { active: false });

    // ...but an online driver serving Ashanti (or anywhere) gets the offer.
    const onRoute = await vanDriver('NORTHERN', 'Ashanti Route');
    await updateDriverProfile(onRoute.id, { routeRegions: ['ASHANTI'] });

    const job = await requestTransport(contractId, buyer.id);
    const live = (await db
          .select()
          .from(deliveryJobOffers)
          .where(and(eq(deliveryJobOffers.jobId, job.id), eq(deliveryJobOffers.status, 'offered'))))[0];
    expect(live!.driverId).toBe(onRoute.id);

    // The dispatch board's queue: the job is offered to onRoute, so it appears
    // as an open request only for eligible drivers WITHOUT the live offer.
    expect((await listOpenRequestsForDriver(onRoute.id)).map((j) => j.id)).not.toContain(job.id);
    expect((await listOpenRequestsForDriver(northOnly.id)).map((j) => j.id)).not.toContain(job.id); // off-route
    const anywhere = await vanDriver('VOLTA', 'Anywhere Driver');
    expect((await listOpenRequestsForDriver(anywhere.id)).map((j) => j.id)).toContain(job.id);

    await expect((() => updateDriverProfile(onRoute.id, { routeRegions: ['NOT_A_REGION'] }))()).rejects.toThrow();
  });

  it('collects the fee at accept, not at request (D-024)', async () => {
    await parkAllDrivers();
    const { contractId, buyer } = await fundedContract('WESTERN');
    const job = await requestTransport(contractId, buyer.id);
    // No driver accepted yet → no fee payment exists.
    expect((await getJobForContract(contractId))!.state).toBe('NO_DRIVER'); // no active drivers
    expect(await jobEscrowBalance(job.id)).toBe(0);
  });
});

describe('driver directory & direct hire (M28, D-037)', () => {
  it('a hired driver jumps the ladder for the first offer, then dispatch falls back to nearest-first', async () => {
    await parkAllDrivers();
    const { contractId, buyer } = await fundedContract('ASHANTI');
    const near = await vanDriver('ASHANTI', 'Nearest Driver');
    const hired = await vanDriver('NORTHERN', 'Hired Driver'); // farther away — would never win nearest-first

    const job = await requestTransport(contractId, buyer.id, undefined, hired.id);
    const first = (await db
          .select()
          .from(deliveryJobOffers)
          .where(and(eq(deliveryJobOffers.jobId, job.id), eq(deliveryJobOffers.status, 'offered'))))[0];
    expect(first!.driverId).toBe(hired.id);
    expect(job.vehicleClassCode).toBe('van'); // priced on the hired driver's vehicle

    await declineJob(job.id, hired.id);
    const fallback = (await db
          .select()
          .from(deliveryJobOffers)
          .where(and(eq(deliveryJobOffers.jobId, job.id), eq(deliveryJobOffers.status, 'offered'))))[0];
    expect(fallback!.driverId).toBe(near.id); // ladder resumes without the preference
  });

  it('refuses to hire an offline or busy driver', async () => {
    await parkAllDrivers();
    const { contractId, buyer } = await fundedContract('ASHANTI');
    const offline = await vanDriver('ASHANTI', 'Offline Driver');
    await updateDriverProfile(offline.id, { active: false });
    await expect((() => requestTransport(contractId, buyer.id, undefined, offline.id))()).rejects.toThrow(/not available/);
  });

  it('the directory lists online drivers with live busy flags', async () => {
    await parkAllDrivers();
    const { contractId, buyer } = await fundedContract('ASHANTI');
    const working = await vanDriver('ASHANTI', 'Working Driver');
    const idle = await vanDriver('ASHANTI', 'Idle Driver');
    const parked = await vanDriver('ASHANTI', 'Parked Driver');
    await updateDriverProfile(parked.id, { active: false });

    const job = await requestTransport(contractId, buyer.id, undefined, working.id);
    await acceptJob(job.id, working.id); // ASSIGNED → busy

    const list = await listAvailableDrivers();
    expect(list.find((d) => d.id === working.id)!.busy).toBe(true);
    expect(list.find((d) => d.id === idle.id)!.busy).toBe(false);
    expect(list.find((d) => d.id === parked.id)).toBeUndefined(); // offline drivers are not in the directory
  });

  it('a farmer suggestion appends the trace event and alerts the buyer — no job, no money', async () => {
    await parkAllDrivers();
    const { contractId, farmer, lot, buyer } = await fundedContract();
    await suggestTransport(contractId, farmer.id);

    expect((await getTrace(lot.id)).map((e) => e.type)).toContain('TRANSPORT_SUGGESTED');
    expect(await getJobForContract(contractId)).toBeUndefined(); // nothing dispatched, nothing escrowed

    const notif = (await db
          .select()
          .from(buyerNotifications)
          .where(eq(buyerNotifications.contractId, contractId)))
      .find((n) => n.templateKey === 'notif.transportSuggested');
    expect(notif).toBeDefined();
    expect(notif!.buyerId).toBe(buyer.id);
    expect(notif!.message).toContain('Logistics Farmer');
    expect(notif!.message).toContain(lot.lotCode);

    await expect((() => suggestTransport(contractId, 'not-the-farmer'))()).rejects.toThrow(/Not your contract/);
  });
});
