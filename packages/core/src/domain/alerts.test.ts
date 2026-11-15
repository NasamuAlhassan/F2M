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
  it('asking again for the same thing changes its line instead of doubling it', async () => {
    const b = await watcher(1);
    const a = await createWatch({ role: 'buyer', ownerId: b.id, commodityCode: 'ONION', kind: 'listing', thresholdPerKg: 700 });
    const again = await createWatch({ role: 'buyer', ownerId: b.id, commodityCode: 'ONION', kind: 'listing', thresholdPerKg: 650 });
    expect(again.id).toBe(a.id);
    expect(await listWatches('buyer', b.id)).toHaveLength(1);
    expect((await listWatches('buyer', b.id))[0]!.thresholdPerKg).toBe(650);
  });
  it('only the owner can remove one, and a nonsense price is refused', async () => {
    const b = await watcher(2);
    const w = await createWatch({ role: 'buyer', ownerId: b.id, commodityCode: 'ONION', kind: 'price_above', thresholdPerKg: 900 });
    await expect((() => deleteWatch(w.id, 'buyer', 'someone-else'))()).rejects.toThrow();
    await deleteWatch(w.id, 'buyer', b.id);
    expect(await listWatches('buyer', b.id)).toHaveLength(0);
    await expect((() => createWatch({ role: 'buyer', ownerId: b.id, commodityCode: 'ONION', kind: 'listing', thresholdPerKg: 0 }))()).rejects.toThrow();
  });
});

describe('a new listing reaches the buyers it matters to', () => {
  it('tells a watching buyer once, and only when the price is at or under their line', async () => {
    const b = await watcher(3);
    await createWatch({ role: 'buyer', ownerId: b.id, commodityCode: 'ONION', kind: 'listing', thresholdPerKg: 700 });
    const farmer = await registerFarmer({ phone: '+233207560001', name: 'Onion Farmer', regionCode: 'UPPER_EAST' });

    // GHS 400 for a 50 kg bag = 800 pesewas/kg: over their 700 line — silent.
    const dear = await registerLot({ farmerId: farmer.id, commodityCode: 'ONION', unitCode: 'BAG_50KG', unitQty: 5, declaredBand: 'B', askingPricePerUnit: 40_000 });
    expect((await noteFor(b.id)).filter((n) => n.lotId === dear.id)).toHaveLength(0);

    // GHS 300 for 50 kg = 600/kg: under it.
    const cheap = await registerLot({ farmerId: farmer.id, commodityCode: 'ONION', unitCode: 'BAG_50KG', unitQty: 5, declaredBand: 'B', askingPricePerUnit: 30_000 });
    const got = (await noteFor(b.id)).filter((n) => n.lotId === cheap.id);
    expect(got).toHaveLength(1);
    expect(got[0]!.message).toContain('Onion');
    expect(got[0]!.message).toContain('You asked to hear about this crop.');

    // Running it again never repeats it.
    expect(await alertOnNewLot(cheap.id)).toBe(0);
    expect((await noteFor(b.id)).filter((n) => n.lotId === cheap.id)).toHaveLength(1);
  });

  it('does not alert a buyer the engine already bid for', async () => {
    const buyer = await testBuyer();
    const now = Date.now();
    await createDemand({ buyerId: buyer.id, commodityCode: 'CASSAVA', quantityKg: 90, minBand: 'B', basePricePerKg: 400, windowStart: now, windowEnd: now + 1.5 * DAY, regionCode: 'ASHANTI' });
    const farmer = await registerFarmer({ phone: '+233207560002', name: 'Cassava Farmer', regionCode: 'ASHANTI' });
    const lot = await registerLot({ farmerId: farmer.id, commodityCode: 'CASSAVA', unitCode: 'SACK', unitQty: 1, declaredBand: 'B' });
    // The engine bids on the open request; that bid is the buyer's news, so no second message.
    expect((await noteFor(buyer.id)).filter((n) => n.lotId === lot.id && n.message.includes('You asked'))).toHaveLength(0);
    expect((await noteFor(buyer.id)).filter((n) => n.lotId === lot.id && n.message.includes('fits your open request'))).toHaveLength(0);
  });

  it('reaches a repeat buyer, and says why', async () => {
    const buyer = await testBuyer();
    const now = Date.now();
    await createDemand({ buyerId: buyer.id, commodityCode: 'MILLET', quantityKg: 100, minBand: 'B', basePricePerKg: 700, windowStart: now, windowEnd: now + 5 * DAY, regionCode: 'NORTHERN' });
    const first = await registerFarmer({ phone: '+233207560003', name: 'First Millet Farmer', regionCode: 'NORTHERN' });
    const firstLot = await registerLot({ farmerId: first.id, commodityCode: 'MILLET', unitCode: 'BAG_100KG', unitQty: 1, declaredBand: 'B' });
    await acceptFor(first.id, firstLot.id); // the buyer has now bought millet

    const second = await registerFarmer({ phone: '+233207560004', name: 'Second Millet Farmer', regionCode: 'NORTHERN' });
    const lot = await registerLot({ farmerId: second.id, commodityCode: 'MILLET', unitCode: 'BAG_100KG', unitQty: 3, declaredBand: 'A', community: 'Garu' });
    const got = (await noteFor(buyer.id)).filter((n) => n.lotId === lot.id);
    expect(got.length).toBeGreaterThanOrEqual(1);
    expect(got.some((n) => n.message.includes('Garu'))).toBe(true);
  });

  it('stops at the configured number of people', async () => {
    config.ALERT_MAX_RECIPIENTS = 2;
    const farmer = await registerFarmer({ phone: '+233207560005', name: 'Pepper Farmer', regionCode: 'ASHANTI' });
    const ws = await Promise.all([4, 5, 6].map((n) => watcher(n)));
    for (const b of ws) await createWatch({ role: 'buyer', ownerId: b.id, commodityCode: 'PEPPER', kind: 'listing', thresholdPerKg: 5000 });
    const lot = await registerLot({ farmerId: farmer.id, commodityCode: 'PEPPER', unitCode: 'SACK', unitQty: 2, declaredBand: 'B' });
    const seen = await Promise.all(ws.map(async (b) => (await noteFor(b.id)).some((n) => n.lotId === lot.id)));
    const told = ws.filter((_, i) => seen[i]);
    expect(told).toHaveLength(2);
  });
});

describe('a new buyer request reaches farmers who could supply it', () => {
  const request = async (code: string, region = 'ASHANTI') => {
    const now = Date.now();
    return createDemand({ buyerId: (await testBuyer()).id, commodityCode: code, quantityKg: 500, minBand: 'B', basePricePerKg: 450, windowStart: now, windowEnd: now + 1.5 * DAY, regionCode: region });
  };

  it('texts a farmer who has sold the crop before but has nothing listed now', async () => {
    const past = await registerFarmer({ phone: '+233207570001', name: 'Past Sorghum Farmer', regionCode: 'ASHANTI', locale: 'en' });
    const lot = await registerLot({ farmerId: past.id, commodityCode: 'SORGHUM', unitCode: 'BAG_100KG', unitQty: 1, declaredBand: 'B' });
    await withdrawLot(lot.id, past.id);
    const demand = await request('SORGHUM');
    const got = (await smsTo(past.phone)).filter((n) => n.templateKey === 'sms.requestNearby');
    expect(got).toHaveLength(1);
    expect(got[0]!.message).toContain('500kg');
    expect(got[0]!.message).toContain('Sorghum');
    expect(await alertOnNewRequest(demand.id)).toBe(0); // never twice for the same request
  });

  it('does not text a farmer who already has it listed — the engine bid for her', async () => {
    const listed = await registerFarmer({ phone: '+233207570002', name: 'Listed Soya Farmer', regionCode: 'ASHANTI' });
    await registerLot({ farmerId: listed.id, commodityCode: 'SOYBEAN', unitCode: 'BAG_100KG', unitQty: 2, declaredBand: 'B' });
    await request('SOYBEAN');
    expect((await smsTo(listed.phone)).filter((n) => n.templateKey === 'sms.requestNearby')).toHaveLength(0);
  });

  it('does not text a farmer too far away to be worth the haul', async () => {
    const far = await registerFarmer({ phone: '+233207570003', name: 'Far Tomato Farmer', regionCode: 'UPPER_EAST' });
    const lot = await registerLot({ farmerId: far.id, commodityCode: 'TOMATO', unitCode: 'CRATE', unitQty: 1, declaredBand: 'B' });
    await withdrawLot(lot.id, far.id);
    await request('TOMATO', 'WESTERN'); // tomatoes spoil: the reach is short
    expect((await smsTo(far.phone)).filter((n) => n.templateKey === 'sms.requestNearby')).toHaveLength(0);
  });

  it('never texts one farmer more than the daily limit', async () => {
    config.ALERT_SMS_PER_FARMER_PER_DAY = 2;
    const farmer = await registerFarmer({ phone: '+233207570004', name: 'Busy Cowpea Farmer', regionCode: 'ASHANTI' });
    const lot = await registerLot({ farmerId: farmer.id, commodityCode: 'COWPEA', unitCode: 'BAG_100KG', unitQty: 1, declaredBand: 'B' });
    await withdrawLot(lot.id, farmer.id);
    await request('COWPEA');
    await request('COWPEA');
    await request('COWPEA');
    expect((await smsTo(farmer.phone)).filter((n) => n.templateKey === 'sms.requestNearby')).toHaveLength(2);
  });
});

describe('the market moves', () => {
  it('tells a watching buyer when the price crosses their line, then leaves it alone for a week', async () => {
    const b = await watcher(7);
    const c = crop('PLANTAIN');
    await createWatch({ role: 'buyer', ownerId: b.id, commodityCode: 'PLANTAIN', kind: 'price_above', thresholdPerKg: 450 });
    await createWatch({ role: 'buyer', ownerId: b.id, commodityCode: 'PLANTAIN', kind: 'price_below', thresholdPerKg: 100 });
    const now = Date.now();
    for (let i = 0; i < 6; i += 1) await recordPrice({ commodityId: c, pricePerKg: 500 + i, source: 'deal', refId: `alert-pl-${i}`, observedAt: now - (i + 1) * DAY });

    const first = await sweepAlerts(now);
    expect(first.watches).toBe(1); // the "above 450" line, not the "below 100" one
    expect((await noteFor(b.id)).filter((n) => n.message.includes('above your line'))).toHaveLength(1);
    expect((await sweepAlerts(now)).watches).toBe(0); // not again
    expect((await sweepAlerts(now + 2 * DAY)).watches).toBe(0); // nor on the days after: once crossed, a line is left alone for a week
    expect((await sweepAlerts(now + 8 * DAY)).watches).toBe(1); // and may speak again after that, if it is still crossed
  });

  it('stays quiet on thin evidence', async () => {
    const b = await watcher(8);
    await createWatch({ role: 'buyer', ownerId: b.id, commodityCode: 'RICE', kind: 'price_above', thresholdPerKg: 100 });
    // Only a seed placeholder exists for rice: not enough to alert anyone on.
    await sweepAlerts(Date.now());
    expect(await noteFor(b.id)).toHaveLength(0);
  });

  it('tells sellers and buyers when a crop moves sharply', async () => {
    const c = crop('GROUNDNUT');
    const now = Date.now();
    for (let i = 0; i < 3; i += 1) await recordPrice({ commodityId: c, pricePerKg: 1000, source: 'deal', refId: `gn-prev-${i}`, observedAt: now - (16 + i) * DAY });
    for (let i = 0; i < 3; i += 1) await recordPrice({ commodityId: c, pricePerKg: 1250, source: 'deal', refId: `gn-cur-${i}`, observedAt: now - (2 + i) * DAY });

    const seller = await registerFarmer({ phone: '+233207580001', name: 'Groundnut Seller', regionCode: 'NORTHERN' });
    await registerLot({ farmerId: seller.id, commodityCode: 'GROUNDNUT', unitCode: 'BAG_50KG', unitQty: 4, declaredBand: 'B' });
    const asker = await watcher(9);
    await createDemand({ buyerId: asker.id, commodityCode: 'GROUNDNUT', quantityKg: 5000, minBand: 'B', basePricePerKg: 900, windowStart: now, windowEnd: now + 6 * DAY, regionCode: 'GREATER_ACCRA' });

    const result = await sweepAlerts(now);
    expect(result.moves).toBeGreaterThanOrEqual(2);
    expect((await smsTo(seller.phone)).some((n) => n.templateKey === 'sms.priceUp')).toBe(true);
    expect((await noteFor(asker.id)).some((n) => n.templateKey === 'notif.priceUp')).toBe(true);
    expect((await sweepAlerts(now)).moves).toBe(0); // announced once for the week
  });
});
