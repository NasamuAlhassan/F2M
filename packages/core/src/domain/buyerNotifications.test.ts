import bcrypt from 'bcryptjs';
import { and, eq, inArray } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../db/client';
import { buyers, demands, drivers as driversTable, lots } from '../db/schema';
import { setGradingProvider } from '../providers/grading/index';
import { MockPaymentProvider, setPaymentProvider } from '../providers/payment/index';
import { listBuyerNotifications, markNotificationsRead, unreadNotificationCount } from './buyerNotifications';
import { verifyBuyerLogin } from './buyers';
import { listContractsForFarmer } from './contracts';
import { createDemand } from './demands';
import { registerDriver } from './drivers';
import { registerFarmer } from './farmers';
import { agreeGrading, confirmPickup, runGrading } from './gradingFlow';
import { acceptJob, confirmJobDelivery, confirmJobPickup, requestTransport } from './logistics';
import { registerLot } from './lots';
import { acceptOfferAndHold, pollPaymentsOnce } from './paymentFlow';
import { addPhoto } from './photos';
import { getCommodityByCode } from './registries';

const DAY = 24 * 60 * 60 * 1000;

beforeAll(() => {
  setPaymentProvider(new MockPaymentProvider(0));
  setGradingProvider({
    name: 'mock',
    grade: async () => ({
      gradeBand: 'B',
      confidence: 0.9,
      reasons: [{ criterion: 'rot', observation: 'clean tubers', bandForCriterion: 'B' }],
      provider: 'mock',
    }),
  });
});
afterAll(() => {
  setPaymentProvider(null);
  setGradingProvider(null);
});

describe('buyer notification center (M15)', () => {
  it('fans out through the whole journey: accept, funds, driver, transit, grade, delivery, settle', async () => {
    const yam = getCommodityByCode('YAM');
    db.update(demands)
      .set({ status: 'cancelled' })
      .where(and(eq(demands.commodityId, yam.id), inArray(demands.status, ['open', 'partially_matched'])))
      .run();
    db.update(lots)
      .set({ status: 'withdrawn' })
      .where(and(eq(lots.commodityId, yam.id), eq(lots.status, 'registered')))
      .run();
    db.update(driversTable).set({ active: false }).run();

    const buyer = verifyBuyerLogin('buyer@demo.ftm', 'demo-buyer-2026');

    const farmer = registerFarmer({ phone: '+233209334455', name: 'Notif Farmer', regionCode: 'BONO_EAST' });
    registerLot({ farmerId: farmer.id, commodityCode: 'YAM', unitCode: 'HUNDRED', unitQty: 2, declaredBand: 'B' });
    const driver = registerDriver({
      phone: '+233549334455',
      name: 'Notif Driver',
      regionCode: 'BONO_EAST',
      vehicleClassCode: 'van',
      pin: '2468',
    });
    void driver;
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
    await acceptOfferAndHold(offer.id, farmer.id); // → notif.offerAccepted
    await pollPaymentsOnce(); // → notif.fundsHeld

    const job = requestTransport(offer.id, buyer.id);
    await acceptJob(job.id, driver.id); // → notif.driverAssigned
    await pollPaymentsOnce(); // job FUNDS_HELD (no buyer notif — their own fee)
    confirmJobPickup(job.id, driver.id); // → notif.inTransit (+ contract PICKUP_CONFIRMED)

    const photo = await sharp({ create: { width: 300, height: 200, channels: 3, background: { r: 160, g: 120, b: 60 } } })
      .jpeg()
      .toBuffer();
    await addPhoto({ contractId: offer.id, buffer: photo, actor: { type: 'buyer', id: buyer.id } });
    await runGrading(offer.id); // → notif.graded
    await confirmJobDelivery(job.id, buyer.id);
    await agreeGrading(offer.id, farmer.id);
    await pollPaymentsOnce(); // → notif.settled + notif.driverPaid

    const keys = listBuyerNotifications(buyer.id, 100).map((n) => n.templateKey);
    for (const expected of [
      'notif.offerAccepted',
      'notif.fundsHeld',
      'notif.driverAssigned',
      'notif.inTransit',
      'notif.graded',
      'notif.settled',
      'notif.driverPaid',
    ]) {
      expect(keys).toContain(expected);
    }
    const graded = listBuyerNotifications(buyer.id, 100).find((n) => n.templateKey === 'notif.graded')!;
    expect(graded.message).toContain('Graded B');
    expect(graded.message).toContain('clean tubers');
  });

  it('scopes unread counts and mark-read to the owning buyer', () => {
    const buyer = verifyBuyerLogin('buyer@demo.ftm', 'demo-buyer-2026');
    expect(unreadNotificationCount(buyer.id)).toBeGreaterThan(0);

    const other = db
      .insert(buyers)
      .values({
        email: 'other@demo.ftm',
        passwordHash: bcrypt.hashSync('x', 4),
        name: 'Other Buyer',
        momoMsisdn: '233555000777',
        regionCode: 'ASHANTI',
      })
      .returning()
      .get();

    // The other buyer cannot clear the demo buyer's rows.
    expect(markNotificationsRead(other.id)).toBe(0);
    expect(unreadNotificationCount(buyer.id)).toBeGreaterThan(0);

    const cleared = markNotificationsRead(buyer.id);
    expect(cleared).toBeGreaterThan(0);
    expect(unreadNotificationCount(buyer.id)).toBe(0);
  });
});
