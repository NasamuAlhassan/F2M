import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { config } from '../config';
import { db } from '../db/client';
import {
  buyers,
  contracts,
  deliveryJobOffers,
  deliveryJobs,
  demands,
  drivers,
  farmers,
  lots,
  payments,
  type DeliveryJob,
  type DeliveryJobOffer,
  type Payment,
  type VehicleClass,
} from '../db/schema';
import { t } from '../i18n';
import { getPaymentProvider } from '../providers/payment/index';
import { transitionContract } from '../state/contractMachine';
import { transitionJob } from '../state/deliveryJobMachine';
import { queueBuyerNotification } from './buyerNotifications';
import { driverRouteRegions, getDriverById, getVehicleClass, listVehicleClasses } from './drivers';
import { DomainError, notFound } from './errors';
import { getFarmerById } from './farmers';
import { generateJobCode } from './ids';
import { haversineKm, resolvePoint, type GeoPoint } from './geo';
import { ACCOUNTS, postJournal } from './ledger';
import { queueSms } from './notifications';
import { getCommodityById } from './registries';
import { appendLotEvent } from './trace';
import { formatGhs } from './types';
import { confirmReceipt, markDelivered } from './settlement';

const MAX_JOB_FUNDING_ATTEMPTS = 2;
const BUSY_STATES = ['ASSIGNED', 'FUNDS_HELD', 'PICKED_UP', 'ARRIVED', 'DELIVERED'] as const;
export const LIVE_JOB_STATES = ['REQUESTED', 'NO_DRIVER', 'ASSIGNED', 'FUNDING_FAILED', 'FUNDS_HELD', 'PICKED_UP', 'ARRIVED', 'DELIVERED'] as const;

export interface TransportQuote {
  vehicleClass: VehicleClass;
  distanceKm: number;
  quoteAmount: number; // pesewas = base + round(perKm × km)
  pickup: GeoPoint;
  dropoff: GeoPoint;
}

export async function getJob(id: string): Promise<DeliveryJob> {
  const job = (await db.select().from(deliveryJobs).where(eq(deliveryJobs.id, id)))[0];
  if (!job) throw notFound('delivery job');
  return job;
}

export async function getJobForContract(contractId: string): Promise<DeliveryJob | undefined> {
  return (await db
      .select()
      .from(deliveryJobs)
      .where(eq(deliveryJobs.contractId, contractId))
      .orderBy(desc(deliveryJobs.createdAt)))[0];
}

/**
 * Upfront quote (D-024), rate-card priced. Default = cheapest vehicle class
 * that carries the load; pass a class code to price a specific (fitting) one.
 */
export async function quoteTransport(contractId: string, vehicleClassCode?: string): Promise<TransportQuote> {
  const contract = (await db.select().from(contracts).where(eq(contracts.id, contractId)))[0];
  if (!contract) throw notFound('contract');
  const lot = (await db.select().from(lots).where(eq(lots.id, contract.lotId)))[0]!;
  const demand = (await db.select().from(demands).where(eq(demands.id, contract.demandId)))[0]!;

  const vehicleClass = vehicleClassCode
    ? await getVehicleClass(vehicleClassCode)
    : (await listVehicleClasses()).find((v) => v.capacityKg >= contract.quantityKg);
  if (!vehicleClass) {
    throw new DomainError('No vehicle class carries this load in one trip', 'NO_VEHICLE_CLASS', 409);
  }
  if (vehicleClass.capacityKg < contract.quantityKg) {
    throw new DomainError(`A ${vehicleClass.code} cannot carry ${contract.quantityKg}kg`, 'OVER_CAPACITY', 409);
  }
  const pickup = resolvePoint(lot.gpsLat, lot.gpsLng, lot.regionCode);
  const dropoff = resolvePoint(demand.gpsLat, demand.gpsLng, demand.regionCode);
  const distanceKm = Math.round(haversineKm(pickup, dropoff) * 10) / 10;
  const quoteAmount = vehicleClass.baseFee + Math.round(vehicleClass.perKmRate * distanceKm);
  return { vehicleClass, distanceKm, quoteAmount, pickup, dropoff };
}

/** Instant quotes for EVERY vehicle class that fits the load — the buyer picks. */
export async function quoteTransportOptions(contractId: string): Promise<TransportQuote[]> {
  const contract = (await db.select().from(contracts).where(eq(contracts.id, contractId)))[0];
  if (!contract) throw notFound('contract');
  return await Promise.all((await listVehicleClasses())
      .filter((v) => v.capacityKg >= contract.quantityKg)
      .map((v) => quoteTransport(contractId, v.code)));
}

/**
 * Buyer requests a verified pickup for a funded contract. Quote freezes here.
 * With `preferredDriverId` (D-037 direct hire), the quote prices that driver's
 * vehicle and dispatch offers them first; decline/TTL falls back to the ladder.
 */
export async function requestTransport(
  contractId: string,
  buyerId: string,
  vehicleClassCode?: string,
  preferredDriverId?: string,
): Promise<DeliveryJob> {
  const contract = (await db.select().from(contracts).where(eq(contracts.id, contractId)))[0];
  if (!contract) throw notFound('contract');
  if (contract.buyerId !== buyerId) throw new DomainError('Not your contract', 'FORBIDDEN', 403);
  if (contract.state !== 'FUNDS_HELD') {
    throw new DomainError('Transport is requested after the produce hold is secured', 'INVALID_STATE', 409);
  }
  const existing = await getJobForContract(contractId);
  if (existing && (LIVE_JOB_STATES as readonly string[]).includes(existing.state)) {
    throw new DomainError('A transport job already exists for this contract', 'JOB_EXISTS', 409);
  }

  if (preferredDriverId) {
    const driver = await getDriverById(preferredDriverId);
    if (!driver || !driver.active) throw new DomainError('This driver is not available right now', 'DRIVER_UNAVAILABLE', 409);
    if ((await busyDriverIds()).has(driver.id)) throw new DomainError('This driver is on another job', 'DRIVER_BUSY', 409);
    vehicleClassCode = driver.vehicleClassCode; // hire prices the driver's own vehicle (capacity-guarded below)
  }
  const quote = await quoteTransport(contractId, vehicleClassCode);
  const job = await db.transaction(async (tx) => {
      let jobCode = generateJobCode();
      while ((await tx.select().from(deliveryJobs).where(eq(deliveryJobs.jobCode, jobCode)))[0]) jobCode = generateJobCode();
      const inserted = (await tx
                  .insert(deliveryJobs)
                  .values({
                    jobCode,
                    contractId,
                    lotId: contract.lotId,
                    buyerId: contract.buyerId,
                    farmerId: contract.farmerId,
                    vehicleClassCode: quote.vehicleClass.code,
                    distanceKm: quote.distanceKm,
                    quoteAmount: quote.quoteAmount,
                    pickupLat: quote.pickup.lat,
                    pickupLng: quote.pickup.lng,
                    dropoffLat: quote.dropoff.lat,
                    dropoffLng: quote.dropoff.lng,
                  })
                  .returning())[0]!;
      await appendLotEvent(tx, {
              lotId: contract.lotId,
              type: 'TRANSPORT_REQUESTED',
              actorType: 'buyer',
              actorId: buyerId,
              payload: {
                jobId: inserted.id,
                jobCode,
                vehicleClass: quote.vehicleClass.code,
                distanceKm: quote.distanceKm,
                quoteAmount: quote.quoteAmount,
              },
            });
      return inserted;
    });
  await dispatchJob(job.id, preferredDriverId);
  return getJob(job.id);
}

/** Buyer retries dispatch after NO_DRIVER. */
export async function retryDispatch(jobId: string, buyerId: string): Promise<DeliveryJob> {
  await transitionJob(jobId, 'REQUESTED', { type: 'buyer', id: buyerId });
  await dispatchJob(jobId);
  return getJob(jobId);
}

async function busyDriverIds(): Promise<Set<string>> {
  return new Set(
    (await db
            .select({ driverId: deliveryJobs.driverId })
            .from(deliveryJobs)
            .where(inArray(deliveryJobs.state, [...BUSY_STATES])))
      .map((r) => r.driverId)
      .filter((id): id is string => id !== null),
  );
}

/**
 * Sequential nearest-first dispatch (D-023): ONE live offer at a time with a
 * TTL; declined/expired offers stay blocked (one shot per job+driver) and the
 * next-nearest candidate gets the job. No broadcast — no double-accept races.
 */
export async function dispatchJob(jobId: string, preferredDriverId?: string): Promise<DeliveryJobOffer | null> {
  const job = await getJob(jobId);
  if (job.state !== 'REQUESTED') return null;
  const live = (await db
      .select()
      .from(deliveryJobOffers)
      .where(and(eq(deliveryJobOffers.jobId, jobId), eq(deliveryJobOffers.status, 'offered'))))[0];
  if (live) return live; // one live offer at a time

  const tried = new Set(
    (await db
            .select({ driverId: deliveryJobOffers.driverId })
            .from(deliveryJobOffers)
            .where(eq(deliveryJobOffers.jobId, jobId)))
      .map((r) => r.driverId),
  );
  const busy = await busyDriverIds();
  const pickup: GeoPoint = { lat: job.pickupLat, lng: job.pickupLng };
  const pickupRegion = (await db.select().from(lots).where(eq(lots.id, job.lotId)))[0]?.regionCode;

  const candidates = (await db
      .select()
      .from(drivers)
      .where(and(eq(drivers.vehicleClassCode, job.vehicleClassCode), eq(drivers.active, true))))
    .filter((d) => !tried.has(d.id) && !busy.has(d.id))
    // Regional routes: an empty list serves anywhere; otherwise the pickup
    // region must be on the driver's route.
    .filter((d) => {
      const routes = driverRouteRegions(d);
      return routes.length === 0 || (pickupRegion !== undefined && routes.includes(pickupRegion));
    })
    .map((d) => ({ driver: d, km: haversineKm(resolvePoint(d.gpsLat, d.gpsLng, d.regionCode), pickup) }))
    .sort((a, b) => a.km - b.km);

  // Direct hire (D-037): the chosen driver jumps the ladder for the FIRST
  // offer only — declines and expiries fall back to nearest-first.
  if (preferredDriverId) {
    const idx = candidates.findIndex((c) => c.driver.id === preferredDriverId);
    if (idx > 0) candidates.unshift(candidates.splice(idx, 1)[0]!);
  }

  const next = candidates[0];
  if (!next) {
    await transitionJob(jobId, 'NO_DRIVER', { type: 'system' }, { payload: { reason: 'no_available_driver' } });
    await queueBuyerNotification({
            buyerId: job.buyerId,
            templateKey: 'notif.noDriver',
            params: { jobCode: job.jobCode },
            contractId: job.contractId,
            jobId: job.id,
          });
    return null;
  }

  const now = Date.now();
  const offer = (await db
        .insert(deliveryJobOffers)
        .values({
          jobId,
          driverId: next.driver.id,
          offeredAt: now,
          expiresAt: now + config.DISPATCH_OFFER_TTL_MINUTES * 60 * 1000,
        })
        .returning())[0]!;

  await queueSms({
        phone: next.driver.phone,
        locale: next.driver.locale,
        templateKey: 'sms.jobOffer',
        params: {
          code: job.jobCode,
          kg: await getContractQuantity(job.contractId),
          km: job.distanceKm,
          fee: formatGhs(job.quoteAmount),
          ussd: config.USSD_SHORTCODE,
        },
        lotId: job.lotId,
      });
  return offer;
}

async function getContractQuantity(contractId: string): Promise<number> {
  return (await db.select().from(contracts).where(eq(contracts.id, contractId)))[0]?.quantityKg ?? 0;
}

async function liveOfferFor(jobId: string, driverId: string): Promise<DeliveryJobOffer> {
  const offer = (await db
      .select()
      .from(deliveryJobOffers)
      .where(and(eq(deliveryJobOffers.jobId, jobId), eq(deliveryJobOffers.driverId, driverId))))[0];
  if (!offer || offer.status !== 'offered') {
    throw new DomainError('No live offer for this job', 'NO_LIVE_OFFER', 409);
  }
  return offer;
}

export async function listOffersForDriver(driverId: string): Promise<Array<DeliveryJobOffer & { job: DeliveryJob }>> {
  return (await Promise.all((await db
        .select()
        .from(deliveryJobOffers)
        .where(and(eq(deliveryJobOffers.driverId, driverId), eq(deliveryJobOffers.status, 'offered'))))
      .map(async (o) => ({ ...o, job: await getJob(o.jobId) }))))
    .filter((o) => o.job.state === 'REQUESTED');
}

export async function listJobsForDriver(driverId: string): Promise<DeliveryJob[]> {
  return (await db.select().from(deliveryJobs).where(eq(deliveryJobs.driverId, driverId)).orderBy(desc(deliveryJobs.createdAt)));
}

/**
 * The Dispatch Board's read-only "queued" section: open pickup requests that
 * match this driver's vehicle class and route, but aren't (yet) offered to
 * them — dispatch stays sequential nearest-first (D-023), the board just shows
 * the queue behind it.
 */
export async function listOpenRequestsForDriver(driverId: string): Promise<DeliveryJob[]> {
  const driver = await getDriverById(driverId);
  if (!driver) return [];
  const routes = driverRouteRegions(driver);
  const offeredToMe = new Set(
    (await db
            .select({ jobId: deliveryJobOffers.jobId })
            .from(deliveryJobOffers)
            .where(and(eq(deliveryJobOffers.driverId, driverId), eq(deliveryJobOffers.status, 'offered'))))
      .map((r) => r.jobId),
  );
  const candidates = (await db
      .select()
      .from(deliveryJobs)
      .where(eq(deliveryJobs.state, 'REQUESTED'))
      .orderBy(desc(deliveryJobs.createdAt)))
    .filter((j) => j.vehicleClassCode === driver.vehicleClassCode && !offeredToMe.has(j.id));
  if (routes.length === 0) return candidates.slice(0, 10);
  const lotRegions = new Map(
    (candidates.length ? await db.select({ id: lots.id, regionCode: lots.regionCode }).from(lots).where(inArray(lots.id, candidates.map((j) => j.lotId))) : []).map((l) => [l.id, l.regionCode]),
  );
  return candidates.filter((j) => routes.includes(lotRegions.get(j.lotId) ?? '')).slice(0, 10);
}

export async function acceptJob(jobId: string, driverId: string): Promise<DeliveryJob> {
  const offer = await liveOfferFor(jobId, driverId);
  if (offer.expiresAt < Date.now()) {
    (await db.update(deliveryJobOffers).set({ status: 'expired' }).where(eq(deliveryJobOffers.id, offer.id)));
    await dispatchJob(jobId);
    throw new DomainError('This job offer has expired', 'OFFER_EXPIRED', 409);
  }
  const job = await transitionJob(jobId, 'ASSIGNED', { type: 'driver', id: driverId }, {
      driverId,
      payload: { driverId },
      also: async (tx) => {
        (await tx.update(deliveryJobOffers).set({ status: 'accepted' }).where(eq(deliveryJobOffers.id, offer.id)));
      },
    });

  // The farmer learns who is coming for her produce; the buyer sees the assignment.
  const farmer = await getFarmerById(job.farmerId);
  const driver = await getDriverById(driverId);
  if (driver) {
    await queueBuyerNotification({
            buyerId: job.buyerId,
            templateKey: 'notif.driverAssigned',
            params: { driver: driver.name, vehicle: t('en', `vehicle.${driver.vehicleClassCode}`), jobCode: job.jobCode },
            contractId: job.contractId,
            jobId: job.id,
          });
  }
  if (farmer && driver) {
    await queueSms({
            phone: farmer.phone,
            locale: farmer.locale,
            templateKey: 'sms.jobAssigned',
            params: {
              driver: driver.name,
              phone: driver.phone,
              vehicle: t(farmer.locale, `vehicle.${driver.vehicleClassCode}`),
              code: job.jobCode,
            },
            contractId: job.contractId,
            lotId: job.lotId,
          });
  }

  await initiateJobHold(jobId);
  return getJob(jobId);
}

export async function declineJob(jobId: string, driverId: string): Promise<void> {
  const offer = await liveOfferFor(jobId, driverId);
  (await db.update(deliveryJobOffers).set({ status: 'declined' }).where(eq(deliveryJobOffers.id, offer.id)));
  await dispatchJob(jobId);
}

/** Sweep: expire stale dispatch offers and move to the next-nearest driver. */
export async function expireJobOffers(now = Date.now()): Promise<number> {
  const expired = (await db
      .select()
      .from(deliveryJobOffers)
      .where(and(eq(deliveryJobOffers.status, 'offered'), lt(deliveryJobOffers.expiresAt, now))));
  for (const offer of expired) {
    (await db.update(deliveryJobOffers).set({ status: 'expired' }).where(eq(deliveryJobOffers.id, offer.id)));
    await dispatchJob(offer.jobId);
  }
  return expired.length;
}

/** Collect the transport fee from the requester (buyer) — fires at driver accept (D-024). */
export async function initiateJobHold(jobId: string): Promise<Payment> {
  const job = await getJob(jobId);
  if (job.state !== 'ASSIGNED') {
    throw new DomainError(`Cannot fund a job in ${job.state}`, 'INVALID_STATE', 409);
  }
  const buyer = (await db.select().from(buyers).where(eq(buyers.id, job.buyerId)))[0];
  if (!buyer) throw notFound('buyer');

  const provider = getPaymentProvider();
  const referenceId = crypto.randomUUID();
  const payment = (await db
        .insert(payments)
        .values({
          contractId: job.contractId,
          jobId: job.id,
          direction: 'collection',
          provider: provider.name,
          providerRef: referenceId,
          amount: job.quoteAmount,
          currency: provider.settlementCurrency,
          counterpartyMsisdn: buyer.momoMsisdn,
          status: 'pending',
        })
        .returning())[0]!;

  try {
    const result = await provider.requestHold({
      referenceId,
      msisdn: buyer.momoMsisdn,
      amount: job.quoteAmount,
      currency: provider.settlementCurrency,
      externalId: job.id,
      note: `FTM transport ${job.jobCode}`,
    });
    if (result.status === 'failed') {
      (await db.update(payments)
                .set({ status: 'failed', raw: JSON.stringify(result.raw ?? null), updatedAt: Date.now() })
                .where(eq(payments.id, payment.id)));
      await handleJobFundingFailure(job.id);
    }
  } catch (err) {
    (await db.update(payments)
            .set({ raw: JSON.stringify({ initiateError: String(err) }), updatedAt: Date.now() })
            .where(eq(payments.id, payment.id)));
  }
  return payment;
}

async function handleJobFundingFailure(jobId: string): Promise<void> {
  const job = await getJob(jobId);
  if (job.state !== 'ASSIGNED' && job.state !== 'FUNDING_FAILED') return;
  if (job.state === 'ASSIGNED') await transitionJob(jobId, 'FUNDING_FAILED', { type: 'system' });
  const attempts = job.fundingAttempts + 1;
  (await db.update(deliveryJobs).set({ fundingAttempts: attempts }).where(eq(deliveryJobs.id, jobId)));
  if (attempts < MAX_JOB_FUNDING_ATTEMPTS) {
    await transitionJob(jobId, 'ASSIGNED', { type: 'system' });
    // Awaited: on serverless a function may stop the moment it answers, taking unawaited work with it.
    await initiateJobHold(jobId).catch(() => {});
  } else {
    await transitionJob(jobId, 'CANCELLED', { type: 'system' }, { payload: { reason: 'funding_failed' } });
    await notifyDriverCancelled(jobId);
  }
}

async function notifyDriverCancelled(jobId: string): Promise<void> {
  const job = await getJob(jobId);
  const driver = job.driverId ? await getDriverById(job.driverId) : undefined;
  if (driver) {
    await queueSms({
            phone: driver.phone,
            locale: driver.locale,
            templateKey: 'sms.jobCancelled',
            params: { code: job.jobCode },
            lotId: job.lotId,
          });
  }
}

/**
 * Driver confirms goods are on the vehicle. If the produce contract is still
 * awaiting pickup confirmation, this confirms it too (D-025) — goods on a
 * truck means the pickup happened.
 */
export async function confirmJobPickup(jobId: string, driverId: string): Promise<DeliveryJob> {
  const job = await transitionJob(jobId, 'PICKED_UP', { type: 'driver', id: driverId });
  const contract = (await db.select().from(contracts).where(eq(contracts.id, job.contractId)))[0];
  if (contract?.state === 'FUNDS_HELD') {
    await transitionContract(job.contractId, 'PICKUP_CONFIRMED', { type: 'system' }, { payload: { via: 'driver', jobId } });
  }
  await queueBuyerNotification({
        buyerId: job.buyerId,
        templateKey: 'notif.inTransit',
        params: { jobCode: job.jobCode },
        contractId: job.contractId,
        jobId: job.id,
      });
  // The farmer hears that the produce left with the driver (vision §10.4).
  await notifyFarmerJob(job, 'sms.collected');
  return job;
}

async function notifyFarmerJob(job: DeliveryJob, templateKey: 'sms.collected' | 'sms.driverAtPickup'): Promise<void> {
  const farmer = await getFarmerById(job.farmerId);
  const lot = (await db.select().from(lots).where(eq(lots.id, job.lotId)))[0];
  if (!farmer || !lot) return;
  const driver = job.driverId ? await getDriverById(job.driverId) : undefined;
  await queueSms({
        phone: farmer.phone,
        locale: farmer.locale,
        templateKey,
        params: { commodity: t(farmer.locale, getCommodityById(lot.commodityId).nameKey), driver: driver?.name ?? '', lotCode: lot.lotCode },
        contractId: job.contractId,
        lotId: job.lotId,
      });
}

/** A driver milestone that is not a state change: reached the pickup, or set off (vision §10.4). */
async function milestone(jobId: string, driverId: string, type: 'DRIVER_AT_PICKUP' | 'DRIVER_DEPARTED', states: string[]): Promise<DeliveryJob> {
  const job = await getJob(jobId);
  if (job.driverId !== driverId) throw new DomainError('Not your job', 'FORBIDDEN', 403);
  if (!states.includes(job.state)) throw new DomainError('That step does not fit this job now', 'INVALID_STATE', 409);
  await appendLotEvent(db, { lotId: job.lotId, type, actorType: 'system', payload: { jobId, driverId } }); // the trace's actors are farmer/buyer/system; job steps log as system
  await queueBuyerNotification({
        buyerId: job.buyerId,
        templateKey: type === 'DRIVER_AT_PICKUP' ? 'notif.driverAtPickup' : 'notif.driverDeparted',
        params: { jobCode: job.jobCode },
        contractId: job.contractId,
        jobId: job.id,
      });
  return job;
}

/** The driver is at the farmer's pickup point. */
export async function driverAtPickup(jobId: string, driverId: string): Promise<DeliveryJob> {
  const job = await milestone(jobId, driverId, 'DRIVER_AT_PICKUP', ['FUNDS_HELD']);
  await notifyFarmerJob(job, 'sms.driverAtPickup');
  return job;
}

/** The driver has set off for the buyer. */
export async function driverDeparted(jobId: string, driverId: string): Promise<DeliveryJob> {
  return milestone(jobId, driverId, 'DRIVER_DEPARTED', ['PICKED_UP']);
}

/**
 * The driver is at the destination (Phase 3). The buyer's 24 h receipt clock
 * starts once the produce is graded (it usually already is: grading runs at pickup).
 */
export async function driverArrived(jobId: string, driverId: string): Promise<DeliveryJob> {
  const job = await transitionJob(jobId, 'ARRIVED', { type: 'driver', id: driverId });
  const contract = (await db.select().from(contracts).where(eq(contracts.id, job.contractId)))[0];
  if (contract?.state === 'GRADED') await markDelivered(contract.id, 'driver');
  return job;
}

/**
 * Buyer confirms the goods arrived. Since Phase 3 this is the buyer's receipt
 * of the whole order: the driver is paid and the farmer's balance goes out.
 * If the produce is not graded yet, only the driver is paid now; the order
 * catches up when the grade lands.
 */
export async function confirmJobDelivery(jobId: string, buyerId: string): Promise<DeliveryJob> {
  const job = await getJob(jobId);
  if (job.buyerId !== buyerId) throw new DomainError('Not your job', 'FORBIDDEN', 403);
  const contract = (await db.select().from(contracts).where(eq(contracts.id, job.contractId)))[0];
  if (contract?.state === 'GRADED') await markDelivered(contract.id, 'driver');
  const now = (await db.select().from(contracts).where(eq(contracts.id, job.contractId)))[0];
  if (now?.state === 'DELIVERED') {
    await confirmReceipt(now.id, { type: 'buyer', id: buyerId });
  } else {
    await transitionJob(jobId, 'DELIVERED', { type: 'buyer', id: buyerId });
    await initiateJobRelease(jobId);
  }
  return getJob(jobId);
}

/** Disburse the fee to the driver's MoMo. Idempotent like initiateRelease. */
export async function initiateJobRelease(jobId: string): Promise<Payment> {
  const job = await getJob(jobId);
  if (job.state !== 'DELIVERED') {
    throw new DomainError(`Cannot pay out a job in ${job.state}`, 'INVALID_STATE', 409);
  }
  const existing = (await db
      .select()
      .from(payments)
      .where(and(eq(payments.jobId, jobId), eq(payments.direction, 'disbursement'))))
    .find((p) => p.status !== 'failed');
  if (existing) return existing;

  const driver = job.driverId ? await getDriverById(job.driverId) : undefined;
  if (!driver) throw notFound('driver');

  const provider = getPaymentProvider();
  const referenceId = crypto.randomUUID();
  const payment = (await db
        .insert(payments)
        .values({
          contractId: job.contractId,
          jobId: job.id,
          direction: 'disbursement',
          provider: provider.name,
          providerRef: referenceId,
          amount: job.quoteAmount,
          currency: provider.settlementCurrency,
          counterpartyMsisdn: driver.momoMsisdn,
          status: 'pending',
        })
        .returning())[0]!;

  try {
    const result = await provider.disburse({
      referenceId,
      msisdn: driver.momoMsisdn,
      amount: job.quoteAmount,
      currency: provider.settlementCurrency,
      externalId: job.id,
      note: `FTM transport payout ${job.jobCode}`,
    });
    if (result.status === 'failed') {
      (await db.update(payments)
                .set({ status: 'failed', raw: JSON.stringify(result.raw ?? null), updatedAt: Date.now() })
                .where(eq(payments.id, payment.id)));
    }
  } catch (err) {
    (await db.update(payments)
            .set({ raw: JSON.stringify({ initiateError: String(err) }), updatedAt: Date.now() })
            .where(eq(payments.id, payment.id)));
  }
  return payment;
}

/** Payment-status resolution for job payments — called from pollPaymentsOnce. */
export async function resolveJobPayment(payment: Payment, status: 'successful' | 'failed'): Promise<void> {
  if (!payment.jobId) return;
  const job = await getJob(payment.jobId);

  if (payment.direction === 'collection') {
    if (status === 'successful' && job.state === 'ASSIGNED') {
      await transitionJob(job.id, 'FUNDS_HELD', { type: 'system' }, {
                payload: { paymentId: payment.id, amount: payment.amount },
                also: async (tx) => {
                  await postJournal(
                                tx,
                                job.contractId,
                                [
                                  { account: ACCOUNTS.external, debit: job.quoteAmount, memoKey: 'ledger.transportHold' },
                                  { account: ACCOUNTS.escrowJob(job.id), credit: job.quoteAmount, memoKey: 'ledger.transportHold' },
                                ],
                                job.id,
                              );
                },
              });
    } else if (status === 'failed') {
      await handleJobFundingFailure(job.id);
    }
    return;
  }

  if (status === 'successful' && job.state === 'DELIVERED') {
    await transitionJob(job.id, 'PAID', { type: 'system' }, {
            payload: { paymentId: payment.id, amount: job.quoteAmount },
            also: async (tx) => {
              await postJournal(
                          tx,
                          job.contractId,
                          [
                            { account: ACCOUNTS.escrowJob(job.id), debit: job.quoteAmount, memoKey: 'ledger.transportPayout' },
                            { account: ACCOUNTS.driverPayable(job.driverId!), credit: job.quoteAmount, memoKey: 'ledger.transportPayout' },
                          ],
                          job.id,
                        );
            },
          });
    const driver = job.driverId ? await getDriverById(job.driverId) : undefined;
    if (driver) {
      await queueSms({
                phone: driver.phone,
                locale: driver.locale,
                templateKey: 'sms.jobPaid',
                params: { amount: formatGhs(job.quoteAmount), code: job.jobCode },
                lotId: job.lotId,
              });
      await queueBuyerNotification({
                buyerId: job.buyerId,
                templateKey: 'notif.driverPaid',
                params: { jobCode: job.jobCode, fee: formatGhs(job.quoteAmount), driver: driver.name },
                contractId: job.contractId,
                jobId: job.id,
              });
    }
  }
}

/** Sweep: cancel jobs whose produce contract died; refund the fee if it was held. */
export async function cancelStaleJobs(now = Date.now()): Promise<number> {
  void now;
  const deadContracts = new Set(
    (await db
            .select({ id: contracts.id })
            .from(contracts)
            .where(inArray(contracts.state, ['CANCELLED', 'CANCELLED_REFUNDED'])))
      .map((r) => r.id),
  );
  const liveJobs = (await db
      .select()
      .from(deliveryJobs)
      .where(inArray(deliveryJobs.state, ['REQUESTED', 'NO_DRIVER', 'ASSIGNED', 'FUNDING_FAILED', 'FUNDS_HELD'])))
    .filter((j) => deadContracts.has(j.contractId));

  for (const job of liveJobs) {
    if (job.state === 'FUNDS_HELD') {
      await transitionJob(job.id, 'CANCELLED_REFUNDED', { type: 'system' }, {
                payload: { reason: 'contract_dead' },
                also: async (tx) => {
                  await postJournal(
                                tx,
                                job.contractId,
                                [
                                  { account: ACCOUNTS.escrowJob(job.id), debit: job.quoteAmount, memoKey: 'ledger.transportRefund' },
                                  { account: ACCOUNTS.buyerRefunds(job.buyerId), credit: job.quoteAmount, memoKey: 'ledger.transportRefund' },
                                ],
                                job.id,
                              );
                },
              });
    } else if (job.state === 'REQUESTED' || job.state === 'NO_DRIVER' || job.state === 'ASSIGNED') {
      await transitionJob(job.id, 'CANCELLED', { type: 'system' }, { payload: { reason: 'contract_dead' } });
    } else {
      continue; // FUNDING_FAILED resolves through its own retry/cancel path
    }
    await notifyDriverCancelled(job.id);
  }
  return liveJobs.length;
}

/** Contracts whose produce is already on a truck must not be refunded as missed pickups. */
export async function contractsWithGoodsInTransit(): Promise<Set<string>> {
  return new Set(
    (await db
            .select({ contractId: deliveryJobs.contractId })
            .from(deliveryJobs)
            .where(inArray(deliveryJobs.state, ['PICKED_UP', 'ARRIVED', 'DELIVERED', 'PAID'])))
      .map((r) => r.contractId),
  );
}

export async function jobSummary(job: DeliveryJob): Promise<{
  commodityCode: string;
  quantityKg: number;
}> {
  const contract = (await db.select().from(contracts).where(eq(contracts.id, job.contractId)))[0]!;
  return { commodityCode: getCommodityById(contract.commodityId).code, quantityKg: contract.quantityKg };
}

/**
 * The side-hustle directory (D-037): every ONLINE driver with vehicle, routes,
 * and whether they're currently on a job — buyers and sellers browse this to
 * call or hire directly.
 */
export async function listAvailableDrivers(): Promise<Array<{
  id: string;
  name: string;
  phone: string;
  regionCode: string;
  vehicleClassCode: string;
  routeRegions: string[];
  busy: boolean;
}>> {
  const busy = await busyDriverIds();
  return (await db
      .select()
      .from(drivers)
      .where(eq(drivers.active, true)))
    .map((d) => ({
      id: d.id,
      name: d.name,
      phone: d.phone,
      regionCode: d.regionCode,
      vehicleClassCode: d.vehicleClassCode,
      routeRegions: driverRouteRegions(d),
      busy: busy.has(d.id),
    }))
    .sort((a, b) => Number(a.busy) - Number(b.busy) || a.name.localeCompare(b.name));
}

/**
 * Seller-arranged delivery (D-037): the FARMER asks for a driver; nothing moves
 * until the buyer approves and funds it. A trace event + a buyer alert with the
 * cheapest quote — no schema, no money.
 */
export async function suggestTransport(contractId: string, farmerId: string): Promise<void> {
  const contract = (await db.select().from(contracts).where(eq(contracts.id, contractId)))[0];
  if (!contract) throw notFound('contract');
  if (contract.farmerId !== farmerId) throw new DomainError('Not your contract', 'FORBIDDEN', 403);
  if (contract.state !== 'FUNDS_HELD') {
    throw new DomainError('Delivery can be arranged once the buyer hold is secured', 'INVALID_STATE', 409);
  }
  const existing = await getJobForContract(contractId);
  if (existing && (LIVE_JOB_STATES as readonly string[]).includes(existing.state)) {
    throw new DomainError('A transport job already exists for this contract', 'JOB_EXISTS', 409);
  }

  const farmer = await getFarmerById(farmerId);
  const lot = (await db.select().from(lots).where(eq(lots.id, contract.lotId)))[0]!;
  const cheapest = (await quoteTransportOptions(contractId))[0];
  await db.transaction(async (tx) => {
        await appendLotEvent(tx, {
                lotId: contract.lotId,
                type: 'TRANSPORT_SUGGESTED',
                actorType: 'farmer',
                actorId: farmerId,
                payload: cheapest
                  ? { vehicleClass: cheapest.vehicleClass.code, distanceKm: cheapest.distanceKm, quoteAmount: cheapest.quoteAmount }
                  : {},
              });
      });
  await queueBuyerNotification({
        buyerId: contract.buyerId,
        templateKey: 'notif.transportSuggested',
        params: {
          farmer: farmer?.name ?? 'The farmer',
          lotCode: lot.lotCode,
          fee: cheapest ? formatGhs(cheapest.quoteAmount) : '—',
        },
        contractId,
        lotId: contract.lotId,
      });
}
