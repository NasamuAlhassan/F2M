import { and, eq, inArray } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../config';
import { db } from '../db/client';
import { contracts, demands, orderClaims, payments } from '../db/schema';
import { setGradingProvider, type GradingResult } from '../providers/grading/index';
import { MockPaymentProvider, setPaymentProvider } from '../providers/payment/index';
import { acceptFor, testBuyer } from '../testing/fixtures';
import { registerBuyer } from './buyers';
import { getContract } from './contracts';
import { registerDriver } from './drivers';
import { registerFarmer } from './farmers';
import { agreeGrading, confirmPickup, disputeGrading, runGrading } from './gradingFlow';
import { accountBalance, ACCOUNTS, allJournalsBalanced, contractEscrowBalance, contractLedger, jobEscrowBalance } from './ledger';
import { acceptJob, confirmJobPickup, driverArrived, getJob, requestTransport } from './logistics';
import { registerLot } from './lots';
import { listNotificationsForPhone } from './notifications';
import { placeBid } from './offers';
import { pollPaymentsOnce } from './paymentFlow';
import { addPhoto } from './photos';
import { getCommodityByCode } from './registries';
import {
  advanceFor,
  answerClaim,
  confirmReceipt,
  fileClaim,
  getClaim,
  listClaimsForReview,
  orderTotal,
  payAdvance,
  resolveClaim,
  stillHeld,
  sweepSettlement,
} from './settlement';
import { listVoiceCallsForPhone } from './voiceCalls';

/**
 * Phase 3 money rules (docs/PHASE3.md): the advance at grading, the balance on
 * receipt, claims and F2M's review, and the driver's pay. Millet and the
 * +2332074970xx/71xx numbers are this suite's own: the database is shared.
 */

const HOUR = 60 * 60 * 1000;
const UNITS = 5; // 5 × 100kg bags
const PRICE = 70_000; // GHS 700 a bag
const TOTAL = UNITS * PRICE;
const ADVANCE = Math.round((TOTAL * config.FARMER_ADVANCE_PERCENT) / 100);

const verdicts: GradingResult[] = [];
function scriptVerdict(gradeBand: string) {
  verdicts.push({
    gradeBand,
    confidence: 0.9,
    reasons: [{ criterion: 'moisture', observation: `scripted ${gradeBand}`, bandForCriterion: gradeBand }],
    provider: 'mock',
  });
}

let farmerSeq = 0;
let driverSeq = 0;
const farmerPhone = () => `+2332074970${String(++farmerSeq).padStart(2, '0')}`;
const driverPhone = () => `+2332074971${String(++driverSeq).padStart(2, '0')}`;

const buyer = () => testBuyer();
const farmerGot = (farmerId: string) => accountBalance(ACCOUNTS.farmerPayable(farmerId));
const buyerRefunds = () => accountBalance(ACCOUNTS.buyerRefunds(buyer().id));
const farmerPayoutRows = (contractId: string) =>
  db
    .select()
    .from(payments)
    .where(and(eq(payments.contractId, contractId), eq(payments.direction, 'disbursement')))
    .all()
    .filter((p) => p.jobId === null);

beforeAll(() => {
  setPaymentProvider(new MockPaymentProvider(0));
  setGradingProvider({
    name: 'mock',
    grade: async () => {
      const next = verdicts.shift();
      if (!next) throw new Error('no scripted verdict');
      return next;
    },
  });
});
afterAll(() => {
  setPaymentProvider(null);
  setGradingProvider(null);
});
beforeEach(() => {
  // A stray open millet request would make the engine bid on our listings too.
  const millet = getCommodityByCode('MILLET');
  db.update(demands)
    .set({ status: 'cancelled' })
    .where(and(eq(demands.commodityId, millet.id), inArray(demands.status, ['open', 'partially_matched'])))
    .run();
});

async function photo(): Promise<Buffer> {
  return sharp({ create: { width: 1200, height: 900, channels: 3, background: { r: 190, g: 170, b: 90 } } })
    .jpeg()
    .toBuffer();
}

/** A fresh farmer's millet listing, bought whole by the test buyer and funded. */
async function fundedOrder() {
  const farmer = registerFarmer({ phone: farmerPhone(), name: 'Millet Farmer', regionCode: 'NORTHERN' });
  const lot = registerLot({ farmerId: farmer.id, commodityCode: 'MILLET', unitCode: 'BAG_100KG', unitQty: UNITS, declaredBand: 'B' });
  placeBid({ buyerId: buyer().id, lotId: lot.id, units: UNITS, pricePerUnit: PRICE });
  const order = await acceptFor(farmer.id, lot.id);
  await pollPaymentsOnce();
  expect(getContract(order.id)).toMatchObject({ state: 'FUNDS_HELD', agreedTotal: TOTAL, holdAmount: TOTAL });
  return { farmer, lot, contractId: order.id };
}

/** Photo + scripted grade; then the advance (if any) lands. */
async function grade(contractId: string, band: string) {
  await addPhoto({ contractId, buffer: await photo(), actor: { type: 'buyer', id: buyer().id } });
  scriptVerdict(band);
  await runGrading(contractId);
  await pollPaymentsOnce();
}

async function gradedOrder(band = 'B') {
  const order = await fundedOrder();
  confirmPickup(order.contractId, { type: 'farmer', id: order.farmer.id });
  await grade(order.contractId, band);
  return order;
}

/** No transport job: the farmer agrees to the grade, so the buyer's 24 h clock starts. */
async function deliveredOrder() {
  const order = await gradedOrder();
  await agreeGrading(order.contractId, order.farmer.id);
  expect(getContract(order.contractId).state).toBe('DELIVERED');
  return order;
}

/** A funded order carried by a hired van driver, picked up and graded; the driver has not arrived yet. */
async function transportOrder({ graded = true } = {}) {
  const order = await fundedOrder();
  const driver = registerDriver({ phone: driverPhone(), name: 'Millet Driver', regionCode: 'NORTHERN', vehicleClassCode: 'van', pin: '1234' });
  const requested = requestTransport(order.contractId, buyer().id, undefined, driver.id);
  await acceptJob(requested.id, driver.id);
  await pollPaymentsOnce();
  expect(getJob(requested.id).state).toBe('FUNDS_HELD');
  confirmJobPickup(requested.id, driver.id);
  if (graded) {
    await grade(order.contractId, 'B');
    expect(getContract(order.contractId).state).toBe('GRADED');
  }
  return { ...order, driver, job: getJob(requested.id) };
}

/** The DomainError code a call throws, or null. */
function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (err) {
    return (err as { code?: string }).code ?? String(err);
  }
}

async function landAll() {
  await pollPaymentsOnce();
  await pollPaymentsOnce(); // a payout that lands can send the next one (the balance after a decision)
}

describe('the farmer’s advance at grading', () => {
  it('sends FARMER_ADVANCE_PERCENT of the total once, with an advance line in the ledger', async () => {
    const { farmer, contractId } = await gradedOrder('B');
    const c = getContract(contractId);
    expect(advanceFor(c)).toBe(ADVANCE);
    expect(c.advanceAmount).toBe(ADVANCE);
    expect(farmerGot(farmer.id)).toBe(ADVANCE);

    const lines = contractLedger(contractId).filter((l) => l.memoKey === 'ledger.advance');
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.account === ACCOUNTS.escrow(contractId))?.debit).toBe(ADVANCE);
    expect(lines.find((l) => l.account === ACCOUNTS.farmerPayable(farmer.id))?.credit).toBe(ADVANCE);

    // Never twice: not by calling again, not by the farmer agreeing.
    expect(await payAdvance(contractId)).toBeNull();
    await agreeGrading(contractId, farmer.id);
    await pollPaymentsOnce();
    expect(farmerPayoutRows(contractId).filter((p) => p.kind === 'advance')).toHaveLength(1);
    expect(farmerGot(farmer.id)).toBe(ADVANCE);
    expect(contractEscrowBalance(contractId)).toBe(TOTAL - ADVANCE);
    expect(allJournalsBalanced()).toBe(true);
  });

  it('pays no advance on REJECT and refunds the buyer in full', async () => {
    const refundsBefore = buyerRefunds();
    const { farmer, contractId } = await gradedOrder('REJECT');
    expect(getContract(contractId).state).toBe('CANCELLED_REFUNDED');
    expect(farmerPayoutRows(contractId)).toHaveLength(0);
    expect(farmerGot(farmer.id)).toBe(0);
    expect(buyerRefunds() - refundsBefore).toBe(TOTAL);
    expect(contractEscrowBalance(contractId)).toBe(0);
    expect(allJournalsBalanced()).toBe(true);
  });

  it('a disputed re-grade that comes back REJECT refunds only what is still held: the advance stays with the farmer', async () => {
    const { farmer, contractId } = await gradedOrder('C');
    expect(farmerGot(farmer.id)).toBe(ADVANCE);
    const refundsBefore = buyerRefunds();

    disputeGrading(contractId, farmer.id, 'the grain was dry');
    scriptVerdict('REJECT');
    await runGrading(contractId);
    await pollPaymentsOnce();

    expect(getContract(contractId).state).toBe('CANCELLED_REFUNDED');
    expect(buyerRefunds() - refundsBefore).toBe(TOTAL - ADVANCE);
    expect(farmerGot(farmer.id)).toBe(ADVANCE);
    expect(contractEscrowBalance(contractId)).toBe(0);
    expect(allJournalsBalanced()).toBe(true);
  });
});

describe('delivery and receipt', () => {
  it('an order with no transport waits out the grade-dispute window, then the sweep delivers it', async () => {
    const { contractId } = await gradedOrder('B');
    await sweepSettlement();
    expect(getContract(contractId).state).toBe('GRADED'); // the farmer may still dispute

    // Age this order's grade past the window instead of moving the clock for every row.
    const windowMs = config.DISPUTE_WINDOW_MINUTES * 60 * 1000;
    db.update(contracts).set({ gradedAt: Date.now() - windowMs - 60_000 }).where(eq(contracts.id, contractId)).run();
    const before = Date.now();
    await sweepSettlement();

    const c = getContract(contractId);
    expect(c.state).toBe('DELIVERED');
    expect(c.receiptDueAt).toBeGreaterThanOrEqual(before + config.RECEIPT_WINDOW_HOURS * HOUR);
    expect(c.receiptDueAt).toBeLessThanOrEqual(Date.now() + config.RECEIPT_WINDOW_HOURS * HOUR);
  });

  it('the buyer’s receipt sends the balance and settles: the farmer gets exactly the total, the escrow ends at 0', async () => {
    const { farmer, contractId } = await deliveredOrder();
    const refundsBefore = buyerRefunds();
    const other = registerBuyer({ phone: '+233207497080', name: 'Other Buyer', regionCode: 'GREATER_ACCRA' });
    await expect(confirmReceipt(contractId, { type: 'buyer', id: other.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await confirmReceipt(contractId, { type: 'buyer', id: buyer().id });
    expect(getContract(contractId).state).toBe('RECEIVED');
    await landAll();

    expect(getContract(contractId).state).toBe('SETTLED');
    expect(farmerGot(farmer.id)).toBe(TOTAL);
    const balance = contractLedger(contractId).find((l) => l.memoKey === 'ledger.payout' && l.account === ACCOUNTS.farmerPayable(farmer.id));
    expect(balance?.credit).toBe(TOTAL - ADVANCE);
    expect(buyerRefunds() - refundsBefore).toBe(0);
    expect(contractEscrowBalance(contractId)).toBe(0);
    expect(allJournalsBalanced()).toBe(true);
  });

  it('a buyer who says nothing for 24 hours has received it: the sweep confirms and the order settles', async () => {
    const { farmer, contractId } = await deliveredOrder();
    await sweepSettlement();
    expect(getContract(contractId).state).toBe('DELIVERED'); // the clock has not run out

    db.update(contracts).set({ receiptDueAt: Date.now() - 1000 }).where(eq(contracts.id, contractId)).run();
    const { autoReceived } = await sweepSettlement();
    expect(autoReceived).toBeGreaterThanOrEqual(1);
    expect(getContract(contractId).state).toBe('RECEIVED');
    await landAll();

    expect(getContract(contractId).state).toBe('SETTLED');
    expect(farmerGot(farmer.id)).toBe(TOTAL);
    expect(contractEscrowBalance(contractId)).toBe(0);
  });
});

describe('claims', () => {
  it('accepted: the farmer gets the total minus the deduction, the buyer gets the deduction back, the order settles', async () => {
    const { farmer, contractId } = await deliveredOrder();
    const refundsBefore = buyerRefunds();
    const deduction = 20_000;

    const claim = fileClaim({ contractId, buyerId: buyer().id, reason: 'quality', note: 'damp bags', deduction });
    expect(getContract(contractId).state).toBe('CLAIMED');
    expect(claim).toMatchObject({ status: 'awaiting_farmer', reviewStatus: 'pending', proposedDeduction: deduction });

    const answered = await answerClaim(claim.id, farmer.id, true);
    expect(answered).toMatchObject({ status: 'accepted', farmerAnswer: 'accepted', finalDeduction: deduction });
    expect(getContract(contractId)).toMatchObject({ state: 'RECEIVED', deductionAmount: deduction });
    await landAll();

    expect(getContract(contractId).state).toBe('SETTLED');
    expect(farmerGot(farmer.id)).toBe(TOTAL - deduction);
    expect(buyerRefunds() - refundsBefore).toBe(deduction);
    expect(contractEscrowBalance(contractId)).toBe(0);
    expect(allJournalsBalanced()).toBe(true);

    // Accepted claims are audited too; marking one reviewed moves no money.
    expect(listClaimsForReview().map((c) => c.id)).toContain(claim.id);
    const ledgerBefore = contractLedger(contractId).length;
    const reviewed = await resolveClaim(claim.id, { note: 'fair', reviewer: 'test' });
    expect(reviewed.reviewStatus).toBe('reviewed');
    expect(contractLedger(contractId)).toHaveLength(ledgerBefore);
    expect(listClaimsForReview().map((c) => c.id)).not.toContain(claim.id);
  });

  it('refused: the undisputed part is paid now, and F2M’s smaller deduction pays the rest and settles', async () => {
    const { farmer, contractId } = await deliveredOrder();
    const refundsBefore = buyerRefunds();
    const proposed = 50_000;
    const decided = 20_000;

    const claim = fileClaim({ contractId, buyerId: buyer().id, reason: 'short_weight', deduction: proposed });
    const answered = await answerClaim(claim.id, farmer.id, false);
    expect(answered).toMatchObject({ status: 'awaiting_review', farmerAnswer: 'refused', reviewStatus: 'pending' });
    await landAll();

    // Everything but the amount in question is on the farmer's phone; the order waits for F2M.
    expect(getContract(contractId).state).toBe('CLAIMED');
    expect(farmerGot(farmer.id)).toBe(TOTAL - proposed);
    expect(contractEscrowBalance(contractId)).toBe(proposed);

    await expect(resolveClaim(claim.id, { deduction: proposed + 1, reviewer: 'test' })).rejects.toMatchObject({ code: 'VALIDATION' });
    const resolved = await resolveClaim(claim.id, { deduction: decided, note: 'one bag light', reviewer: 'test' });
    expect(resolved).toMatchObject({ status: 'resolved', finalDeduction: decided, reviewStatus: 'reviewed' });
    await landAll();

    expect(getContract(contractId)).toMatchObject({ state: 'SETTLED', deductionAmount: decided });
    expect(farmerGot(farmer.id)).toBe(TOTAL - decided);
    expect(buyerRefunds() - refundsBefore).toBe(decided);
    expect(contractEscrowBalance(contractId)).toBe(0);
    expect(allJournalsBalanced()).toBe(true);
  });

  it('a claim the farmer does not answer in time counts as refused and goes to F2M', async () => {
    const { farmer, contractId } = await deliveredOrder();
    const proposed = 30_000;
    const claim = fileClaim({ contractId, buyerId: buyer().id, reason: 'late', deduction: proposed });

    db.update(orderClaims).set({ answerDueAt: Date.now() - 1000 }).where(eq(orderClaims.id, claim.id)).run();
    const { unanswered } = await sweepSettlement();
    expect(unanswered).toBeGreaterThanOrEqual(1);

    expect(getClaim(claim.id)).toMatchObject({ farmerAnswer: 'no_answer', status: 'awaiting_review', reviewStatus: 'pending' });
    await landAll();
    expect(getContract(contractId).state).toBe('CLAIMED');
    expect(farmerGot(farmer.id)).toBe(TOTAL - proposed);
  });

  it('refuses a deduction larger than what is still held', async () => {
    const { contractId } = await deliveredOrder();
    const held = stillHeld(getContract(contractId));
    expect(held).toBe(orderTotal(getContract(contractId)) - ADVANCE);
    expect(codeOf(() => fileClaim({ contractId, buyerId: buyer().id, reason: 'quality', deduction: held + 1 }))).toBe('DEDUCTION_TOO_LARGE');
    expect(getContract(contractId).state).toBe('DELIVERED');
  });

  it('refuses a claim once the 24 hours have passed', async () => {
    const { contractId } = await deliveredOrder();
    db.update(contracts).set({ receiptDueAt: Date.now() - 1000 }).where(eq(contracts.id, contractId)).run();
    expect(codeOf(() => fileClaim({ contractId, buyerId: buyer().id, reason: 'quality', deduction: 1000 }))).toBe('CLAIM_WINDOW_CLOSED');
  });

  it('refuses a claim from another buyer', async () => {
    const { contractId } = await deliveredOrder();
    const other = registerBuyer({ phone: '+233207497081', name: 'Nosy Buyer', regionCode: 'GREATER_ACCRA' });
    expect(codeOf(() => fileClaim({ contractId, buyerId: other.id, reason: 'quality', deduction: 1000 }))).toBe('FORBIDDEN');
    expect(getContract(contractId).state).toBe('DELIVERED');
  });

  it('texts and rings the farmer, and every claim lands in F2M’s review list', async () => {
    const { farmer, contractId } = await deliveredOrder();
    const claim = fileClaim({ contractId, buyerId: buyer().id, reason: 'damaged', deduction: 10_000 });

    const sms = listNotificationsForPhone(farmer.phone, 20).find((n) => n.templateKey === 'sms.claimRaised');
    expect(sms?.message).toContain('the produce was damaged');
    expect(sms?.message).toContain('GHS 100.00');
    expect(listVoiceCallsForPhone(farmer.phone, 20).some((c) => c.flow === 'claim' && c.contractId === contractId)).toBe(true);
    expect(listClaimsForReview().find((c) => c.id === claim.id)?.reviewStatus).toBe('pending');
  });
});

describe('with a transport job', () => {
  it('the driver’s "arrived" delivers the order, and the buyer’s receipt pays the driver', async () => {
    const { contractId, driver, job } = await transportOrder();
    driverArrived(job.id, driver.id);
    expect(getJob(job.id).state).toBe('ARRIVED');
    const c = getContract(contractId);
    expect(c.state).toBe('DELIVERED');
    expect(c.receiptDueAt).toBeGreaterThan(Date.now());

    await confirmReceipt(contractId, { type: 'buyer', id: buyer().id });
    await landAll();
    expect(getJob(job.id).state).toBe('PAID');
    expect(getContract(contractId).state).toBe('SETTLED');
    expect(accountBalance(ACCOUNTS.driverPayable(driver.id))).toBe(job.quoteAmount);
    expect(jobEscrowBalance(job.id)).toBe(0);
    expect(contractEscrowBalance(contractId)).toBe(0);
  });

  it('a driver who arrives before the grade exists: the grade delivers the order', async () => {
    const { contractId, driver, job } = await transportOrder({ graded: false });
    driverArrived(job.id, driver.id);
    expect(getContract(contractId).state).toBe('PICKUP_CONFIRMED');
    await grade(contractId, 'B');
    expect(getContract(contractId).state).toBe('DELIVERED');
    expect(getContract(contractId).advanceAmount).toBe(ADVANCE);
  });

  it('a driver who arrives during a grade dispute: the final re-grade delivers the order', async () => {
    const { farmer, contractId, driver, job } = await transportOrder();
    disputeGrading(contractId, farmer.id);
    driverArrived(job.id, driver.id);
    expect(getContract(contractId).state).toBe('DISPUTED');

    scriptVerdict('B');
    await runGrading(contractId);
    await sweepSettlement();
    // The produce is at the buyer and graded: the 24 h receipt clock must be running.
    expect(getContract(contractId).state).toBe('DELIVERED');
  });

  it('a quality claim is not the driver’s doing: the driver is paid at once', async () => {
    const { contractId, driver, job } = await transportOrder();
    driverArrived(job.id, driver.id);
    fileClaim({ contractId, buyerId: buyer().id, reason: 'quality', deduction: 15_000 });
    await landAll();

    expect(getContract(contractId).state).toBe('CLAIMED');
    expect(getJob(job.id).state).toBe('PAID');
    expect(accountBalance(ACCOUNTS.driverPayable(driver.id))).toBe(job.quoteAmount);
    expect(jobEscrowBalance(job.id)).toBe(0);
  });

  it('a not_delivered claim keeps the driver’s pay waiting until F2M resolves it', async () => {
    const { farmer, contractId, driver, job } = await transportOrder();
    driverArrived(job.id, driver.id);
    const claim = fileClaim({ contractId, buyerId: buyer().id, reason: 'not_delivered', deduction: 40_000 });
    await answerClaim(claim.id, farmer.id, false);
    await landAll();

    expect(getJob(job.id).state).toBe('ARRIVED');
    expect(accountBalance(ACCOUNTS.driverPayable(driver.id))).toBe(0);
    expect(jobEscrowBalance(job.id)).toBe(job.quoteAmount);

    await resolveClaim(claim.id, { deduction: 0, note: 'it did arrive', reviewer: 'test' });
    await landAll();
    expect(getJob(job.id).state).toBe('PAID');
    expect(accountBalance(ACCOUNTS.driverPayable(driver.id))).toBe(job.quoteAmount);
    expect(getContract(contractId).state).toBe('SETTLED');
    expect(farmerGot(farmer.id)).toBe(TOTAL);
    expect(jobEscrowBalance(job.id)).toBe(0);
    expect(contractEscrowBalance(contractId)).toBe(0);
    expect(allJournalsBalanced()).toBe(true);
  });

  it('an accepted damaged claim settles the farmer’s side, but the driver waits for F2M’s review', async () => {
    const { farmer, contractId, driver, job } = await transportOrder();
    driverArrived(job.id, driver.id);
    const claim = fileClaim({ contractId, buyerId: buyer().id, reason: 'damaged', deduction: 30_000 });
    await answerClaim(claim.id, farmer.id, true);
    await landAll();
    expect(getContract(contractId).state).toBe('SETTLED');
    expect(getJob(job.id).state).toBe('ARRIVED'); // the transport itself is in question
    expect(accountBalance(ACCOUNTS.driverPayable(driver.id))).toBe(0);

    await resolveClaim(claim.id, { note: 'damage happened at the farm, not on the road', reviewer: 'test' });
    await landAll();
    expect(getJob(job.id).state).toBe('PAID');
    expect(accountBalance(ACCOUNTS.driverPayable(driver.id))).toBe(job.quoteAmount);
    expect(allJournalsBalanced()).toBe(true);
  });
});

describe('what is still held', () => {
  it('is nothing once an order has settled, even with a deduction', async () => {
    const { contractId, farmer } = await deliveredOrder();
    const claim = fileClaim({ contractId, buyerId: buyer().id, reason: 'short_weight', deduction: 10_000 });
    await answerClaim(claim.id, farmer.id, true);
    await landAll();
    expect(getContract(contractId).state).toBe('SETTLED');
    expect(stillHeld(getContract(contractId))).toBe(0);
  });
});
