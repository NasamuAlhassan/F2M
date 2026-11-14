import { and, eq, inArray, or } from 'drizzle-orm';
import { config } from '../config';
import { db } from '../db/client';
import {
  buyers,
  contracts,
  deliveryJobs,
  drivers,
  farmers,
  lots,
  notifications,
  offerEvents,
  offers,
  orderClaims,
  payments,
  photos,
  units,
  voiceCalls,
  type Contract,
  type DeliveryJob,
  type OrderClaim,
} from '../db/schema';
import { t } from '../i18n';
import { getJobForContract } from './logistics';
import { notFound } from './errors';
import { getCommodityById, getRegion } from './registries';
import { advanceFor, farmerPaid, orderTotal, stillHeld } from './settlement';
import { getTrace } from './trace';

/**
 * One page per sale — "the deal" — for its buyer, farmer and driver alike
 * (the owner's request, with the UI session): where the sale stands, whose
 * move it is next, the money in one place, and every step on one timeline,
 * including what F2M sent the farmer by SMS and call. The same next step is
 * meant for the web, USSD and voice, so it is worked out here, once.
 */

export type DealRole = 'buyer' | 'farmer' | 'driver';
export type DealChannel = 'web' | 'ussd' | 'voice' | 'sms' | null;

export interface NextStep {
  /** Whose move it is. 'f2m' is F2M's reviewer; 'system' is F2M's machinery (payments, grading). */
  actor: DealRole | 'f2m' | 'system';
  action:
    | 'answer_offer'
    | 'secure_payment'
    | 'arrange_pickup'
    | 'finding_driver'
    | 'retry_transport'
    | 'securing_transport'
    | 'go_to_pickup'
    | 'grade'
    | 'review_grade'
    | 'regrade'
    | 'deliver'
    | 'confirm_receipt'
    | 'answer_claim'
    | 'review_claim'
    | 'paying_balance';
  dueAt: number | null;
  ref?: string;
}

export interface TimelineItem {
  id: string;
  at: number;
  kind: string;
  actor: DealRole | 'f2m' | 'system';
  channel: DealChannel;
  data: Record<string, unknown>;
}

/** Which party of this deal a login is, or null (the deal is then not theirs to see). */
export function dealRoleOf(contract: Contract, login: { kind: string; sub: string }): DealRole | null {
  if (login.kind === 'buyer' && contract.buyerId === login.sub) return 'buyer';
  if (login.kind === 'farmer' && contract.farmerId === login.sub) return 'farmer';
  if (login.kind === 'driver') {
    const job = getJobForContract(contract.id);
    if (job?.driverId === login.sub) return 'driver';
  }
  return null;
}

const LIVE_JOB: DeliveryJob['state'][] = ['REQUESTED', 'NO_DRIVER', 'ASSIGNED', 'FUNDING_FAILED', 'FUNDS_HELD', 'PICKED_UP', 'ARRIVED', 'DELIVERED', 'PAID'];

/** Whose move it is, and what — the same answer for every screen and channel. */
export function dealNextStep(contract: Contract): NextStep | null {
  const job = getJobForContract(contract.id);
  const liveJob = job && LIVE_JOB.includes(job.state) ? job : undefined;
  switch (contract.state) {
    case 'OFFERED':
      return { actor: 'farmer', action: 'answer_offer', dueAt: null }; // a pre-Phase-1 offer, still answerable
    case 'ACCEPTED':
    case 'FUNDING_FAILED':
      return { actor: 'buyer', action: 'secure_payment', dueAt: null };
    case 'FUNDS_HELD': {
      if (!liveJob) return { actor: 'buyer', action: 'arrange_pickup', dueAt: null };
      if (liveJob.state === 'REQUESTED') return { actor: 'system', action: 'finding_driver', dueAt: null, ref: liveJob.id };
      if (liveJob.state === 'NO_DRIVER') return { actor: 'buyer', action: 'retry_transport', dueAt: null, ref: liveJob.id };
      if (liveJob.state === 'ASSIGNED' || liveJob.state === 'FUNDING_FAILED') return { actor: 'system', action: 'securing_transport', dueAt: null, ref: liveJob.id };
      return { actor: 'driver', action: 'go_to_pickup', dueAt: null, ref: liveJob.id };
    }
    case 'PICKUP_CONFIRMED':
      return { actor: 'buyer', action: 'grade', dueAt: null }; // pickup photos, then the AI grade
    case 'DISPUTED':
      return { actor: 'buyer', action: 'regrade', dueAt: null };
    case 'GRADED': {
      const window = contract.gradedAt ? contract.gradedAt + config.DISPUTE_WINDOW_MINUTES * 60_000 : null;
      if (window && Date.now() < window) return { actor: 'farmer', action: 'review_grade', dueAt: window };
      if (liveJob && (liveJob.state === 'PICKED_UP' || liveJob.state === 'FUNDS_HELD')) return { actor: 'driver', action: 'deliver', dueAt: null, ref: liveJob.id };
      return { actor: 'system', action: 'deliver', dueAt: null };
    }
    case 'DELIVERED':
      return { actor: 'buyer', action: 'confirm_receipt', dueAt: contract.receiptDueAt };
    case 'CLAIMED': {
      const claim = latestClaim(contract.id);
      if (claim?.status === 'awaiting_farmer') return { actor: 'farmer', action: 'answer_claim', dueAt: claim.answerDueAt, ref: claim.id };
      return { actor: 'f2m', action: 'review_claim', dueAt: null, ref: claim?.id };
    }
    case 'RECEIVED':
      return { actor: 'system', action: 'paying_balance', dueAt: null };
    default:
      return null; // settled, cancelled, refunded, declined, expired: nothing left to do
  }
}

function latestClaim(contractId: string): OrderClaim | undefined {
  return db.select().from(orderClaims).where(eq(orderClaims.contractId, contractId)).all().at(-1);
}

const CHANNEL: Record<string, DealChannel> = { web: 'web', ussd: 'ussd', ivr: 'voice', system: null };

// Lot-trace events that belong to one deal, as timeline kinds.
const CONTRACT_KINDS: Record<string, string> = {
  CONTRACT_ACCEPTED: 'accepted',
  FUNDS_HELD: 'funds_held',
  FUNDING_FAILED: 'funding_failed',
  PICKUP_CONFIRMED: 'collected',
  PHOTO_ADDED: 'photo_added',
  GRADED: 'graded',
  DISPUTE_OPENED: 'grade_disputed',
  DISPUTE_RESOLVED: 'regraded',
  DELIVERED: 'delivered',
  RECEIPT_CONFIRMED: 'received',
  CLAIM_RAISED: 'claim_opened',
  REFUNDED: 'refunded',
  CANCELLED: 'cancelled',
  SETTLED: 'settled',
};
const JOB_KINDS: Record<string, string> = {
  TRANSPORT_SUGGESTED: 'transport_suggested',
  TRANSPORT_REQUESTED: 'transport_requested',
  DRIVER_ASSIGNED: 'driver_assigned',
  TRANSPORT_FUNDED: 'transport_funded',
  DRIVER_AT_PICKUP: 'at_pickup',
  IN_TRANSIT: 'loaded',
  DRIVER_DEPARTED: 'departed',
  DRIVER_ARRIVED: 'arrived',
  TRANSPORT_CANCELLED: 'transport_cancelled',
};

/** What each role may see in a timeline item's data: the driver never sees prices or the haggle. */
const MONEY_KEYS = ['amount', 'pricePerUnit', 'total', 'finalAmount', 'deduction', 'proposedDeduction', 'finalDeduction', 'refunded', 'paidToFarmer'];

function timeline(contract: Contract, job: DeliveryJob | undefined, viewer: DealRole): TimelineItem[] {
  const items: TimelineItem[] = [];
  const add = (item: TimelineItem) => items.push(item);

  // The negotiation that made the deal (buyer and farmer only: it is their business).
  const thread = db.select().from(offers).where(eq(offers.contractId, contract.id)).get();
  if (thread && viewer !== 'driver') {
    for (const e of db.select().from(offerEvents).where(eq(offerEvents.offerId, thread.id)).all()) {
      if (e.action === 'accept') continue; // the order's own "accepted" step says it
      add({
        id: e.id,
        at: e.createdAt,
        kind: e.action === 'counter' ? 'countered' : e.action === 'bid' ? 'offer_made' : `offer_${e.action}`,
        actor: e.by,
        channel: CHANNEL[e.channel] ?? null,
        data: { units: e.units, pricePerUnit: e.pricePerUnit, ...(e.units && e.pricePerUnit ? { total: Math.round(e.units * e.pricePerUnit) } : {}) },
      });
    }
  }

  // The order's and the transport's steps, from the lot's history.
  for (const ev of getTrace(contract.lotId)) {
    const p = (ev.payload ?? {}) as Record<string, unknown>;
    const ofThisDeal = p.contractId === contract.id || (job && p.jobId === job.id);
    if (!ofThisDeal) continue;
    const kind = CONTRACT_KINDS[ev.type] ?? JOB_KINDS[ev.type];
    if (!kind) continue;
    const actor: TimelineItem['actor'] = p.driverActor || p.driverId ? 'driver' : (ev.actorType as TimelineItem['actor']);
    add({
      id: ev.id,
      at: ev.createdAt,
      kind: kind === 'received' && p.auto ? 'auto_received' : kind,
      actor,
      channel: null,
      data: {
        ...(p.grade ? { grade: p.grade } : {}),
        ...(p.reason ? { reason: p.reason } : {}),
        ...(p.deduction !== undefined ? { deduction: p.deduction } : {}),
        ...(p.finalAmount !== undefined ? { amount: p.finalAmount } : {}),
        ...(p.refunded !== undefined ? { refunded: p.refunded } : {}),
      },
    });
  }

  // Money that landed.
  for (const pay of db.select().from(payments).where(and(eq(payments.contractId, contract.id), eq(payments.status, 'successful'))).all()) {
    if (pay.direction !== 'disbursement') continue;
    const kind = pay.jobId ? 'driver_paid' : pay.kind === 'advance' ? 'advance_paid' : 'balance_paid';
    if (viewer === 'driver' && kind !== 'driver_paid') continue;
    add({ id: pay.id, at: pay.updatedAt, kind, actor: 'system', channel: null, data: { amount: pay.amount } });
  }

  // Claims: opened is in the trace; the answer and F2M's decision come from the claim itself.
  for (const claim of db.select().from(orderClaims).where(eq(orderClaims.contractId, contract.id)).all()) {
    if (claim.answeredAt) {
      add({ id: `${claim.id}:answer`, at: claim.answeredAt, kind: 'claim_answered', actor: claim.farmerAnswer === 'no_answer' ? 'system' : 'farmer', channel: null, data: { answer: claim.farmerAnswer } });
    }
    if (claim.status === 'resolved' && claim.reviewedAt) {
      add({ id: `${claim.id}:resolve`, at: claim.reviewedAt, kind: 'claim_resolved', actor: 'f2m', channel: null, data: { finalDeduction: claim.finalDeduction, note: claim.reviewNote } });
    }
  }

  // What F2M told the farmer, so the buyer knows they were reached, in their own language.
  if (viewer !== 'driver') {
    const farmer = db.select().from(farmers).where(eq(farmers.id, contract.farmerId)).get();
    if (farmer) {
      for (const n of db.select().from(notifications).where(and(eq(notifications.contractId, contract.id), eq(notifications.phone, farmer.phone))).all()) {
        add({ id: n.id, at: n.createdAt, kind: 'notice_sent', actor: 'system', channel: 'sms', data: { to: 'farmer', template: n.templateKey, locale: farmer.locale, status: n.status } });
      }
      const callFilter = thread ? or(eq(voiceCalls.contractId, contract.id), eq(voiceCalls.offerId, thread.id)) : eq(voiceCalls.contractId, contract.id);
      for (const c of db.select().from(voiceCalls).where(and(eq(voiceCalls.phone, farmer.phone), callFilter!)).all()) {
        add({ id: c.id, at: c.createdAt, kind: 'notice_sent', actor: 'system', channel: 'voice', data: { to: 'farmer', flow: c.flow, locale: c.locale, status: c.status } });
      }
    }
  }

  return items
    // The driver sees no money except their own fee being paid.
    .map((i) => (viewer === 'driver' && i.kind !== 'driver_paid' ? { ...i, data: Object.fromEntries(Object.entries(i.data).filter(([k]) => !MONEY_KEYS.includes(k))) } : i))
    .sort((a, b) => a.at - b.at);
}

/**
 * The deal as one party sees it. The driver sees no prices, money or
 * negotiation; nobody sees anyone's MoMo number; phone numbers show only
 * while the deal is live (paid for and not yet closed), and the driver's only
 * while the job is.
 */
export function getDealView(contractId: string, viewer: DealRole) {
  const contract = db.select().from(contracts).where(eq(contracts.id, contractId)).get();
  if (!contract) throw notFound('deal');
  const lot = db.select().from(lots).where(eq(lots.id, contract.lotId)).get()!;
  const commodity = getCommodityById(contract.commodityId);
  const unit = db.select().from(units).where(eq(units.id, lot.unitId)).get();
  const farmer = db.select().from(farmers).where(eq(farmers.id, contract.farmerId)).get();
  const buyer = db.select().from(buyers).where(eq(buyers.id, contract.buyerId)).get();
  const job = getJobForContract(contract.id);
  const driver = job?.driverId ? db.select().from(drivers).where(eq(drivers.id, job.driverId)).get() : undefined;
  const closed = ['SETTLED', 'CANCELLED', 'CANCELLED_REFUNDED', 'DECLINED', 'EXPIRED'].includes(contract.state);
  const paidFor = !['OFFERED', 'ACCEPTED', 'FUNDING_FAILED'].includes(contract.state);
  const phonesLive = paidFor && !closed;
  const jobLive = Boolean(job && ['ASSIGNED', 'FUNDS_HELD', 'PICKED_UP', 'ARRIVED'].includes(job.state));
  const total = orderTotal(contract) || contract.holdAmount;
  const { landed, pending } = farmerPaid(contract.id);
  const isDriver = viewer === 'driver';

  return {
    viewer,
    deal: {
      id: contract.id,
      state: contract.state,
      lotId: lot.id,
      lotCode: lot.lotCode,
      crop: { code: commodity.code, name: t('en', commodity.nameKey) },
      quantityKg: contract.quantityKg,
      unit: unit ? { code: unit.code, name: t('en', unit.nameKey), qty: Math.round((contract.quantityKg / unit.kgPerUnit) * 100) / 100 } : null,
      pricePerKg: isDriver ? null : Math.round(total / contract.quantityKg),
      total: isDriver ? null : total,
      declaredGrade: lot.declaredBand,
      finalGrade: contract.finalGrade,
      createdAt: contract.createdAt,
    },
    people: {
      farmer: farmer
        ? {
            name: farmer.name,
            district: farmer.district,
            region: t('en', getRegion(farmer.regionCode).nameKey),
            locale: farmer.locale,
            phone: viewer !== 'farmer' && (phonesLive || (isDriver && jobLive)) ? farmer.phone : null,
          }
        : null,
      buyer: buyer
        ? { name: buyer.name, company: buyer.company, phone: viewer !== 'buyer' && (phonesLive || (isDriver && jobLive)) ? buyer.phone : null }
        : null,
      driver: driver
        ? { name: driver.name, vehicle: driver.vehicleClassCode, phone: viewer !== 'driver' && jobLive ? driver.phone : null }
        : null,
    },
    money: isDriver
      ? null
      : {
          total,
          advance: advanceFor(contract),
          paidToFarmer: landed,
          onTheWay: pending,
          stillHeld: stillHeld(contract),
          deduction: contract.deductionAmount ?? 0,
          receiptDueAt: contract.receiptDueAt,
          deliveredAt: contract.deliveredAt,
          receivedAt: contract.receivedAt,
        },
    transport: job
      ? { jobId: job.id, jobCode: job.jobCode, state: job.state, ...(isDriver || viewer === 'buyer' ? { fee: job.quoteAmount } : {}) }
      : null,
    claims: isDriver ? [] : db.select().from(orderClaims).where(eq(orderClaims.contractId, contract.id)).all(),
    photos: db.select({ id: photos.id, path: photos.path }).from(photos).where(eq(photos.contractId, contract.id)).all().map((p) => ({ id: p.id, url: `/${p.path}` })),
    next: dealNextStep(contract),
    timeline: timeline(contract, job, viewer),
  };
}

/** Every deal a login is a party to, newest first — for the "my sales" lists. */
export function listDealsFor(login: { kind: string; sub: string }): string[] {
  if (login.kind === 'buyer') return db.select({ id: contracts.id }).from(contracts).where(eq(contracts.buyerId, login.sub)).all().map((r) => r.id).reverse();
  if (login.kind === 'farmer') return db.select({ id: contracts.id }).from(contracts).where(eq(contracts.farmerId, login.sub)).all().map((r) => r.id).reverse();
  if (login.kind === 'driver') {
    return db
      .select({ id: deliveryJobs.contractId })
      .from(deliveryJobs)
      .where(and(eq(deliveryJobs.driverId, login.sub), inArray(deliveryJobs.state, LIVE_JOB)))
      .all()
      .map((r) => r.id)
      .reverse();
  }
  return [];
}
