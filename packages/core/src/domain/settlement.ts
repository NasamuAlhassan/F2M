import { and, eq, inArray } from 'drizzle-orm';
import { config } from '../config';
import { db } from '../db/client';
import {
  buyers,
  contracts,
  farmers,
  lots,
  orderClaims,
  payments,
  CLAIM_REASONS,
  type Contract,
  type OrderClaim,
  type Payment,
} from '../db/schema';
import { t } from '../i18n';
import { getPaymentProvider } from '../providers/payment/index';
import { transitionContract } from '../state/contractMachine';
import { transitionJob } from '../state/deliveryJobMachine';
import { queueBuyerNotification } from './buyerNotifications';
import { DomainError, notFound } from './errors';
import { ACCOUNTS, postJournal } from './ledger';
import { liveTransport } from './gradingFlow';
import { getJobForContract, initiateJobRelease } from './logistics';
import { queueSms } from './notifications';
import { getCommodityById } from './registries';
import { appendLotEvent } from './trace';
import { formatGhs } from './types';
import { queueVoiceCall } from './voiceCalls';

/**
 * Phase 3 settlement (docs/PHASE3.md, the owner's rules of 2026-11-14):
 * the farmer is paid an advance at pickup and the balance on receipt; the
 * buyer has 24 hours from delivery to confirm or report a problem; a claim
 * proposes a deduction the farmer accepts or refuses, and F2M reviews every
 * claim; the driver is paid on delivery.
 *
 * Money rule: the escrow holds the order total. Advance + balance(s) go to the
 * farmer, the deduction (and any legacy hold-minus-total difference) back to
 * the buyer, and the escrow ends at zero. A deduction never exceeds what is
 * still held: the advance is already on the farmer's phone.
 */

export { CLAIM_REASONS, type OrderClaim } from '../db/schema';

const HOUR_MS = 60 * 60 * 1000;
export type ClaimReason = (typeof CLAIM_REASONS)[number];
/** Reasons that put the transport itself in question: the driver's pay waits for F2M's review. */
const TRANSPORT_REASONS: ClaimReason[] = ['not_delivered', 'damaged'];

function contractRow(contractId: string): Contract {
  const c = db.select().from(contracts).where(eq(contracts.id, contractId)).get();
  if (!c) throw notFound('contract');
  return c;
}

/** What the farmer is owed for the order: the agreed total (legacy per-grade orders: the graded amount). */
export function orderTotal(c: Contract): number {
  return c.agreedTotal ?? c.finalAmount ?? 0;
}

export function advanceFor(c: Contract): number {
  return Math.round((orderTotal(c) * config.FARMER_ADVANCE_PERCENT) / 100);
}

function farmerPayouts(contractId: string): Payment[] {
  return db
    .select()
    .from(payments)
    .where(and(eq(payments.contractId, contractId), eq(payments.direction, 'disbursement')))
    .all()
    .filter((p) => p.jobId === null); // jobId rows are the DRIVER's fee
}

/** Paid to the farmer so far (landed), and on its way (pending). */
export function farmerPaid(contractId: string): { landed: number; pending: number } {
  let landed = 0;
  let pending = 0;
  for (const p of farmerPayouts(contractId)) {
    if (p.status === 'successful') landed += p.amount;
    else if (p.status === 'pending') pending += p.amount;
  }
  return { landed, pending };
}

/** The most a claim may deduct: what has not gone to the farmer yet. */
export function stillHeld(c: Contract): number {
  // A closed order holds nothing: what the farmer was not paid went back to the buyer.
  if (c.state === 'SETTLED' || c.state === 'CANCELLED_REFUNDED') return 0;
  const { landed, pending } = farmerPaid(c.id);
  return Math.max(0, orderTotal(c) - landed - pending);
}

async function payFarmer(c: Contract, kind: 'advance' | 'balance', amount: number): Promise<Payment | null> {
  if (amount <= 0) return null;
  const farmer = db.select().from(farmers).where(eq(farmers.id, c.farmerId)).get();
  if (!farmer) throw notFound('farmer');
  const provider = getPaymentProvider();
  const referenceId = crypto.randomUUID();
  const payment = db
    .insert(payments)
    .values({
      contractId: c.id,
      direction: 'disbursement',
      kind,
      provider: provider.name,
      providerRef: referenceId,
      amount,
      currency: provider.settlementCurrency,
      counterpartyMsisdn: farmer.momoMsisdn,
      status: 'pending',
    })
    .returning()
    .get();
  appendLotEvent(db, { lotId: c.lotId, type: 'PAYMENT_RELEASED', actorType: 'system', payload: { paymentId: payment.id, amount, kind } });
  try {
    const result = await provider.disburse({
      referenceId,
      msisdn: farmer.momoMsisdn,
      amount,
      currency: provider.settlementCurrency,
      externalId: c.id,
      note: `FTM ${kind} ${c.id.slice(0, 8)}`,
    });
    if (result.status === 'failed') {
      db.update(payments).set({ status: 'failed', raw: JSON.stringify(result.raw ?? null), updatedAt: Date.now() }).where(eq(payments.id, payment.id)).run();
    }
  } catch (err) {
    db.update(payments).set({ raw: JSON.stringify({ initiateError: String(err) }), updatedAt: Date.now() }).where(eq(payments.id, payment.id)).run();
  }
  return payment;
}

/**
 * The advance, at grading (any grade but REJECT). Idempotent: an advance on
 * its way or landed is not sent twice; a failed one is sent again.
 */
export async function payAdvance(contractId: string): Promise<Payment | null> {
  const c = contractRow(contractId);
  if (!['GRADED', 'DELIVERED', 'CLAIMED', 'RECEIVED'].includes(c.state) || c.finalGrade === 'REJECT') return null;
  if (farmerPayouts(c.id).some((p) => p.kind === 'advance' && p.status !== 'failed')) return null;
  return payFarmer(c, 'advance', advanceFor(c));
}

/** What the farmer is still owed after any deduction, minus what is already on its way. */
function balanceOwed(c: Contract): number {
  const { landed, pending } = farmerPaid(c.id);
  return Math.max(0, orderTotal(c) - (c.deductionAmount ?? 0) - landed - pending);
}

/** Send what is owed now, or settle the order if nothing is left to send. */
async function releaseBalance(contractId: string): Promise<void> {
  const c = contractRow(contractId);
  if (c.state !== 'RECEIVED') return;
  const owed = balanceOwed(c);
  if (owed > 0) {
    await payFarmer(c, 'balance', owed);
    return;
  }
  if (farmerPaid(c.id).pending === 0) settle(c.id);
}

/**
 * The order is done: the buyer gets back the deduction (and any legacy hold
 * difference), the escrow empties, and both sides are told.
 */
function settle(contractId: string): Contract {
  const c = contractRow(contractId);
  const { landed } = farmerPaid(c.id);
  const refund = c.holdAmount - landed;
  const settled = transitionContract(c.id, 'SETTLED', { type: 'system' }, {
    payload: { paidToFarmer: landed, refunded: refund, deduction: c.deductionAmount ?? 0 },
    also: (tx) => {
      postJournal(tx, c.id, [
        { account: ACCOUNTS.escrow(c.id), debit: refund, memoKey: 'ledger.refundRemainder' },
        { account: ACCOUNTS.buyerRefunds(c.buyerId), credit: refund, memoKey: 'ledger.refundRemainder' },
      ]);
    },
  });
  queueBuyerNotification({
    buyerId: c.buyerId,
    templateKey: 'notif.settled',
    params: { amount: formatGhs(landed), refunded: formatGhs(refund) },
    contractId: c.id,
    lotId: c.lotId,
  });
  return settled;
}

/**
 * A farmer payout landed or failed — called from pollPaymentsOnce for every
 * disbursement that is not a driver fee. The ledger records each payout as it
 * lands; the last one settles the order.
 */
export async function onFarmerPayout(payment: Payment, status: 'successful' | 'failed'): Promise<void> {
  if (status !== 'successful') return; // a failed payout is sent again by the sweep (retryFarmerPayouts)
  const c = contractRow(payment.contractId);
  db.transaction((tx) => {
    postJournal(tx, c.id, [
      { account: ACCOUNTS.escrow(c.id), debit: payment.amount, memoKey: payment.kind === 'advance' ? 'ledger.advance' : 'ledger.payout' },
      { account: ACCOUNTS.farmerPayable(c.farmerId), credit: payment.amount, memoKey: payment.kind === 'advance' ? 'ledger.advance' : 'ledger.payout' },
    ]);
    if (payment.kind === 'advance') tx.update(contracts).set({ advanceAmount: payment.amount }).where(eq(contracts.id, c.id)).run();
  });
  const farmer = db.select().from(farmers).where(eq(farmers.id, c.farmerId)).get();
  if (farmer) {
    queueSms({ phone: farmer.phone, locale: farmer.locale, templateKey: 'sms.paid', params: { amount: formatGhs(payment.amount) }, contractId: c.id, lotId: c.lotId });
  }
  if (payment.kind !== 'advance') await releaseBalance(c.id);
}

/** Sweep: send again a farmer payout that failed (an advance, or a balance owed on a received order). */
export async function retryFarmerPayouts(): Promise<number> {
  let sent = 0;
  for (const c of db.select().from(contracts).where(inArray(contracts.state, ['GRADED', 'DELIVERED', 'CLAIMED', 'RECEIVED'])).all()) {
    const payouts = farmerPayouts(c.id);
    if (c.finalGrade !== 'REJECT' && !payouts.some((p) => p.kind === 'advance' && p.status !== 'failed') && payouts.some((p) => p.kind === 'advance')) {
      if (await payAdvance(c.id)) sent++;
    }
    if (c.state === 'RECEIVED' && balanceOwed(c) > 0 && payouts.some((p) => p.status === 'failed' && p.kind === 'balance')) {
      await releaseBalance(c.id);
      sent++;
    }
  }
  return sent;
}

// ── delivery and receipt ─────────────────────────────────────────────────

/** The produce is at the buyer: the 24 h receipt clock starts. */
export function markDelivered(contractId: string, via: 'driver' | 'no_transport'): Contract {
  const c = contractRow(contractId);
  const receiptDueAt = Date.now() + config.RECEIPT_WINDOW_HOURS * HOUR_MS;
  const delivered = transitionContract(c.id, 'DELIVERED', { type: 'system' }, { receiptDueAt, payload: { via } });
  const lot = db.select().from(lots).where(eq(lots.id, c.lotId)).get()!;
  queueBuyerNotification({
    buyerId: c.buyerId,
    templateKey: 'notif.arrived',
    params: { lotCode: lot.lotCode, hours: config.RECEIPT_WINDOW_HOURS },
    contractId: c.id,
    lotId: c.lotId,
  });
  return delivered;
}

/** Pay the driver: their job becomes delivered and the fee goes out (the owner's "driver paid on delivery"). */
async function payDriver(contractId: string, actor: { type: 'buyer' | 'system'; id?: string }): Promise<void> {
  const job = getJobForContract(contractId);
  if (!job) return;
  // Before the driver says "arrived", only the buyer's own receipt can close the job.
  if (job.state === 'PICKED_UP' && !(actor.type === 'buyer' && actor.id)) return;
  if (job.state !== 'ARRIVED' && job.state !== 'PICKED_UP') return;
  transitionJob(job.id, 'DELIVERED', actor.type === 'buyer' ? { type: 'buyer', id: actor.id } : { type: 'system' });
  await initiateJobRelease(job.id);
}

/**
 * The buyer has the produce and is satisfied — or said nothing for 24 hours.
 * The driver is paid and the farmer's balance goes out.
 */
export async function confirmReceipt(contractId: string, actor: { type: 'buyer'; id: string } | { type: 'system' }): Promise<Contract> {
  const c = contractRow(contractId);
  if (actor.type === 'buyer' && c.buyerId !== actor.id) throw new DomainError('Not your order', 'FORBIDDEN', 403);
  if (c.state !== 'DELIVERED') throw new DomainError('This order is not waiting for your receipt', 'INVALID_STATE', 409);
  const received = transitionContract(c.id, 'RECEIVED', actor, { payload: { auto: actor.type === 'system' } });
  const job = getJobForContract(c.id);
  if (job && (job.state === 'ARRIVED' || (job.state === 'PICKED_UP' && actor.type === 'buyer'))) {
    await payDriver(c.id, actor.type === 'buyer' ? actor : { type: 'system' });
  }
  notifyFarmerReceived(received);
  if (actor.type === 'system') {
    const lot = db.select().from(lots).where(eq(lots.id, c.lotId)).get()!;
    queueBuyerNotification({
      buyerId: c.buyerId,
      templateKey: 'notif.autoReceived',
      params: { lotCode: lot.lotCode, hours: config.RECEIPT_WINDOW_HOURS },
      contractId: c.id,
      lotId: c.lotId,
    });
  }
  await releaseBalance(c.id);
  return contractRow(c.id);
}

function notifyFarmerReceived(c: Contract): void {
  const farmer = db.select().from(farmers).where(eq(farmers.id, c.farmerId)).get();
  if (!farmer) return;
  queueSms({
    phone: farmer.phone,
    locale: farmer.locale,
    templateKey: 'sms.received',
    params: { commodity: t(farmer.locale, getCommodityById(c.commodityId).nameKey), amount: formatGhs(balanceOwed(c)) },
    contractId: c.id,
    lotId: c.lotId,
  });
}

// ── claims ───────────────────────────────────────────────────────────────

export interface FileClaimInput {
  contractId: string;
  buyerId: string;
  reason: ClaimReason;
  note?: string;
  /** Pesewas the buyer asks to deduct; at most what is still held. */
  deduction: number;
}

export function getClaim(id: string): OrderClaim {
  const claim = db.select().from(orderClaims).where(eq(orderClaims.id, id)).get();
  if (!claim) throw notFound('claim');
  return claim;
}

export function listClaimsForContract(contractId: string): OrderClaim[] {
  return db.select().from(orderClaims).where(eq(orderClaims.contractId, contractId)).all();
}

export function listClaimsForFarmer(farmerId: string, status?: OrderClaim['status']): Array<OrderClaim & { contract: Contract }> {
  return db
    .select()
    .from(orderClaims)
    .innerJoin(contracts, eq(orderClaims.contractId, contracts.id))
    .where(eq(contracts.farmerId, farmerId))
    .all()
    .map((r) => ({ ...r.order_claims, contract: r.contracts }))
    .filter((r) => !status || r.status === status);
}

/** Every claim F2M has not reviewed yet — the Phase 4 reviewer's queue. */
export function listClaimsForReview(): OrderClaim[] {
  return db.select().from(orderClaims).where(eq(orderClaims.reviewStatus, 'pending')).all();
}

/** The buyer reports a problem on a delivered order, within the 24 h clock (vision §20). */
export function fileClaim(input: FileClaimInput): OrderClaim {
  const c = contractRow(input.contractId);
  if (c.buyerId !== input.buyerId) throw new DomainError('Not your order', 'FORBIDDEN', 403);
  if (c.state !== 'DELIVERED') throw new DomainError('A problem can be reported once the produce has arrived', 'INVALID_STATE', 409);
  if (c.receiptDueAt && Date.now() > c.receiptDueAt) {
    throw new DomainError(`The ${config.RECEIPT_WINDOW_HOURS} hours to report a problem have passed`, 'CLAIM_WINDOW_CLOSED', 409);
  }
  if (!CLAIM_REASONS.includes(input.reason)) throw new DomainError('Say what is wrong', 'VALIDATION', 400);
  const held = stillHeld(c);
  if (!Number.isInteger(input.deduction) || input.deduction < 0 || input.deduction > held) {
    throw new DomainError(`You can ask to deduct at most ${formatGhs(held)}: the rest is already paid to the farmer`, 'DEDUCTION_TOO_LARGE', 409);
  }
  const now = Date.now();
  const claim = db.transaction((tx) => {
    const row = tx
      .insert(orderClaims)
      .values({
        contractId: c.id,
        buyerId: c.buyerId,
        reason: input.reason,
        note: input.note?.trim().slice(0, 500) || null,
        proposedDeduction: input.deduction,
        answerDueAt: now + config.CLAIM_ANSWER_HOURS * HOUR_MS,
      })
      .returning()
      .get();
    return row;
  });
  transitionContract(c.id, 'CLAIMED', { type: 'buyer', id: input.buyerId }, {
    payload: { claimId: claim.id, reason: input.reason, deduction: input.deduction },
  });
  // A quality or weight problem is not the driver's doing: they are paid now.
  if (!TRANSPORT_REASONS.includes(input.reason)) void payDriver(c.id, { type: 'buyer', id: input.buyerId }).catch(() => {});

  const farmer = db.select().from(farmers).where(eq(farmers.id, c.farmerId)).get();
  const buyer = db.select().from(buyers).where(eq(buyers.id, c.buyerId)).get();
  if (farmer) {
    queueSms({
      phone: farmer.phone,
      locale: farmer.locale,
      templateKey: 'sms.claimRaised',
      params: {
        buyer: buyer?.company ?? buyer?.name ?? 'The buyer',
        commodity: t(farmer.locale, getCommodityById(c.commodityId).nameKey),
        reason: t(farmer.locale, `claim.reason.${input.reason}`),
        amount: formatGhs(input.deduction),
        rest: formatGhs(held),
        hours: config.CLAIM_ANSWER_HOURS,
        code: config.USSD_SHORTCODE,
      },
      contractId: c.id,
      lotId: c.lotId,
    });
    queueVoiceCall({ phone: farmer.phone, locale: farmer.locale, flow: 'claim', contractId: c.id });
  }
  return claim;
}

/** The claim waiting on this order, if any. */
export function openClaimFor(contractId: string): OrderClaim | undefined {
  return listClaimsForContract(contractId).find((cl) => cl.status === 'awaiting_farmer');
}

/**
 * The farmer answers a claim. Accept: the order settles with the buyer's
 * deduction. Refuse (or no answer): the part not in question is paid now and
 * F2M decides the rest.
 */
export async function answerClaim(claimId: string, farmerId: string | null, accept: boolean): Promise<OrderClaim> {
  const claim = getClaim(claimId);
  const c = contractRow(claim.contractId);
  if (farmerId !== null && c.farmerId !== farmerId) throw new DomainError('Not your order', 'FORBIDDEN', 403);
  if (claim.status !== 'awaiting_farmer') throw new DomainError('This claim has already been answered', 'CLAIM_ANSWERED', 409);
  const now = Date.now();
  const answer = accept ? 'accepted' : farmerId === null ? 'no_answer' : 'refused';
  db.update(orderClaims)
    .set({ status: accept ? 'accepted' : 'awaiting_review', farmerAnswer: answer, answeredAt: now, ...(accept ? { finalDeduction: claim.proposedDeduction } : {}) })
    .where(eq(orderClaims.id, claim.id))
    .run();
  appendLotEvent(db, { lotId: c.lotId, type: 'CLAIM_ANSWERED', actorType: farmerId ? 'farmer' : 'system', actorId: farmerId, payload: { claimId, answer } });

  if (accept) {
    transitionContract(c.id, 'RECEIVED', { type: 'system' }, { deductionAmount: claim.proposedDeduction, payload: { claimId, by: 'farmer' } });
    // The farmer agreeing settles the farmer's side only. A claim about the
    // transport itself still waits for F2M's review before the driver is paid.
    if (!TRANSPORT_REASONS.includes(claim.reason)) await payDriver(c.id, { type: 'system' }).catch(() => {});
    queueBuyerNotification({ buyerId: c.buyerId, templateKey: 'notif.claimAccepted', params: { amount: formatGhs(claim.proposedDeduction) }, contractId: c.id, lotId: c.lotId });
    await releaseBalance(c.id);
  } else {
    // The undisputed part goes out now; the disputed amount stays held for F2M.
    const undisputed = Math.max(0, stillHeld(c) - claim.proposedDeduction);
    await payFarmer(c, 'balance', undisputed);
    queueBuyerNotification({ buyerId: c.buyerId, templateKey: 'notif.claimRefused', params: { amount: formatGhs(claim.proposedDeduction) }, contractId: c.id, lotId: c.lotId });
    const farmer = db.select().from(farmers).where(eq(farmers.id, c.farmerId)).get();
    if (farmer) {
      queueSms({
        phone: farmer.phone,
        locale: farmer.locale,
        templateKey: 'sms.claimReview',
        params: { amount: formatGhs(undisputed), disputed: formatGhs(claim.proposedDeduction) },
        contractId: c.id,
        lotId: c.lotId,
      });
    }
  }
  return getClaim(claim.id);
}

/**
 * F2M's decision on a refused claim: a deduction from 0 up to what the buyer
 * asked. Also used to mark an accepted claim as reviewed (no money moves).
 * The Phase 4 admin screen calls this; until then a simulator-only route.
 */
export async function resolveClaim(claimId: string, input: { deduction?: number; note?: string; reviewer: string }): Promise<OrderClaim> {
  const claim = getClaim(claimId);
  const c = contractRow(claim.contractId);
  const now = Date.now();
  if (claim.status === 'accepted' || claim.status === 'resolved') {
    db.update(orderClaims).set({ reviewStatus: 'reviewed', reviewNote: input.note ?? null, reviewedBy: input.reviewer, reviewedAt: now }).where(eq(orderClaims.id, claim.id)).run();
    // Reviewing an accepted transport claim is what releases the driver's fee.
    if (claim.status === 'accepted' && TRANSPORT_REASONS.includes(claim.reason)) await payDriver(c.id, { type: 'system' }).catch(() => {});
    return getClaim(claim.id);
  }
  if (claim.status !== 'awaiting_review') throw new DomainError('The farmer has not answered this claim yet', 'CLAIM_NOT_READY', 409);
  const deduction = input.deduction ?? 0;
  if (!Number.isInteger(deduction) || deduction < 0 || deduction > claim.proposedDeduction) {
    throw new DomainError(`The deduction must be between 0 and ${formatGhs(claim.proposedDeduction)}`, 'VALIDATION', 400);
  }
  db.update(orderClaims)
    .set({ status: 'resolved', finalDeduction: deduction, reviewStatus: 'reviewed', reviewNote: input.note ?? null, reviewedBy: input.reviewer, reviewedAt: now })
    .where(eq(orderClaims.id, claim.id))
    .run();
  appendLotEvent(db, { lotId: c.lotId, type: 'CLAIM_RESOLVED', actorType: 'system', payload: { claimId, deduction } });
  transitionContract(c.id, 'RECEIVED', { type: 'system' }, { deductionAmount: deduction, payload: { claimId, by: 'f2m' } });
  await payDriver(c.id, { type: 'system' }).catch(() => {});
  const farmer = db.select().from(farmers).where(eq(farmers.id, c.farmerId)).get();
  if (farmer) {
    queueSms({
      phone: farmer.phone,
      locale: farmer.locale,
      templateKey: 'sms.claimDecided',
      params: { commodity: t(farmer.locale, getCommodityById(c.commodityId).nameKey), deduction: formatGhs(deduction), amount: formatGhs(balanceOwed(contractRow(c.id))) },
      contractId: c.id,
      lotId: c.lotId,
    });
  }
  queueBuyerNotification({ buyerId: c.buyerId, templateKey: 'notif.claimDecided', params: { amount: formatGhs(deduction) }, contractId: c.id, lotId: c.lotId });
  await releaseBalance(c.id);
  return getClaim(claim.id);
}

/**
 * Sweep: deliveries whose 24 h clock ran out are received; claims the farmer
 * did not answer in time go to F2M's review as refused.
 */
export async function sweepSettlement(now = Date.now()): Promise<{ autoReceived: number; unanswered: number }> {
  // Graded orders with no transport job: once the farmer's grade-dispute
  // window has passed, the buyer has the produce and the 24 h clock starts.
  const windowMs = config.DISPUTE_WINDOW_MINUTES * 60 * 1000;
  for (const c of db.select().from(contracts).where(eq(contracts.state, 'GRADED')).all()) {
    if (c.gradedAt !== null && now - c.gradedAt >= windowMs && !liveTransport(c.id)) markDelivered(c.id, 'no_transport');
  }
  let autoReceived = 0;
  for (const c of db.select().from(contracts).where(eq(contracts.state, 'DELIVERED')).all()) {
    if (c.receiptDueAt !== null && c.receiptDueAt <= now) {
      await confirmReceipt(c.id, { type: 'system' });
      autoReceived++;
    }
  }
  let unanswered = 0;
  for (const claim of db.select().from(orderClaims).where(eq(orderClaims.status, 'awaiting_farmer')).all()) {
    if (claim.answerDueAt <= now) {
      await answerClaim(claim.id, null, false);
      unanswered++;
    }
  }
  return { autoReceived, unanswered };
}
