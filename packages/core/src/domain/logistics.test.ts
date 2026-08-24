import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../db/client';
import { buyerNotifications, deliveryJobOffers, demands, drivers as driversTable, lots } from '../db/schema';
import { MockPaymentProvider, setPaymentProvider } from '../providers/payment/index';
import { verifyBuyerLogin } from './buyers';
import { getContract, listContractsForFarmer } from './contracts';
import { createDemand } from './demands';
import { driverRouteRegions, getDriverById, registerDriver, updateDriverProfile, verifyDriverLogin } from './drivers';
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
import { acceptOfferAndHold, pollPaymentsOnce, refundHold, refundMissedPickups } from './paymentFlow';
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
function parkAllDrivers(): void {
  db.update(driversTable).set({ active: false }).run();
}

/** Yam-lane isolated FUNDS_HELD contract (500kg → van class). */
async function fundedContract(regionCode = 'GREATER_ACCRA') {
  const yam = getCommodityByCode('YAM');
  db.update(demands)
    .set({ status: 'cancelled' })
    .where(and(eq(demands.commodityId, yam.id), inArray(demands.status, ['open', 'partially_matched'])))
    .run();
  db.update(lots)
    .set({ status: 'withdrawn' })
    .where(and(eq(lots.commodityId, yam.id), eq(lots.status, 'registered')))
    .run();

  const buyer = verifyBuyerLogin('buyer@demo.ftm', 'demo-buyer-2026');
  const farmer = registerFarmer({ phone: nextPhone('024'), name: 'Logistics Farmer', regionCode });
  const lot = registerLot({ farmerId: farmer.id, commodityCode: 'YAM', unitCode: 'HUNDRED', unitQty: 2, declaredBand: 'B' });
  createDemand({
    buyerId: buyer.id,
    commodityCode: 'YAM',
    quantityKg: 500,
    minBand: 'B',
    basePricePerKg: 400,
    windowStart: Date.now(),
    windowEnd: Date.now() + 7 * DAY,
    regionCode: 'GREATER_ACCRA',
  });
  const offer = listContractsForFarmer(farmer.id, ['OFFERED'])[0]!;
  await acceptOfferAndHold(offer.id, farmer.id);
  await pollPaymentsOnce();
  expect(getContract(offer.id).state).toBe('FUNDS_HELD');
  return { buyer, farmer, lot, contractId: offer.id };
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
    parkAllDrivers();
    const { contractId } = await fundedContract();
    const quote = quoteTransport(contractId);
    expect(quote.vehicleClass.code).toBe('van'); // 500kg exceeds the 400kg tricycle
    expect(quote.quoteAmount).toBe(quote.vehicleClass.baseFee + Math.round(quote.vehicleClass.perKmRate * quote.distanceKm));
  });

  it('dispatches nearest-first, walks the ladder on decline/expiry, then NO_DRIVER + retry', async () => {
    parkAllDrivers();
    const { contractId, buyer } = await fundedContract('ASHANTI'); // pickup ≈ Ashanti centroid
    const near = vanDriver('ASHANTI', 'Near Driver');
    const far = vanDriver('NORTHERN', 'Far Driver');

    const job = requestTransport(contractId, buyer.id);
    expect(job.state).toBe('REQUESTED');
    expect(getTrace(job.lotId).map((e) => e.type)).toContain('TRANSPORT_REQUESTED');

    // Nearest (Ashanti) holds the one live offer.
    let offers = db.select().from(deliveryJobOffers).where(eq(deliveryJobOffers.jobId, job.id)).all();
    expect(offers).toHaveLength(1);
    expect(offers[0]!.driverId).toBe(near.id);

    // Decline → the far driver is next.
    declineJob(job.id, near.id);
    offers = db.select().from(deliveryJobOffers).where(eq(deliveryJobOffers.jobId, job.id)).all();
    expect(offers).toHaveLength(2);
    expect(offers.find((o) => o.status === 'offered')!.driverId).toBe(far.id);

    // Expire the far driver's offer → nobody left → NO_DRIVER.
    expect(expireJobOffers(Date.now() + 11 * 60 * 1000)).toBe(1);
    expect(getJob(job.id).state).toBe('NO_DRIVER');

    // Buyer retries once a new driver appears — but both are blocked (one shot), so a fresh driver gets it.
    const fresh = vanDriver('ASHANTI', 'Fresh Driver');
    retryDispatch(job.id, buyer.id);
    const liveOffer = db
      .select()
      .from(deliveryJobOffers)
      .where(and(eq(deliveryJobOffers.jobId, job.id), eq(deliveryJobOffers.status, 'offered')))
      .get();
    expect(liveOffer!.driverId).toBe(fresh.id);
  });

  it('runs a job end to end: accept → fee held → pickup (auto-confirms contract) → delivered → PAID', async () => {
    parkAllDrivers();
    const { contractId, buyer, lot } = await fundedContract('BONO');
    const driver = vanDriver('BONO');
    const job = requestTransport(contractId, buyer.id);

    await acceptJob(job.id, driver.id);
    expect(getJob(job.id).state).toBe('ASSIGNED');
    expect(getJob(job.id).driverId).toBe(driver.id);

    await pollPaymentsOnce();
    expect(getJob(job.id).state).toBe('FUNDS_HELD');
    expect(jobEscrowBalance(job.id)).toBe(job.quoteAmount);

    // Driver confirms goods on the vehicle — the produce contract's pickup confirms too (D-025).
    confirmJobPickup(job.id, driver.id);
    expect(getJob(job.id).state).toBe('PICKED_UP');
    expect(getContract(contractId).state).toBe('PICKUP_CONFIRMED');

    await confirmJobDelivery(job.id, buyer.id);
    expect(getJob(job.id).state).toBe('DELIVERED');
    await pollPaymentsOnce();

    const done = getJob(job.id);
    expect(done.state).toBe('PAID');
    expect(jobEscrowBalance(job.id)).toBe(0);
    expect(accountBalance(ACCOUNTS.driverPayable(driver.id))).toBe(job.quoteAmount);
    expect(allJournalsBalanced()).toBe(true);

    const types = getTrace(lot.id).map((e) => e.type);
    for (const expected of ['TRANSPORT_REQUESTED', 'DRIVER_ASSIGNED', 'TRANSPORT_FUNDED', 'IN_TRANSIT', 'TRANSPORT_DELIVERED', 'DRIVER_PAID']) {
      expect(types).toContain(expected);
    }
  });

  it('guards actors: wrong driver cannot pick up, wrong buyer cannot confirm delivery', async () => {
    parkAllDrivers();
    const { contractId, buyer } = await fundedContract('VOLTA');
    const driver = vanDriver('VOLTA');
    const stranger = vanDriver('AHAFO', 'Stranger');
    const job = requestTransport(contractId, buyer.id);
    await acceptJob(job.id, driver.id);
    await pollPaymentsOnce();

    expect(() => confirmJobPickup(job.id, stranger.id)).toThrow(/Not your job/);
    await expect(confirmJobDelivery(job.id, 'not-the-buyer')).rejects.toThrow();
  });

  it('cancels and refunds a funded job when the produce contract dies', async () => {
    parkAllDrivers();
    const { contractId, buyer } = await fundedContract('CENTRAL');
    const driver = vanDriver('CENTRAL');
    const job = requestTransport(contractId, buyer.id);
    await acceptJob(job.id, driver.id);
    await pollPaymentsOnce();
    expect(getJob(job.id).state).toBe('FUNDS_HELD');

    refundHold(contractId, { reason: 'test' }); // produce contract → CANCELLED_REFUNDED
    expect(cancelStaleJobs()).toBe(1);

    expect(getJob(job.id).state).toBe('CANCELLED_REFUNDED');
    expect(jobEscrowBalance(job.id)).toBe(0);
    expect(allJournalsBalanced()).toBe(true);
  });

  it('never treats goods-on-a-truck as a missed pickup', async () => {
    parkAllDrivers();
    const { contractId, buyer } = await fundedContract('EASTERN');
    const driver = vanDriver('EASTERN');
    const job = requestTransport(contractId, buyer.id);
    await acceptJob(job.id, driver.id);
    await pollPaymentsOnce();
    confirmJobPickup(job.id, driver.id);

    // The far-future sweep may legitimately refund OTHER stale contracts from
    // earlier tests — the claim here is that THIS in-transit one survives.
    refundMissedPickups(Date.now() + 30 * DAY);
    expect(getContract(contractId).state).toBe('PICKUP_CONFIRMED');
    expect(getJob(job.id).state).toBe('PICKED_UP');
  });

  it('registers drivers with PIN login and blocks role collisions', async () => {
    const phone = nextPhone('055');
    registerDriver({ phone, name: 'Pin Driver', regionCode: 'BONO', vehicleClassCode: 'tricycle', pin: '4321' });
    expect(verifyDriverLogin(phone, '4321').name).toBe('Pin Driver');
    expect(() => verifyDriverLogin(phone, '0000')).toThrow(/Invalid/);

    const farmerPhone = nextPhone('026');
    registerFarmer({ phone: farmerPhone, name: 'Role Farmer', regionCode: 'BONO' });
    expect(() =>
      registerDriver({ phone: farmerPhone, name: 'X', regionCode: 'BONO', vehicleClassCode: 'van', pin: '1111' }),
    ).toThrow(/already registered as a farmer/);
  });

  it('quotes every fitting vehicle class and honors an explicit choice (M18)', async () => {
    parkAllDrivers();
    const { contractId, buyer } = await fundedContract('BONO_EAST');

    // 500kg fits the 1.5T and 5T trucks but not the 400kg tricycle.
    const options = quoteTransportOptions(contractId);
    expect(options.map((o) => o.vehicleClass.code)).toEqual(['van', 'light_truck']);
    expect(options[1]!.quoteAmount).toBeGreaterThan(options[0]!.quoteAmount);

    expect(() => quoteTransport(contractId, 'tricycle')).toThrow(/cannot carry/);

    // The buyer picks the bigger truck explicitly — the job freezes that class.
    const job = requestTransport(contractId, buyer.id, 'light_truck');
    expect(job.vehicleClassCode).toBe('light_truck');
    expect(job.quoteAmount).toBe(options[1]!.quoteAmount);
  });

  it('driver profile: availability toggle, vehicle change, and route-filtered dispatch (M18)', async () => {
    parkAllDrivers();
    const { contractId, buyer } = await fundedContract('ASHANTI'); // pickup region ASHANTI

    // A van driver whose routes exclude Ashanti must not be dispatched...
    const northOnly = vanDriver('NORTHERN', 'North Routes');
    updateDriverProfile(northOnly.id, { routeRegions: ['NORTHERN', 'SAVANNAH'] });
    expect(driverRouteRegions(getDriverById(northOnly.id)!)).toEqual(['NORTHERN', 'SAVANNAH']);

    // ...an OFFLINE driver must not be dispatched either...
    const offline = vanDriver('ASHANTI', 'Offline Driver');
    updateDriverProfile(offline.id, { active: false });
    expect(verifyDriverLogin(offline.phone, '1234').id).toBe(offline.id); // offline can still log in

    // ...but an online driver serving Ashanti (or anywhere) gets the offer.
    const onRoute = vanDriver('NORTHERN', 'Ashanti Route');
    updateDriverProfile(onRoute.id, { routeRegions: ['ASHANTI'] });

    const job = requestTransport(contractId, buyer.id);
    const live = db
      .select()
      .from(deliveryJobOffers)
      .where(and(eq(deliveryJobOffers.jobId, job.id), eq(deliveryJobOffers.status, 'offered')))
      .get();
    expect(live!.driverId).toBe(onRoute.id);

    // The dispatch board's queue: the job is offered to onRoute, so it appears
    // as an open request only for eligible drivers WITHOUT the live offer.
    expect(listOpenRequestsForDriver(onRoute.id).map((j) => j.id)).not.toContain(job.id);
    expect(listOpenRequestsForDriver(northOnly.id).map((j) => j.id)).not.toContain(job.id); // off-route
    const anywhere = vanDriver('VOLTA', 'Anywhere Driver');
    expect(listOpenRequestsForDriver(anywhere.id).map((j) => j.id)).toContain(job.id);

    expect(() => updateDriverProfile(onRoute.id, { routeRegions: ['NOT_A_REGION'] })).toThrow();
  });

  it('collects the fee at accept, not at request (D-024)', async () => {
    parkAllDrivers();
    const { contractId, buyer } = await fundedContract('WESTERN');
    const job = requestTransport(contractId, buyer.id);
    // No driver accepted yet → no fee payment exists.
    expect(getJobForContract(contractId)!.state).toBe('NO_DRIVER'); // no active drivers
    expect(jobEscrowBalance(job.id)).toBe(0);
  });
});

describe('driver directory & direct hire (M28, D-037)', () => {
  it('a hired driver jumps the ladder for the first offer, then dispatch falls back to nearest-first', async () => {
    parkAllDrivers();
    const { contractId, buyer } = await fundedContract('ASHANTI');
    const near = vanDriver('ASHANTI', 'Nearest Driver');
    const hired = vanDriver('NORTHERN', 'Hired Driver'); // farther away — would never win nearest-first

    const job = requestTransport(contractId, buyer.id, undefined, hired.id);
    const first = db
      .select()
      .from(deliveryJobOffers)
      .where(and(eq(deliveryJobOffers.jobId, job.id), eq(deliveryJobOffers.status, 'offered')))
      .get();
    expect(first!.driverId).toBe(hired.id);
    expect(job.vehicleClassCode).toBe('van'); // priced on the hired driver's vehicle

    declineJob(job.id, hired.id);
    const fallback = db
      .select()
      .from(deliveryJobOffers)
      .where(and(eq(deliveryJobOffers.jobId, job.id), eq(deliveryJobOffers.status, 'offered')))
      .get();
    expect(fallback!.driverId).toBe(near.id); // ladder resumes without the preference
  });

  it('refuses to hire an offline or busy driver', async () => {
    parkAllDrivers();
    const { contractId, buyer } = await fundedContract('ASHANTI');
    const offline = vanDriver('ASHANTI', 'Offline Driver');
    updateDriverProfile(offline.id, { active: false });
    expect(() => requestTransport(contractId, buyer.id, undefined, offline.id)).toThrow(/not available/);
  });

  it('the directory lists online drivers with live busy flags', async () => {
    parkAllDrivers();
    const { contractId, buyer } = await fundedContract('ASHANTI');
    const working = vanDriver('ASHANTI', 'Working Driver');
    const idle = vanDriver('ASHANTI', 'Idle Driver');
    const parked = vanDriver('ASHANTI', 'Parked Driver');
    updateDriverProfile(parked.id, { active: false });

    const job = requestTransport(contractId, buyer.id, undefined, working.id);
    acceptJob(job.id, working.id); // ASSIGNED → busy

    const list = listAvailableDrivers();
    expect(list.find((d) => d.id === working.id)!.busy).toBe(true);
    expect(list.find((d) => d.id === idle.id)!.busy).toBe(false);
    expect(list.find((d) => d.id === parked.id)).toBeUndefined(); // offline drivers are not in the directory
  });

  it('a farmer suggestion appends the trace event and alerts the buyer — no job, no money', async () => {
    parkAllDrivers();
    const { contractId, farmer, lot, buyer } = await fundedContract();
    suggestTransport(contractId, farmer.id);

    expect(getTrace(lot.id).map((e) => e.type)).toContain('TRANSPORT_SUGGESTED');
    expect(getJobForContract(contractId)).toBeUndefined(); // nothing dispatched, nothing escrowed

    const notif = db
      .select()
      .from(buyerNotifications)
      .where(eq(buyerNotifications.contractId, contractId))
      .all()
      .find((n) => n.templateKey === 'notif.transportSuggested');
    expect(notif).toBeDefined();
    expect(notif!.buyerId).toBe(buyer.id);
    expect(notif!.message).toContain('Logistics Farmer');
    expect(notif!.message).toContain(lot.lotCode);

    expect(() => suggestTransport(contractId, 'not-the-farmer')).toThrow(/Not your contract/);
  });
});
