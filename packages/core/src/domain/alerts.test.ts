import { afterEach, describe, expect, it } from 'vitest';
import { config } from '../config';
import { acceptFor, testBuyer } from '../testing/fixtures';
import { alertOnNewLot, alertOnNewRequest, createWatch, deleteWatch, listWatches, sweepAlerts } from './alerts';
import { listBuyerNotifications } from './buyerNotifications';
import { registerBuyer } from './buyers';
import { createDemand } from './demands';
import { registerFarmer } from './farmers';
import { registerLot, withdrawLot } from './lots';
import { listNotificationsForPhone } from './notifications';
import { recordPrice } from './priceIntel';
import { getCommodityByCode } from './registries';

const DAY = 24 * 60 * 60 * 1000;
const crop = (code: string) => getCommodityByCode(code).id;
const smsTo = (phone: string) => listNotificationsForPhone(phone, 50);
const noteFor = (buyerId: string) => listBuyerNotifications(buyerId, 50);

const watcher = (n: number) => registerBuyer({ phone: `+23355600${n}0${n}0`, name: `Watcher ${n}`, regionCode: 'GREATER_ACCRA' });

afterEach(() => {
  config.ALERT_SMS_PER_FARMER_PER_DAY = 2;
  config.ALERT_MAX_RECIPIENTS = 8;
});

describe('watches', () => {
  it('asking again for the same thing changes its line instead of doubling it', () => {
    const b = watcher(1);
    const a = createWatch({ role: 'buyer', ownerId: b.id, commodityCode: 'ONION', kind: 'listing', thresholdPerKg: 700 });
    const again = createWatch({ role: 'buyer', ownerId: b.id, commodityCode: 'ONION', kind: 'listing', thresholdPerKg: 650 });
    expect(again.id).toBe(a.id);
    expect(listWatches('buyer', b.id)).toHaveLength(1);
    expect(listWatches('buyer', b.id)[0]!.thresholdPerKg).toBe(650);
  });
  it('only the owner can remove one, and a nonsense price is refused', () => {
    const b = watcher(2);
    const w = createWatch({ role: 'buyer', ownerId: b.id, commodityCode: 'ONION', kind: 'price_above', thresholdPerKg: 900 });
    expect(() => deleteWatch(w.id, 'buyer', 'someone-else')).toThrow();
    deleteWatch(w.id, 'buyer', b.id);
    expect(listWatches('buyer', b.id)).toHaveLength(0);
    expect(() => createWatch({ role: 'buyer', ownerId: b.id, commodityCode: 'ONION', kind: 'listing', thresholdPerKg: 0 })).toThrow();
  });
});

describe('a new listing reaches the buyers it matters to', () => {
  it('tells a watching buyer once, and only when the price is at or under their line', () => {
    const b = watcher(3);
    createWatch({ role: 'buyer', ownerId: b.id, commodityCode: 'ONION', kind: 'listing', thresholdPerKg: 700 });
    const farmer = registerFarmer({ phone: '+233207560001', name: 'Onion Farmer', regionCode: 'UPPER_EAST' });

    // GHS 400 for a 50 kg bag = 800 pesewas/kg: over their 700 line — silent.
    const dear = registerLot({ farmerId: farmer.id, commodityCode: 'ONION', unitCode: 'BAG_50KG', unitQty: 5, declaredBand: 'B', askingPricePerUnit: 40_000 });
    expect(noteFor(b.id).filter((n) => n.lotId === dear.id)).toHaveLength(0);

    // GHS 300 for 50 kg = 600/kg: under it.
    const cheap = registerLot({ farmerId: farmer.id, commodityCode: 'ONION', unitCode: 'BAG_50KG', unitQty: 5, declaredBand: 'B', askingPricePerUnit: 30_000 });
    const got = noteFor(b.id).filter((n) => n.lotId === cheap.id);
    expect(got).toHaveLength(1);
    expect(got[0]!.message).toContain('Onion');
    expect(got[0]!.message).toContain('You asked to hear about this crop.');

    // Running it again never repeats it.
    expect(alertOnNewLot(cheap.id)).toBe(0);
    expect(noteFor(b.id).filter((n) => n.lotId === cheap.id)).toHaveLength(1);
  });

  it('does not alert a buyer the engine already bid for', async () => {
    const buyer = testBuyer();
    const now = Date.now();
    createDemand({ buyerId: buyer.id, commodityCode: 'CASSAVA', quantityKg: 90, minBand: 'B', basePricePerKg: 400, windowStart: now, windowEnd: now + 1.5 * DAY, regionCode: 'ASHANTI' });
    const farmer = registerFarmer({ phone: '+233207560002', name: 'Cassava Farmer', regionCode: 'ASHANTI' });
    const lot = registerLot({ farmerId: farmer.id, commodityCode: 'CASSAVA', unitCode: 'SACK', unitQty: 1, declaredBand: 'B' });
    // The engine bids on the open request; that bid is the buyer's news, so no second message.
    expect(noteFor(buyer.id).filter((n) => n.lotId === lot.id && n.message.includes('You asked'))).toHaveLength(0);
    expect(noteFor(buyer.id).filter((n) => n.lotId === lot.id && n.message.includes('fits your open request'))).toHaveLength(0);
  });

  it('reaches a repeat buyer, and says why', async () => {
    const buyer = testBuyer();
    const now = Date.now();
    createDemand({ buyerId: buyer.id, commodityCode: 'MILLET', quantityKg: 100, minBand: 'B', basePricePerKg: 700, windowStart: now, windowEnd: now + 5 * DAY, regionCode: 'NORTHERN' });
    const first = registerFarmer({ phone: '+233207560003', name: 'First Millet Farmer', regionCode: 'NORTHERN' });
    const firstLot = registerLot({ farmerId: first.id, commodityCode: 'MILLET', unitCode: 'BAG_100KG', unitQty: 1, declaredBand: 'B' });
    await acceptFor(first.id, firstLot.id); // the buyer has now bought millet

    const second = registerFarmer({ phone: '+233207560004', name: 'Second Millet Farmer', regionCode: 'NORTHERN' });
    const lot = registerLot({ farmerId: second.id, commodityCode: 'MILLET', unitCode: 'BAG_100KG', unitQty: 3, declaredBand: 'A', community: 'Garu' });
    const got = noteFor(buyer.id).filter((n) => n.lotId === lot.id);
    expect(got.length).toBeGreaterThanOrEqual(1);
    expect(got.some((n) => n.message.includes('Garu'))).toBe(true);
  });

  it('stops at the configured number of people', () => {
    config.ALERT_MAX_RECIPIENTS = 2;
    const farmer = registerFarmer({ phone: '+233207560005', name: 'Pepper Farmer', regionCode: 'ASHANTI' });
    const ws = [4, 5, 6].map((n) => watcher(n));
    for (const b of ws) createWatch({ role: 'buyer', ownerId: b.id, commodityCode: 'PEPPER', kind: 'listing', thresholdPerKg: 5000 });
    const lot = registerLot({ farmerId: farmer.id, commodityCode: 'PEPPER', unitCode: 'SACK', unitQty: 2, declaredBand: 'B' });
    const told = ws.filter((b) => noteFor(b.id).some((n) => n.lotId === lot.id));
    expect(told).toHaveLength(2);
  });
});

describe('a new buyer request reaches farmers who could supply it', () => {
  const request = (code: string, region = 'ASHANTI') => {
    const now = Date.now();
    return createDemand({ buyerId: testBuyer().id, commodityCode: code, quantityKg: 500, minBand: 'B', basePricePerKg: 450, windowStart: now, windowEnd: now + 1.5 * DAY, regionCode: region });
  };

  it('texts a farmer who has sold the crop before but has nothing listed now', () => {
    const past = registerFarmer({ phone: '+233207570001', name: 'Past Sorghum Farmer', regionCode: 'ASHANTI', locale: 'en' });
    const lot = registerLot({ farmerId: past.id, commodityCode: 'SORGHUM', unitCode: 'BAG_100KG', unitQty: 1, declaredBand: 'B' });
    withdrawLot(lot.id, past.id);
    const demand = request('SORGHUM');
    const got = smsTo(past.phone).filter((n) => n.templateKey === 'sms.requestNearby');
    expect(got).toHaveLength(1);
    expect(got[0]!.message).toContain('500kg');
    expect(got[0]!.message).toContain('Sorghum');
    expect(alertOnNewRequest(demand.id)).toBe(0); // never twice for the same request
  });

  it('does not text a farmer who already has it listed — the engine bid for her', () => {
    const listed = registerFarmer({ phone: '+233207570002', name: 'Listed Soya Farmer', regionCode: 'ASHANTI' });
    registerLot({ farmerId: listed.id, commodityCode: 'SOYBEAN', unitCode: 'BAG_100KG', unitQty: 2, declaredBand: 'B' });
    request('SOYBEAN');
    expect(smsTo(listed.phone).filter((n) => n.templateKey === 'sms.requestNearby')).toHaveLength(0);
  });

  it('does not text a farmer too far away to be worth the haul', () => {
    const far = registerFarmer({ phone: '+233207570003', name: 'Far Tomato Farmer', regionCode: 'UPPER_EAST' });
    const lot = registerLot({ farmerId: far.id, commodityCode: 'TOMATO', unitCode: 'CRATE', unitQty: 1, declaredBand: 'B' });
    withdrawLot(lot.id, far.id);
    request('TOMATO', 'WESTERN'); // tomatoes spoil: the reach is short
    expect(smsTo(far.phone).filter((n) => n.templateKey === 'sms.requestNearby')).toHaveLength(0);
  });

  it('never texts one farmer more than the daily limit', () => {
    config.ALERT_SMS_PER_FARMER_PER_DAY = 2;
    const farmer = registerFarmer({ phone: '+233207570004', name: 'Busy Cowpea Farmer', regionCode: 'ASHANTI' });
    const lot = registerLot({ farmerId: farmer.id, commodityCode: 'COWPEA', unitCode: 'BAG_100KG', unitQty: 1, declaredBand: 'B' });
    withdrawLot(lot.id, farmer.id);
    request('COWPEA');
    request('COWPEA');
    request('COWPEA');
    expect(smsTo(farmer.phone).filter((n) => n.templateKey === 'sms.requestNearby')).toHaveLength(2);
  });
});

describe('the market moves', () => {
  it('tells a watching buyer when the price crosses their line, then leaves it alone for a week', () => {
    const b = watcher(7);
    const c = crop('PLANTAIN');
    createWatch({ role: 'buyer', ownerId: b.id, commodityCode: 'PLANTAIN', kind: 'price_above', thresholdPerKg: 450 });
    createWatch({ role: 'buyer', ownerId: b.id, commodityCode: 'PLANTAIN', kind: 'price_below', thresholdPerKg: 100 });
    const now = Date.now();
    for (let i = 0; i < 6; i += 1) recordPrice({ commodityId: c, pricePerKg: 500 + i, source: 'deal', refId: `alert-pl-${i}`, observedAt: now - (i + 1) * DAY });

    const first = sweepAlerts(now);
    expect(first.watches).toBe(1); // the "above 450" line, not the "below 100" one
    expect(noteFor(b.id).filter((n) => n.message.includes('above your line'))).toHaveLength(1);
    expect(sweepAlerts(now).watches).toBe(0); // not again
    expect(sweepAlerts(now + 2 * DAY).watches).toBe(0); // nor on the days after: once crossed, a line is left alone for a week
    expect(sweepAlerts(now + 8 * DAY).watches).toBe(1); // and may speak again after that, if it is still crossed
  });

  it('stays quiet on thin evidence', () => {
    const b = watcher(8);
    createWatch({ role: 'buyer', ownerId: b.id, commodityCode: 'RICE', kind: 'price_above', thresholdPerKg: 100 });
    // Only a seed placeholder exists for rice: not enough to alert anyone on.
    sweepAlerts(Date.now());
    expect(noteFor(b.id)).toHaveLength(0);
  });

  it('tells sellers and buyers when a crop moves sharply', () => {
    const c = crop('GROUNDNUT');
    const now = Date.now();
    for (let i = 0; i < 3; i += 1) recordPrice({ commodityId: c, pricePerKg: 1000, source: 'deal', refId: `gn-prev-${i}`, observedAt: now - (16 + i) * DAY });
    for (let i = 0; i < 3; i += 1) recordPrice({ commodityId: c, pricePerKg: 1250, source: 'deal', refId: `gn-cur-${i}`, observedAt: now - (2 + i) * DAY });

    const seller = registerFarmer({ phone: '+233207580001', name: 'Groundnut Seller', regionCode: 'NORTHERN' });
    registerLot({ farmerId: seller.id, commodityCode: 'GROUNDNUT', unitCode: 'BAG_50KG', unitQty: 4, declaredBand: 'B' });
    const asker = watcher(9);
    createDemand({ buyerId: asker.id, commodityCode: 'GROUNDNUT', quantityKg: 5000, minBand: 'B', basePricePerKg: 900, windowStart: now, windowEnd: now + 6 * DAY, regionCode: 'GREATER_ACCRA' });

    const result = sweepAlerts(now);
    expect(result.moves).toBeGreaterThanOrEqual(2);
    expect(smsTo(seller.phone).some((n) => n.templateKey === 'sms.priceUp')).toBe(true);
    expect(noteFor(asker.id).some((n) => n.templateKey === 'notif.priceUp')).toBe(true);
    expect(sweepAlerts(now).moves).toBe(0); // announced once for the week
  });
});
