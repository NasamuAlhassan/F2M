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
import { getDriverById, getVehicleClass, listVehicleClasses } from './drivers';
import { DomainError, notFound } from './errors';
import { getFarmerById } from './farmers';
import { generateJobCode } from './ids';
import { haversineKm, resolvePoint, type GeoPoint } from './geo';
import { ACCOUNTS, postJournal } from './ledger';
import { queueSms } from './notifications';
import { getCommodityById } from './registries';
import { appendLotEvent } from './trace';
import { formatGhs } from './types';

const MAX_JOB_FUNDING_ATTEMPTS = 2;
const BUSY_STATES = ['ASSIGNED', 'FUNDS_HELD', 'PICKED_UP', 'DELIVERED'] as const;
export const LIVE_JOB_STATES = ['REQUESTED', 'NO_DRIVER', 'ASSIGNED', 'FUNDING_FAILED', 'FUNDS_HELD', 'PICKED_UP', 'DELIVERED'] as const;

export interface TransportQuote {
  vehicleClass: VehicleClass;
  distanceKm: number;
  quoteAmount: number; // pesewas = base + round(perKm × km)
  pickup: GeoPoint;
  dropoff: GeoPoint;
}

export function getJob(id: string): DeliveryJob {
  const job = db.select().from(deliveryJobs).where(eq(deliveryJobs.id, id)).get();
  if (!job) throw notFound('delivery job');
  return job;
}

export function getJobForContract(contractId: string): DeliveryJob | undefined {
  return db
    .select()
    .from(deliveryJobs)
    .where(eq(deliveryJobs.contractId, contractId))
    .orderBy(desc(deliveryJobs.createdAt))
    .get();
}

/** Upfront quote (D-024): cheapest vehicle class that carries the load, rate-card priced. */
export function quoteTransport(contractId: string): TransportQuote {
  const contract = db.select().from(contracts).where(eq(contracts.id, contractId)).get();
  if (!contract) throw notFound('contract');
  const lot = db.select().from(lots).where(eq(lots.id, contract.lotId)).get()!;
  const demand = db.select().from(demands).where(eq(demands.id, contract.demandId)).get()!;

  const vehicleClass = listVehicleClasses().find((v) => v.capacityKg >= contract.quantityKg);
  if (!vehicleClass) {
    throw new DomainError('No vehicle class carries this load in one trip', 'NO_VEHICLE_CLASS', 409);
  }
  const pickup = resolvePoint(lot.gpsLat, lot.gpsLng, lot.regionCode);
  const dropoff = resolvePoint(demand.gpsLat, demand.gpsLng, demand.regionCode);
  const distanceKm = Math.round(haversineKm(pickup, dropoff) * 10) / 10;
  const quoteAmount = vehicleClass.baseFee + Math.round(vehicleClass.perKmRate * distanceKm);
  return { vehicleClass, distanceKm, quoteAmount, pickup, dropoff };
}

/** Buyer requests a verified pickup for a funded contract. Quote freezes here. */
export function requestTransport(contractId: string, buyerId: string): DeliveryJob {
  const contract = db.select().from(contracts).where(eq(contracts.id, contractId)).get();
  if (!contract) throw notFound('contract');
  if (contract.buyerId !== buyerId) throw new DomainError('Not your contract', 'FORBIDDEN', 403);
  if (contract.state !== 'FUNDS_HELD') {
    throw new DomainError('Transport is requested after the produce hold is secured', 'INVALID_STATE', 409);
  }
  const existing = getJobForContract(contractId);
  if (existing && (LIVE_JOB_STATES as readonly string[]).includes(existing.state)) {
    throw new DomainError('A transport job already exists for this contract', 'JOB_EXISTS', 409);
  }

  const quote = quoteTransport(contractId);
  const job = db.transaction((tx) => {
    let jobCode = generateJobCode();
    while (tx.select().from(deliveryJobs).where(eq(deliveryJobs.jobCode, jobCode)).get()) jobCode = generateJobCode();
    const inserted = tx
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
      .returning()
      .get();
    appendLotEvent(tx, {
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
  dispatchJob(job.id);
  return getJob(job.id);
}

/** Buyer retries dispatch after NO_DRIVER. */
export function retryDispatch(jobId: string, buyerId: string): DeliveryJob {
  transitionJob(jobId, 'REQUESTED', { type: 'buyer', id: buyerId });
  dispatchJob(jobId);
  return getJob(jobId);
}

function busyDriverIds(): Set<string> {
  return new Set(
    db
      .select({ driverId: deliveryJobs.driverId })
      .from(deliveryJobs)
      .where(inArray(deliveryJobs.state, [...BUSY_STATES]))
      .all()
      .map((r) => r.driverId)
      .filter((id): id is string => id !== null),
  );
}

/**
 * Sequential nearest-first dispatch (D-023): ONE live offer at a time with a
 * TTL; declined/expired offers stay blocked (one shot per job+driver) and the
 * next-nearest candidate gets the job. No broadcast — no double-accept races.
 */
export function dispatchJob(jobId: string): DeliveryJobOffer | null {
  const job = getJob(jobId);
  if (job.state !== 'REQUESTED') return null;
  const live = db
    .select()
    .from(deliveryJobOffers)
    .where(and(eq(deliveryJobOffers.jobId, jobId), eq(deliveryJobOffers.status, 'offered')))
    .get();
  if (live) return live; // one live offer at a time

  const tried = new Set(
    db
      .select({ driverId: deliveryJobOffers.driverId })
      .from(deliveryJobOffers)
      .where(eq(deliveryJobOffers.jobId, jobId))
      .all()
      .map((r) => r.driverId),
  );
  const busy = busyDriverIds();
  const pickup: GeoPoint = { lat: job.pickupLat, lng: job.pickupLng };

  const candidates = db
    .select()
    .from(drivers)
    .where(and(eq(drivers.vehicleClassCode, job.vehicleClassCode), eq(drivers.active, true)))
    .all()
    .filter((d) => !tried.has(d.id) && !busy.has(d.id))
    .map((d) => ({ driver: d, km: haversineKm(resolvePoint(d.gpsLat, d.gpsLng, d.regionCode), pickup) }))
    .sort((a, b) => a.km - b.km);

  const next = candidates[0];
  if (!next) {
    transitionJob(jobId, 'NO_DRIVER', { type: 'system' }, { payload: { reason: 'no_available_driver' } });
    return null;
  }

  const now = Date.now();
  const offer = db
    .insert(deliveryJobOffers)
    .values({
      jobId,
      driverId: next.driver.id,
      offeredAt: now,
      expiresAt: now + config.DISPATCH_OFFER_TTL_MINUTES * 60 * 1000,
    })
    .returning()
    .get();

  queueSms({
    phone: next.driver.phone,
    locale: next.driver.locale,
    templateKey: 'sms.jobOffer',
    params: {
      code: job.jobCode,
      kg: getContractQuantity(job.contractId),
      km: job.distanceKm,
      fee: formatGhs(job.quoteAmount),
      ussd: config.USSD_SHORTCODE,
    },
    lotId: job.lotId,
  });
  return offer;
}

function getContractQuantity(contractId: string): number {
  return db.select().from(contracts).where(eq(contracts.id, contractId)).get()?.quantityKg ?? 0;
}

function liveOfferFor(jobId: string, driverId: string): DeliveryJobOffer {
  const offer = db
    .select()
    .from(deliveryJobOffers)
    .where(and(eq(deliveryJobOffers.jobId, jobId), eq(deliveryJobOffers.driverId, driverId)))
    .get();
  if (!offer || offer.status !== 'offered') {
    throw new DomainError('No live offer for this job', 'NO_LIVE_OFFER', 409);
  }
  return offer;
}

export function listOffersForDriver(driverId: string): Array<DeliveryJobOffer & { job: DeliveryJob }> {
  return db
    .select()
    .from(deliveryJobOffers)
    .where(and(eq(deliveryJobOffers.driverId, driverId), eq(deliveryJobOffers.status, 'offered')))
    .all()
    .map((o) => ({ ...o, job: getJob(o.jobId) }))
    .filter((o) => o.job.state === 'REQUESTED');
}

export function listJobsForDriver(driverId: string): DeliveryJob[] {
  return db.select().from(deliveryJobs).where(eq(deliveryJobs.driverId, driverId)).orderBy(desc(deliveryJobs.createdAt)).all();
}

export async function acceptJob(jobId: string, driverId: string): Promise<DeliveryJob> {
  const offer = liveOfferFor(jobId, driverId);
  if (offer.expiresAt < Date.now()) {
    db.update(deliveryJobOffers).set({ status: 'expired' }).where(eq(deliveryJobOffers.id, offer.id)).run();
    dispatchJob(jobId);
    throw new DomainError('This job offer has expired', 'OFFER_EXPIRED', 409);
  }
  const job = transitionJob(jobId, 'ASSIGNED', { type: 'driver', id: driverId }, {
    driverId,
    payload: { driverId },
    also: (tx) => {
      tx.update(deliveryJobOffers).set({ status: 'accepted' }).where(eq(deliveryJobOffers.id, offer.id)).run();
    },
  });

  // The farmer learns who is coming for her produce.
  const farmer = getFarmerById(job.farmerId);
  const driver = getDriverById(driverId);
  if (farmer && driver) {
    queueSms({
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

export function declineJob(jobId: string, driverId: string): void {
  const offer = liveOfferFor(jobId, driverId);
  db.update(deliveryJobOffers).set({ status: 'declined' }).where(eq(deliveryJobOffers.id, offer.id)).run();
  dispatchJob(jobId);
}

/** Sweep: expire stale dispatch offers and move to the next-nearest driver. */
export function expireJobOffers(now = Date.now()): number {
  const expired = db
    .select()
    .from(deliveryJobOffers)
    .where(and(eq(deliveryJobOffers.status, 'offered'), lt(deliveryJobOffers.expiresAt, now)))
    .all();
  for (const offer of expired) {
    db.update(deliveryJobOffers).set({ status: 'expired' }).where(eq(deliveryJobOffers.id, offer.id)).run();
    dispatchJob(offer.jobId);
  }
  return expired.length;
}

/** Collect the transport fee from the requester (buyer) — fires at driver accept (D-024). */
export async function initiateJobHold(jobId: string): Promise<Payment> {
  const job = getJob(jobId);
  if (job.state !== 'ASSIGNED') {
    throw new DomainError(`Cannot fund a job in ${job.state}`, 'INVALID_STATE', 409);
  }
  const buyer = db.select().from(buyers).where(eq(buyers.id, job.buyerId)).get();
  if (!buyer) throw notFound('buyer');

  const provider = getPaymentProvider();
  const referenceId = crypto.randomUUID();
  const payment = db
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
    .returning()
    .get();

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
      db.update(payments)
        .set({ status: 'failed', raw: JSON.stringify(result.raw ?? null), updatedAt: Date.now() })
        .where(eq(payments.id, payment.id))
        .run();
      handleJobFundingFailure(job.id);
    }
  } catch (err) {
    db.update(payments)
      .set({ raw: JSON.stringify({ initiateError: String(err) }), updatedAt: Date.now() })
      .where(eq(payments.id, payment.id))
      .run();
  }
  return payment;
}

function handleJobFundingFailure(jobId: string): void {
  const job = getJob(jobId);
  if (job.state !== 'ASSIGNED' && job.state !== 'FUNDING_FAILED') return;
  if (job.state === 'ASSIGNED') transitionJob(jobId, 'FUNDING_FAILED', { type: 'system' });
  const attempts = job.fundingAttempts + 1;
  db.update(deliveryJobs).set({ fundingAttempts: attempts }).where(eq(deliveryJobs.id, jobId)).run();
  if (attempts < MAX_JOB_FUNDING_ATTEMPTS) {
    transitionJob(jobId, 'ASSIGNED', { type: 'system' });
    void initiateJobHold(jobId).catch(() => {});
  } else {
    transitionJob(jobId, 'CANCELLED', { type: 'system' }, { payload: { reason: 'funding_failed' } });
    notifyDriverCancelled(jobId);
  }
}

function notifyDriverCancelled(jobId: string): void {
  const job = getJob(jobId);
  const driver = job.driverId ? getDriverById(job.driverId) : undefined;
  if (driver) {
    queueSms({
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
export function confirmJobPickup(jobId: string, driverId: string): DeliveryJob {
  const job = transitionJob(jobId, 'PICKED_UP', { type: 'driver', id: driverId });
  const contract = db.select().from(contracts).where(eq(contracts.id, job.contractId)).get();
  if (contract?.state === 'FUNDS_HELD') {
    transitionContract(job.contractId, 'PICKUP_CONFIRMED', { type: 'system' }, { payload: { via: 'driver', jobId } });
  }
  return job;
}

/** Buyer confirms the goods arrived — releases the fee to the driver. */
export async function confirmJobDelivery(jobId: string, buyerId: string): Promise<DeliveryJob> {
  transitionJob(jobId, 'DELIVERED', { type: 'buyer', id: buyerId });
  await initiateJobRelease(jobId);
  return getJob(jobId);
}

/** Disburse the fee to the driver's MoMo. Idempotent like initiateRelease. */
export async function initiateJobRelease(jobId: string): Promise<Payment> {
  const job = getJob(jobId);
  if (job.state !== 'DELIVERED') {
    throw new DomainError(`Cannot pay out a job in ${job.state}`, 'INVALID_STATE', 409);
  }
  const existing = db
    .select()
    .from(payments)
    .where(and(eq(payments.jobId, jobId), eq(payments.direction, 'disbursement')))
    .all()
    .find((p) => p.status !== 'failed');
  if (existing) return existing;

  const driver = job.driverId ? getDriverById(job.driverId) : undefined;
  if (!driver) throw notFound('driver');

  const provider = getPaymentProvider();
  const referenceId = crypto.randomUUID();
  const payment = db
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
    .returning()
    .get();

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
      db.update(payments)
        .set({ status: 'failed', raw: JSON.stringify(result.raw ?? null), updatedAt: Date.now() })
        .where(eq(payments.id, payment.id))
        .run();
    }
  } catch (err) {
    db.update(payments)
      .set({ raw: JSON.stringify({ initiateError: String(err) }), updatedAt: Date.now() })
      .where(eq(payments.id, payment.id))
      .run();
  }
  return payment;
}

/** Payment-status resolution for job payments — called from pollPaymentsOnce. */
export function resolveJobPayment(payment: Payment, status: 'successful' | 'failed'): void {
  if (!payment.jobId) return;
  const job = getJob(payment.jobId);

  if (payment.direction === 'collection') {
    if (status === 'successful' && job.state === 'ASSIGNED') {
      transitionJob(job.id, 'FUNDS_HELD', { type: 'system' }, {
        payload: { paymentId: payment.id, amount: payment.amount },
        also: (tx) => {
          postJournal(
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
      handleJobFundingFailure(job.id);
    }
    return;
  }

  if (status === 'successful' && job.state === 'DELIVERED') {
    transitionJob(job.id, 'PAID', { type: 'system' }, {
      payload: { paymentId: payment.id, amount: job.quoteAmount },
      also: (tx) => {
        postJournal(
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
    const driver = job.driverId ? getDriverById(job.driverId) : undefined;
    if (driver) {
      queueSms({
        phone: driver.phone,
        locale: driver.locale,
        templateKey: 'sms.jobPaid',
        params: { amount: formatGhs(job.quoteAmount), code: job.jobCode },
        lotId: job.lotId,
      });
    }
  }
}

/** Sweep: cancel jobs whose produce contract died; refund the fee if it was held. */
export function cancelStaleJobs(now = Date.now()): number {
  void now;
  const deadContracts = new Set(
    db
      .select({ id: contracts.id })
      .from(contracts)
      .where(inArray(contracts.state, ['CANCELLED', 'CANCELLED_REFUNDED']))
      .all()
      .map((r) => r.id),
  );
  const liveJobs = db
    .select()
    .from(deliveryJobs)
    .where(inArray(deliveryJobs.state, ['REQUESTED', 'NO_DRIVER', 'ASSIGNED', 'FUNDING_FAILED', 'FUNDS_HELD']))
    .all()
    .filter((j) => deadContracts.has(j.contractId));

  for (const job of liveJobs) {
    if (job.state === 'FUNDS_HELD') {
      transitionJob(job.id, 'CANCELLED_REFUNDED', { type: 'system' }, {
        payload: { reason: 'contract_dead' },
        also: (tx) => {
          postJournal(
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
      transitionJob(job.id, 'CANCELLED', { type: 'system' }, { payload: { reason: 'contract_dead' } });
    } else {
      continue; // FUNDING_FAILED resolves through its own retry/cancel path
    }
    notifyDriverCancelled(job.id);
  }
  return liveJobs.length;
}

/** Contracts whose produce is already on a truck must not be refunded as missed pickups. */
export function contractsWithGoodsInTransit(): Set<string> {
  return new Set(
    db
      .select({ contractId: deliveryJobs.contractId })
      .from(deliveryJobs)
      .where(inArray(deliveryJobs.state, ['PICKED_UP', 'DELIVERED', 'PAID']))
      .all()
      .map((r) => r.contractId),
  );
}

export function jobSummary(job: DeliveryJob): {
  commodityCode: string;
  quantityKg: number;
} {
  const contract = db.select().from(contracts).where(eq(contracts.id, job.contractId)).get()!;
  return { commodityCode: getCommodityById(contract.commodityId).code, quantityKg: contract.quantityKg };
}
