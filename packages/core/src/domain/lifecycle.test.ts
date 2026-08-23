import { and, eq, inArray } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../db/client';
import { demands, lots } from '../db/schema';
import { setGradingProvider } from '../providers/grading/index';
import { MockPaymentProvider, setPaymentProvider } from '../providers/payment/index';
import { verifyBuyerLogin } from './buyers';
import { getContract, listContractsForFarmer } from './contracts';
import { createDemand, getDemand } from './demands';
import { registerFarmer } from './farmers';
import { agreeGrading, confirmPickup, disputeGrading, runGrading } from './gradingFlow';
import { allJournalsBalanced, contractEscrowBalance } from './ledger';
import { getLot, registerLot } from './lots';
import { expireDemands } from './matching';
import { acceptOfferAndHold, pollPaymentsOnce, refundMissedPickups } from './paymentFlow';
import { addPhoto } from './photos';
import { getCommodityByCode } from './registries';
import { getTrace } from './trace';

const DAY = 24 * 60 * 60 * 1000;

beforeAll(() => {
  setPaymentProvider(new MockPaymentProvider(0));
});
afterAll(() => {
  setPaymentProvider(null);
  setGradingProvider(null);
});

function isolateYamLane(): void {
  const yam = getCommodityByCode('YAM');
  db.update(demands)
    .set({ status: 'cancelled' })
    .where(and(eq(demands.commodityId, yam.id), inArray(demands.status, ['open', 'partially_matched'])))
    .run();
  db.update(lots)
    .set({ status: 'withdrawn' })
    .where(and(eq(lots.commodityId, yam.id), eq(lots.status, 'registered')))
    .run();
}

describe('lifecycle sweeps (M8)', () => {
  it('expires demands whose delivery window closed', () => {
    const buyer = verifyBuyerLogin('buyer@demo.ftm', 'demo-buyer-2026');
    const now = Date.now();
    const demand = createDemand({
      buyerId: buyer.id,
      commodityCode: 'TOMATO',
      quantityKg: 999, // nothing this large exists — stays open
      minBand: 'B',
      basePricePerKg: 300,
      windowStart: now,
      windowEnd: now + DAY,
      regionCode: 'BONO',
    });
    expect(getDemand(demand.id).status).toBe('open');

    const expired = expireDemands(now + 2 * DAY);
    expect(expired).toBeGreaterThanOrEqual(1);
    expect(getDemand(demand.id).status).toBe('expired');
  });

  it('refunds a funded contract whose pickup window passed with a day of grace', async () => {
    isolateYamLane();
    const buyer = verifyBuyerLogin('buyer@demo.ftm', 'demo-buyer-2026');
    const farmer = registerFarmer({ phone: '0291000111', name: 'Missed Pickup', regionCode: 'OTI' });
    const lot = registerLot({ farmerId: farmer.id, commodityCode: 'YAM', unitCode: 'HUNDRED', unitQty: 2, declaredBand: 'B' });
    const now = Date.now();
    const demand = createDemand({
      buyerId: buyer.id,
      commodityCode: 'YAM',
      quantityKg: 500,
      minBand: 'B',
      basePricePerKg: 400,
      windowStart: now,
      windowEnd: now + 3 * DAY,
      regionCode: 'OTI',
    });
    const offer = listContractsForFarmer(farmer.id, ['OFFERED']).find((c) => c.demandId === demand.id)!;
    await acceptOfferAndHold(offer.id, farmer.id);
    await pollPaymentsOnce();
    expect(getContract(offer.id).state).toBe('FUNDS_HELD');

    // Inside window + grace: nothing happens.
    expect(refundMissedPickups(now + 3 * DAY + 12 * 60 * 60 * 1000)).toBe(0);
    // Past window + grace: full refund, produce back on the market.
    expect(refundMissedPickups(now + 4 * DAY + 60_000)).toBe(1);

    const contract = getContract(offer.id);
    expect(contract.state).toBe('CANCELLED_REFUNDED');
    expect(contractEscrowBalance(contract.id)).toBe(0);
    expect(allJournalsBalanced()).toBe(true);
    expect(getLot(lot.id).remainingKg).toBe(500);
    expect(getLot(lot.id).status).toBe('registered');
  });

  it('emits PAYMENT_RELEASED and DISPUTE_RESOLVED in the trace', async () => {
    isolateYamLane();
    const buyer = verifyBuyerLogin('buyer@demo.ftm', 'demo-buyer-2026');
    const farmer = registerFarmer({ phone: '0291000222', name: 'Trace Events', regionCode: 'CENTRAL' });
    const lot = registerLot({ farmerId: farmer.id, commodityCode: 'YAM', unitCode: 'HUNDRED', unitQty: 2, declaredBand: 'B' });
    createDemand({
      buyerId: buyer.id,
      commodityCode: 'YAM',
      quantityKg: 500,
      minBand: 'B',
      basePricePerKg: 400,
      windowStart: Date.now(),
      windowEnd: Date.now() + 7 * DAY,
      regionCode: 'CENTRAL',
    });
    const offer = listContractsForFarmer(farmer.id, ['OFFERED'])[0]!;
    await acceptOfferAndHold(offer.id, farmer.id);
    await pollPaymentsOnce();
    confirmPickup(offer.id, { type: 'farmer', id: farmer.id });
    const buffer = await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 180, g: 140, b: 80 } } })
      .jpeg()
      .toBuffer();
    await addPhoto({ contractId: offer.id, buffer, actor: { type: 'buyer', id: buyer.id } });

    const verdicts = ['C', 'B'];
    setGradingProvider({
      name: 'mock',
      grade: async () => ({
        gradeBand: verdicts.shift()!,
        confidence: 0.8,
        reasons: [{ criterion: 'rot', observation: 'scripted', bandForCriterion: 'B' }],
        provider: 'mock',
      }),
    });

    await runGrading(offer.id); // C
    disputeGrading(offer.id, farmer.id, 'fresh this morning');
    await runGrading(offer.id); // re-grade → B, final
    await agreeGrading(offer.id, farmer.id);
    await pollPaymentsOnce();

    expect(getContract(offer.id).state).toBe('SETTLED');
    const types = getTrace(lot.id).map((e) => e.type);
    expect(types).toContain('DISPUTE_OPENED');
    expect(types).toContain('DISPUTE_RESOLVED');
    expect(types).toContain('PAYMENT_RELEASED');
    expect(types[types.length - 1]).toBe('SETTLED');
  });
});
