import { describe, expect, it } from 'vitest';
import { db } from '../db/client';
import { priceObservations } from '../db/schema';
import { getCommodityByCode } from './registries';
import {
  clearPriceCaches,
  estimatePrice,
  priceGuidance,
  priceSeries,
  priceTrend,
  recordPrice,
  seasonalOutlook,
  shouldPause,
  weightedQuantile,
} from './priceIntel';

const DAY = 24 * 60 * 60 * 1000;
// A "now" far enough ahead that the seed's reference prices are too old to count,
// so each test controls exactly the evidence it sees.
const NOW = Date.now() + 400 * DAY;

const crop = (code: string) => getCommodityByCode(code).id;
const ago = (days: number) => NOW - days * DAY;

describe('weightedQuantile', () => {
  it('is the plain median when weights are equal', () => {
    const items = [1, 2, 3, 4, 5].map((v) => ({ v, w: 1 }));
    expect(weightedQuantile(items, 0.5)).toBe(3);
  });
  it('is pulled toward the heavier values', () => {
    expect(weightedQuantile([{ v: 100, w: 1 }, { v: 200, w: 9 }], 0.5)).toBeGreaterThan(150);
  });
});

describe('recordPrice', () => {
  it('updates one row instead of adding another for the same thing seen again', () => {
    const c = crop('PLANTAIN');
    const first = recordPrice({ commodityId: c, pricePerKg: 300, source: 'ask', refId: 'lot-rec-1', observedAt: ago(1) });
    const again = recordPrice({ commodityId: c, pricePerKg: 340, source: 'ask', refId: 'lot-rec-1', observedAt: ago(0) });
    expect(again.id).toBe(first.id);
    expect(again.pricePerKg).toBe(340);
  });
  it('refuses a price that is not a price', () => {
    const c = crop('PLANTAIN');
    expect(() => recordPrice({ commodityId: c, pricePerKg: 0, source: 'deal' })).toThrow();
    expect(() => recordPrice({ commodityId: c, pricePerKg: 999_999, source: 'deal' })).toThrow();
  });
});

describe('estimatePrice', () => {
  it('has nothing to say when nothing recent exists', () => {
    expect(estimatePrice(crop('SORGHUM'), { now: NOW })).toBeNull();
  });

  it('follows recent deals, not a stale high quote', () => {
    const c = crop('MILLET');
    // A very old, very high survey quote and a run of recent deals around 700.
    recordPrice({ commodityId: c, pricePerKg: 1500, source: 'market', market: 'Tamale', refId: 'm-old', observedAt: ago(170) });
    for (let i = 0; i < 6; i += 1) {
      recordPrice({ commodityId: c, pricePerKg: 690 + i * 4, source: 'deal', refId: `m-deal-${i}`, observedAt: ago(i + 1) });
    }
    const e = estimatePrice(c, { now: NOW })!;
    expect(e.pricePerKg).toBeGreaterThan(650);
    expect(e.pricePerKg).toBeLessThan(760);
    expect(e.lowPerKg).toBeLessThan(e.pricePerKg);
    expect(e.highPerKg).toBeGreaterThan(e.pricePerKg);
  });

  it('ignores a stray extra zero', () => {
    const c = crop('COWPEA');
    for (let i = 0; i < 5; i += 1) recordPrice({ commodityId: c, pricePerKg: 1000, source: 'deal', refId: `c-${i}`, observedAt: ago(i + 1) });
    recordPrice({ commodityId: c, pricePerKg: 10_000, source: 'ask', refId: 'c-typo', observedAt: ago(1) });
    expect(estimatePrice(c, { now: NOW })!.pricePerKg).toBeLessThan(1100);
  });

  it('is high-confidence only with several fresh, solid observations', () => {
    const c = crop('CASSAVA');
    recordPrice({ commodityId: c, pricePerKg: 400, source: 'ask', refId: 'cs-1', observedAt: ago(2) });
    expect(estimatePrice(c, { now: NOW })!.confidence).toBe('low');
    for (let i = 0; i < 6; i += 1) recordPrice({ commodityId: c, pricePerKg: 400 + i, source: 'deal', refId: `cs-d${i}`, observedAt: ago(i) });
    expect(estimatePrice(c, { now: NOW })!.confidence).toBe('high');
  });

  it('labels itself a reference when only placeholders exist', () => {
    const c = crop('SOYBEAN');
    recordPrice({ commodityId: c, pricePerKg: 350, source: 'reference', refId: 'sb-ref', observedAt: ago(5) });
    const e = estimatePrice(c, { now: NOW })!;
    expect(e.confidence).toBe('reference');
  });

  it('lets the farmer’s own region count for more', () => {
    const c = crop('GROUNDNUT');
    for (let i = 0; i < 4; i += 1) {
      recordPrice({ commodityId: c, pricePerKg: 1000, source: 'deal', regionCode: 'NORTHERN', refId: `g-n${i}`, observedAt: ago(i + 1) });
      recordPrice({ commodityId: c, pricePerKg: 1400, source: 'deal', regionCode: 'GREATER_ACCRA', refId: `g-a${i}`, observedAt: ago(i + 1) });
    }
    const north = estimatePrice(c, { regionCode: 'NORTHERN', now: NOW })!;
    const accra = estimatePrice(c, { regionCode: 'GREATER_ACCRA', now: NOW })!;
    expect(north.pricePerKg).toBeLessThan(accra.pricePerKg);
    expect(north.scope).toBe('region');
  });
});

describe('priceTrend', () => {
  it('reports a rise as a rise', () => {
    const c = crop('ONION');
    for (let i = 0; i < 4; i += 1) recordPrice({ commodityId: c, pricePerKg: 600, source: 'deal', refId: `o-prev${i}`, observedAt: ago(40 + i) });
    for (let i = 0; i < 4; i += 1) recordPrice({ commodityId: c, pricePerKg: 720, source: 'deal', refId: `o-cur${i}`, observedAt: ago(5 + i) });
    const t = priceTrend(c, { now: NOW })!;
    expect(t.direction).toBe('rising');
    expect(t.change).toBeCloseTo(0.2, 1);
  });

  it('calls a small wobble steady', () => {
    const c = crop('PEPPER');
    for (let i = 0; i < 3; i += 1) recordPrice({ commodityId: c, pricePerKg: 800, source: 'deal', refId: `p-prev${i}`, observedAt: ago(40 + i) });
    for (let i = 0; i < 3; i += 1) recordPrice({ commodityId: c, pricePerKg: 810, source: 'deal', refId: `p-cur${i}`, observedAt: ago(5 + i) });
    expect(priceTrend(c, { now: NOW })!.direction).toBe('steady');
  });

  it('will not invent a trend from one quote', () => {
    const c = crop('RICE');
    recordPrice({ commodityId: c, pricePerKg: 900, source: 'deal', refId: 'r-1', observedAt: ago(3) });
    expect(priceTrend(c, { now: NOW })).toBeNull();
  });
});

describe('priceSeries', () => {
  it('gives one point per week that has data, oldest first', () => {
    const c = crop('YAM');
    recordPrice({ commodityId: c, pricePerKg: 300, source: 'deal', refId: 'y-1', observedAt: ago(50) });
    recordPrice({ commodityId: c, pricePerKg: 320, source: 'deal', refId: 'y-2', observedAt: ago(20) });
    recordPrice({ commodityId: c, pricePerKg: 340, source: 'deal', refId: 'y-3', observedAt: ago(2) });
    const s = priceSeries(c, { now: NOW, days: 84, bucketDays: 7 });
    expect(s.length).toBe(3);
    expect(s.map((p) => p.median)).toEqual([300, 320, 340]);
    expect(s[0]!.t).toBeLessThan(s[2]!.t);
  });
});

describe('priceSeries — firm evidence first', () => {
  it('shows what was paid in a period, and lets hopes fill only a period with nothing firmer', () => {
    const c = crop('GROUNDNUT');
    // Two old periods no other test touches: a deal beside two low asks, then a period of one ask alone.
    recordPrice({ commodityId: c, pricePerKg: 1000, source: 'deal', refId: 'sf-deal', observedAt: ago(75) });
    recordPrice({ commodityId: c, pricePerKg: 700, source: 'ask', refId: 'sf-ask-1', observedAt: ago(75) });
    recordPrice({ commodityId: c, pricePerKg: 700, source: 'ask', refId: 'sf-ask-2', observedAt: ago(75) });
    recordPrice({ commodityId: c, pricePerKg: 800, source: 'ask', refId: 'sf-ask-3', observedAt: ago(62) });
    const s = priceSeries(c, { now: NOW, days: 100, bucketDays: 7 }).filter((p) => p.t < NOW - 55 * DAY);
    expect(s).toHaveLength(2);
    expect(s[0]!.median).toBe(1000); // the deal, not dragged down by two asks
    expect(s[1]!.median).toBe(800); // nothing firmer that week, so the ask stands
  });
});

describe('priceGuidance', () => {
  const seed = (code: string, perKg: number, tag: string) => {
    const c = crop(code);
    for (let i = 0; i < 6; i += 1) recordPrice({ commodityId: c, pricePerKg: perKg + i, source: 'deal', refId: `${tag}-${i}`, observedAt: ago(i + 1) });
  };

  it('says it does not know rather than guess', () => {
    const g = priceGuidance({ commodityCode: 'TOMATO', side: 'sell', unitCode: 'CRATE', price: 30_000, now: NOW });
    expect(g.verdict).toBe('unknown');
    expect(g.messageKey).toBe('price.hint.unknown');
  });

  it('calls a price inside the range fair, per unit', () => {
    seed('MAIZE', 400, 'gm1'); // ~GHS 4/kg → a 100kg bag is ~GHS 400
    const g = priceGuidance({ commodityCode: 'MAIZE', side: 'sell', unitCode: 'BAG_100KG', price: 40_500, now: NOW });
    expect(g.verdict).toBe('fair');
    expect(g.suggested!.perUnit!.mid).toBeGreaterThan(39_000);
  });

  it('warns a seller who asks too much and a seller who gives it away', () => {
    seed('MAIZE', 400, 'gm2');
    const high = priceGuidance({ commodityCode: 'MAIZE', side: 'sell', unitCode: 'BAG_100KG', price: 52_000, now: NOW });
    expect(high.verdict).toBe('high');
    expect(high.messageKey).toBe('price.hint.sell.high');
    const low = priceGuidance({ commodityCode: 'MAIZE', side: 'sell', unitCode: 'BAG_100KG', price: 30_000, now: NOW });
    expect(low.verdict).toBe('low');
    expect(low.deviation!).toBeLessThan(0);
  });

  it('words the same verdict for the buyer’s side', () => {
    seed('MAIZE', 400, 'gm3');
    const g = priceGuidance({ commodityCode: 'MAIZE', side: 'buy', unitCode: 'BAG_100KG', price: 52_000, now: NOW });
    expect(g.messageKey).toBe('price.hint.buy.high');
  });

  it('flags a probable slip, twice outside the range, as worth a pause', () => {
    seed('MAIZE', 400, 'gm4');
    const g = priceGuidance({ commodityCode: 'MAIZE', side: 'sell', unitCode: 'BAG_100KG', price: 400_000, now: NOW });
    expect(g.verdict).toBe('very_high');
    expect(shouldPause(g)).toBe(true);
  });

  it('answers "what is it worth" when no price is given', () => {
    seed('MAIZE', 400, 'gm5');
    const g = priceGuidance({ commodityCode: 'MAIZE', side: 'sell', unitCode: 'BAG_50KG', now: NOW });
    expect(g.messageKey).toBe('price.hint.range');
    expect(g.params.low).toBeLessThan(g.params.high as number);
  });
});

describe('seasonalOutlook', () => {
  it('finds the peak month in a few years of history, and none without enough', () => {
    const c = crop('CASSAVA');
    expect(seasonalOutlook(c, NOW)).toBeNull();
    // Prices peak in July (month 7) every year, for five years, at two markets.
    const rows: Array<typeof priceObservations.$inferInsert> = [];
    for (let year = 2018; year <= 2022; year += 1) {
      for (let m = 0; m < 12; m += 1) {
        const price = Math.round(500 * (1 + 0.2 * Math.cos(((m - 6) / 12) * 2 * Math.PI)));
        for (const market of ['Tamale', 'Techiman']) {
          rows.push({
            commodityId: c,
            pricePerKg: price,
            source: 'market',
            dataset: 'wfp',
            market,
            refId: `season:${market}:${year}:${m}`,
            observedAt: Date.UTC(year, m, 15),
          });
        }
      }
    }
    db.insert(priceObservations).values(rows).run();
    clearPriceCaches();
    const outlook = seasonalOutlook(c, Date.UTC(2026, 3, 10))!; // asked in April
    expect(outlook.peakMonth).toBe(7);
    expect(outlook.years).toBe(5);
    expect(outlook.twoMonths).toBeGreaterThan(0.05); // April → June, heading up
    // Asked in September, the same history says prices are heading down.
    expect(seasonalOutlook(c, Date.UTC(2026, 8, 10))!.nextMonth).toBeLessThan(0);
  });
});
