import { describe, expect, it } from 'vitest';
import { findCommodity, parseCounterAnswer, parseCountAnswer, parseListingDraft, parsePriceAnswer } from './voiceParse';

/** Phase 2: reading a farmer's sentence into listing fields, leaving out what wasn't clearly said. */
describe('parseListingDraft', () => {
  it('reads the vision document’s own example', () => {
    expect(
      parseListingDraft(
        'I have 99 bags of rice, and I am selling each bag for 2,000 Ghana cedis. I harvested them yesterday, and they will be ready tomorrow.',
      ),
    ).toEqual({ commodityCode: 'RICE', unitQty: 99, pricePerUnit: 200000, harvestedDaysAgo: 1, readyInDays: 1 });
  });

  it('leaves the unit out when "bags" could be either of the crop’s bags', () => {
    expect(parseListingDraft('99 bags of rice').unitCode).toBeUndefined();
    expect(parseListingDraft('99 crates of tomato').unitCode).toBe('CRATE');
    expect(parseListingDraft('ten 50 kg bags of rice').unitCode).toBe('BAG_50KG');
  });

  it('composes spoken numbers with thousands', () => {
    expect(parseListingDraft('twenty crates of tomato at two thousand five hundred cedis each')).toMatchObject({
      unitQty: 20,
      pricePerUnit: 250000,
    });
  });

  it('reads harvest and ready days', () => {
    expect(parseListingDraft('ten crates of tomato, harvested three days ago, ready now')).toMatchObject({
      harvestedDaysAgo: 3,
      readyInDays: 0,
    });
    expect(parseListingDraft('maize, harvested last week, ready in two weeks')).toMatchObject({ harvestedDaysAgo: 7, readyInDays: 14 });
  });

  it('turns a price for everything into a price per unit', () => {
    expect(parseListingDraft('fifty bags of cowpea for 45,000 cedis for all of it')).toMatchObject({ unitQty: 50, pricePerUnit: 90000 });
  });

  it('only grades on clear quality words', () => {
    expect(parseListingDraft('maize, very good quality').declaredBand).toBe('A');
    expect(parseListingDraft('maize, good quality').declaredBand).toBe('B');
    expect(parseListingDraft('hello, good morning, I have maize').declaredBand).toBeUndefined();
  });

  it('names no crop when two are said, and nothing at all for small talk', () => {
    expect(parseListingDraft('I have maize and also rice').commodityCode).toBeUndefined();
    expect(findCommodity('I have maize and also rice')).toEqual({ ambiguous: true });
    expect(parseListingDraft('hello there')).toEqual({});
  });
});

describe('single answers', () => {
  it('a price, or "let buyers offer"', () => {
    expect(parsePriceAnswer('two thousand one hundred')).toBe(210000);
    expect(parsePriceAnswer('GHS 350')).toBe(35000);
    expect(parsePriceAnswer('let buyers make an offer')).toBeNull();
    expect(parsePriceAnswer('I am not sure')).toBeUndefined();
  });

  it('a count, with the unit when named', () => {
    expect(parseCountAnswer('99 bags', 'RICE')).toEqual({ unitQty: 99 });
    expect(parseCountAnswer('fifteen', 'MAIZE')).toEqual({ unitQty: 15 });
    expect(parseCountAnswer('ten crates', 'TOMATO')).toEqual({ unitQty: 10, unitCode: 'CRATE' });
  });

  it('a counter-offer: quantity and price, or a price alone', () => {
    expect(parseCounterAnswer('I can sell the 10 bags, but I want 2,100 cedis per bag', 'RICE')).toEqual({ units: 10, pricePerUnit: 210000 });
    expect(parseCounterAnswer('2100', 'RICE')).toEqual({ pricePerUnit: 210000 });
  });
});
