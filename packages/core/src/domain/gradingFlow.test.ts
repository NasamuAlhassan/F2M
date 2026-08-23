import { and, eq, inArray } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../db/client';
import { demands, lots } from '../db/schema';
import { MockPaymentProvider, setPaymentProvider } from '../providers/payment/index';
import { setGradingProvider, type GradingResult } from '../providers/grading/index';
import { verifyBuyerLogin } from './buyers';
import { getContract, listContractsForFarmer } from './contracts';
import { createDemand } from './demands';
import { registerFarmer } from './farmers';
import { agreeGrading, confirmPickup, disputeGrading, listGradingsForContract, runGrading } from './gradingFlow';
import { allJournalsBalanced, contractEscrowBalance } from './ledger';
import { getLot, registerLot } from './lots';
import { acceptOfferAndHold, pollPaymentsOnce } from './paymentFlow';
import { addPhoto, listPhotosForContract } from './photos';
import { getCommodityByCode } from './registries';
import { getTrace } from './trace';

const DAY = 24 * 60 * 60 * 1000;

/** A grading provider whose next verdicts are scripted. */
const verdicts: GradingResult[] = [];
function scriptVerdict(gradeBand: string, confidence = 0.9) {
  verdicts.push({
    gradeBand,
    confidence,
    reasons: [{ criterion: 'rot', observation: `scripted ${gradeBand} verdict`, bandForCriterion: gradeBand }],
    provider: 'mock',
  });
}

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

async function fundedContract(phone: string) {
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
  const farmer = registerFarmer({ phone, name: `Grade ${phone.slice(-4)}`, regionCode: 'GREATER_ACCRA' });
  const lot = registerLot({ farmerId: farmer.id, commodityCode: 'YAM', unitCode: 'HUNDRED', unitQty: 2, declaredBand: 'B' });
  createDemand({
    buyerId: buyer.id,
    commodityCode: 'YAM',
    quantityKg: 500,
    minBand: 'B',
    basePricePerKg: 400, // A=455, B=400, C=318
    windowStart: Date.now(),
    windowEnd: Date.now() + 14 * DAY,
    regionCode: 'GREATER_ACCRA',
  });
  const offer = listContractsForFarmer(farmer.id, ['OFFERED']).find((c) => c.buyerId === buyer.id)!;
  await acceptOfferAndHold(offer.id, farmer.id);
  await pollPaymentsOnce();
  expect(getContract(offer.id).state).toBe('FUNDS_HELD');
  return { farmer, lot, buyer, contractId: offer.id };
}

async function photoBuffer(color: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({ create: { width: 1400, height: 900, channels: 3, background: color } })
    .jpeg()
    .toBuffer();
}

describe('grading flow (M5)', () => {
  it('grades from pickup photos and settles on agree', async () => {
    const { farmer, lot, contractId } = await fundedContract('0281000111');

    confirmPickup(contractId, { type: 'farmer', id: farmer.id });
    expect(getContract(contractId).state).toBe('PICKUP_CONFIRMED');

    // Grading refuses to run blind.
    await expect(runGrading(contractId)).rejects.toThrow(/photo/);

    const photo = await addPhoto({
      contractId,
      buffer: await photoBuffer({ r: 200, g: 160, b: 60 }),
      actor: { type: 'buyer', id: 'test' },
    });
    expect(photo.bytes).toBeGreaterThan(0);
    expect(listPhotosForContract(contractId)).toHaveLength(1);

    scriptVerdict('B');
    const grading = await runGrading(contractId);
    expect(grading.status).toBe('completed');

    const contract = getContract(contractId);
    expect(contract.state).toBe('GRADED');
    expect(contract.finalGrade).toBe('B');
    expect(contract.finalAmount).toBe(500 * 400);

    const types = getTrace(lot.id).map((e) => e.type);
    expect(types).toContain('PHOTO_ADDED');
    expect(types).toContain('GRADED');

    // Farmer agrees on USSD -> release now, not after the window.
    await agreeGrading(contractId, farmer.id);
    await pollPaymentsOnce();
    expect(getContract(contractId).state).toBe('SETTLED');
    expect(contractEscrowBalance(contractId)).toBe(0);
    expect(allJournalsBalanced()).toBe(true);
  });

  it('re-grades once after a dispute, and the re-grade is final', async () => {
    const { farmer, contractId } = await fundedContract('0281000222');
    confirmPickup(contractId, { type: 'farmer', id: farmer.id });
    await addPhoto({ contractId, buffer: await photoBuffer({ r: 120, g: 40, b: 30 }), actor: { type: 'buyer', id: 'test' } });

    scriptVerdict('C', 0.55);
    await runGrading(contractId);
    expect(getContract(contractId).finalGrade).toBe('C');

    disputeGrading(contractId, farmer.id, 'the tubers were fresh this morning');
    expect(getContract(contractId).state).toBe('DISPUTED');

    scriptVerdict('B', 0.85);
    await runGrading(contractId);
    const contract = getContract(contractId);
    expect(contract.state).toBe('GRADED');
    expect(contract.finalGrade).toBe('B');
    expect(contract.finalAmount).toBe(500 * 400);

    const history = listGradingsForContract(contractId);
    expect(history).toHaveLength(2);
    expect(history.find((g) => g.attempt === 1)?.status).toBe('resolved');
    // Both attempts pinned the same rubric version.
    expect(new Set(history.map((g) => g.rubricId)).size).toBe(1);

    expect(() => disputeGrading(contractId, farmer.id)).toThrow(/final/);
  });

  it('refunds the buyer outright on a REJECT grade', async () => {
    const { farmer, lot, contractId } = await fundedContract('0281000333');
    confirmPickup(contractId, { type: 'farmer', id: farmer.id });
    await addPhoto({ contractId, buffer: await photoBuffer({ r: 30, g: 30, b: 30 }), actor: { type: 'buyer', id: 'test' } });

    scriptVerdict('REJECT', 0.95);
    await runGrading(contractId);

    const contract = getContract(contractId);
    expect(contract.state).toBe('CANCELLED_REFUNDED');
    expect(contract.finalAmount).toBe(0);
    expect(contractEscrowBalance(contractId)).toBe(0); // hold fully refunded
    expect(allJournalsBalanced()).toBe(true);
    expect(getLot(lot.id).status).toBe('registered'); // produce back on the market
  });
});
