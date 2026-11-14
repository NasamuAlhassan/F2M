import { and, eq, inArray } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../db/client';
import { demands, lots } from '../db/schema';
import { setGradingProvider } from '../providers/grading/index';
import { MockNotifyProvider, setNotifyProvider } from '../providers/notify/index';
import { MockPaymentProvider, setPaymentProvider } from '../providers/payment/index';
import { acceptFor, openOfferFor, testBuyer } from '../testing/fixtures';
import { createDemand } from './demands';
import { registerFarmer } from './farmers';
import { agreeGrading, confirmPickup, runGrading } from './gradingFlow';
import { getLot, registerLot } from './lots';
import { listNotificationsForPhone, queueSms, sendPendingNotifications } from './notifications';
import { pollPaymentsOnce } from './paymentFlow';
import { addPhoto } from './photos';
import { getCommodityByCode } from './registries';
import { listVoiceCallsForPhone } from './voiceCalls';

const DAY = 24 * 60 * 60 * 1000;
const notifyMock = new MockNotifyProvider();

beforeAll(() => {
  setPaymentProvider(new MockPaymentProvider(0));
  setNotifyProvider(notifyMock);
});
afterAll(() => {
  setPaymentProvider(null);
  setNotifyProvider(null);
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

describe('SMS outbox (M11)', () => {
  it('texts the farmer at every step: offer, funding, grade, payout', async () => {
    isolateYamLane();
    const buyer = testBuyer();
    const farmer = registerFarmer({ phone: '0292000111', name: 'Sms Flow', regionCode: 'WESTERN' });
    const lot = registerLot({ farmerId: farmer.id, commodityCode: 'YAM', unitCode: 'HUNDRED', unitQty: 2, declaredBand: 'B' });
    createDemand({
      buyerId: buyer.id,
      commodityCode: 'YAM',
      quantityKg: 500,
      minBand: 'B',
      basePricePerKg: 400,
      windowStart: Date.now(),
      windowEnd: Date.now() + 7 * DAY,
      regionCode: 'WESTERN',
    });

    // Registration and the USSD listing each queued a receipt (M30), then the
    // engine's bid → sms.bidReceived with real figures (per unit, Phase 1), newest first.
    let inbox = listNotificationsForPhone(farmer.phone);
    expect(inbox).toHaveLength(3);
    expect(inbox.map((n) => n.templateKey)).toEqual(['sms.bidReceived', 'sms.lotListed', 'sms.registered']);
    expect(inbox[1]!.message).toContain('2 Hundred (100 tubers) of Yam');
    expect(inbox[2]!.message).toContain('Welcome Sms Flow!');
    expect(inbox[0]!.message).toContain('Accra Fresh Markets Ltd offers 2 Hundred (100 tubers) of your Yam at GHS 1000.00 each (GHS 2000.00)');
    expect(inbox[0]!.message).toContain('*384*7247#');
    expect(inbox[0]!.status).toBe('pending');
    // The bid also rings the farmer, so it can be answered by keypad.
    const call = listVoiceCallsForPhone(farmer.phone)[0]!;
    expect(call.flow).toBe('bid');
    expect(call.offerId).toBe(openOfferFor(farmer.id, lot.id)!.id);

    // The sweep delivers via the provider and marks it sent.
    const delivered = await sendPendingNotifications();
    expect(delivered).toBeGreaterThanOrEqual(1);
    expect(listNotificationsForPhone(farmer.phone)[0]!.status).toBe('sent');
    expect(notifyMock.sent.some((s) => s.phone === farmer.phone)).toBe(true);

    const order = await acceptFor(farmer.id, lot.id);
    await pollPaymentsOnce();
    inbox = listNotificationsForPhone(farmer.phone);
    // Accepting texts the deal, then funding texts the hold — the exact agreed total.
    // (Both can land in the same millisecond, so look them up by key.)
    const agreed = inbox.find((n) => n.templateKey === 'sms.offerAgreed')!;
    expect(agreed.message).toContain('2 Hundred (100 tubers) of Yam at GHS 1000.00 each, GHS 2000.00 in all');
    const funded = inbox.find((n) => n.templateKey === 'sms.funded')!;
    expect(funded.message).toContain('GHS 2000.00 is secured for your Yam');
    expect(inbox.slice(0, 2).map((n) => n.templateKey).sort()).toEqual(['sms.funded', 'sms.offerAgreed']);

    confirmPickup(order.id, { type: 'farmer', id: farmer.id });
    const buffer = await sharp({ create: { width: 300, height: 200, channels: 3, background: { r: 170, g: 130, b: 70 } } })
      .jpeg()
      .toBuffer();
    await addPhoto({ contractId: order.id, buffer, actor: { type: 'buyer', id: buyer.id } });
    setGradingProvider({
      name: 'mock',
      grade: async () => ({
        gradeBand: 'B',
        confidence: 0.9,
        reasons: [{ criterion: 'rot', observation: 'clean intact tubers', bandForCriterion: 'B' }],
        provider: 'mock',
      }),
    });
    await runGrading(order.id);
    inbox = listNotificationsForPhone(farmer.phone);
    expect(inbox[0]!.templateKey).toBe('sms.graded');
    expect(inbox[0]!.message).toContain('graded Grade B, pays GHS 2000.00');
    expect(inbox[0]!.message).toContain('Reason: clean intact tubers');

    await agreeGrading(order.id, farmer.id);
    await pollPaymentsOnce();
    inbox = listNotificationsForPhone(farmer.phone);
    expect(inbox[0]!.templateKey).toBe('sms.paid');
    expect(inbox[0]!.message).toContain('GHS 2000.00 has been sent to your MoMo');
  });

  it('texts the rejection honestly', async () => {
    isolateYamLane();
    const buyer = testBuyer();
    const farmer = registerFarmer({ phone: '0292000222', name: 'Sms Reject', regionCode: 'AHAFO' });
    const lot = registerLot({ farmerId: farmer.id, commodityCode: 'YAM', unitCode: 'HUNDRED', unitQty: 2, declaredBand: 'B' });
    createDemand({
      buyerId: buyer.id,
      commodityCode: 'YAM',
      quantityKg: 500,
      minBand: 'B',
      basePricePerKg: 400,
      windowStart: Date.now(),
      windowEnd: Date.now() + 7 * DAY,
      regionCode: 'AHAFO',
    });
    const order = await acceptFor(farmer.id, lot.id);
    await pollPaymentsOnce();
    confirmPickup(order.id, { type: 'farmer', id: farmer.id });
    const buffer = await sharp({ create: { width: 300, height: 200, channels: 3, background: { r: 40, g: 40, b: 40 } } })
      .jpeg()
      .toBuffer();
    await addPhoto({ contractId: order.id, buffer, actor: { type: 'buyer', id: buyer.id } });
    setGradingProvider({
      name: 'mock',
      grade: async () => ({
        gradeBand: 'REJECT',
        confidence: 0.95,
        reasons: [{ criterion: 'rot', observation: 'wet rot present', bandForCriterion: 'REJECT' }],
        provider: 'mock',
      }),
    });
    await runGrading(order.id);

    const inbox = listNotificationsForPhone(farmer.phone);
    expect(inbox[0]!.templateKey).toBe('sms.rejected');
    expect(inbox[0]!.message).toContain('rejected at grading: wet rot present');
    expect(inbox[0]!.message).toContain('listed again');
    expect(getLot(lot.id).status).toBe('registered');
  });

  it('records provider failures on the outbox row', async () => {
    setNotifyProvider({
      name: 'mock',
      send: async () => {
        throw new Error('network down');
      },
    });
    const n = queueSms({ phone: '+233240000123', locale: 'en', templateKey: 'sms.paid', params: { amount: 'GHS 1.00' } });
    await sendPendingNotifications();
    const failed = listNotificationsForPhone('+233240000123').find((x) => x.id === n.id)!;
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('network down');
    setNotifyProvider(notifyMock);
  });
});
