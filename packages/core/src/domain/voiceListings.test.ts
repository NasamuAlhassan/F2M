import { describe, expect, it } from 'vitest';
import { convertToKg, getCommodityByCode, getUnit } from './registries';
import { parseListingText } from './voiceListings';

/**
 * The open voice line (D-038) has no confirmation screen: whatever the parser
 * returns goes straight onto the marketplace and into matching. A silently
 * wrong quantity is therefore worse than no listing at all — it moves real
 * escrow against produce that does not exist. Every case below is asserted in
 * kg, the only number that matters downstream.
 */
const kg = (text: string): number | null => {
  const parsed = parseListingText(text);
  if (!parsed) return null;
  const commodity = getCommodityByCode(parsed.commodityCode);
  return convertToKg(getUnit(commodity.id, parsed.unitCode), parsed.unitQty);
};

describe('voice listing parser (D-038)', () => {
  it('still reads the plain sentences the line was built for', () => {
    expect(parseListingText('I have ten bags of maize, good quality')).toMatchObject({
      commodityCode: 'MAIZE',
      unitCode: 'BAG_50KG',
      unitQty: 10,
      declaredBand: 'B',
    });
    expect(parseListingText('Twenty crates of tomatoes, excellent produce')).toMatchObject({
      commodityCode: 'TOMATO',
      unitCode: 'CRATE',
      unitQty: 20,
      declaredBand: 'A',
    });
    expect(parseListingText('I want to sell 5 sacks of pepper, fair quality')).toMatchObject({
      commodityCode: 'PEPPER',
      unitCode: 'SACK',
      unitQty: 5,
      declaredBand: 'C',
    });
    expect(parseListingText('some corn, three bags')).toMatchObject({ commodityCode: 'MAIZE', unitQty: 3 });
    expect(parseListingText('I have plenty cassava to sell')).toBeNull();
    expect(parseListingText('maize, no amount said')).toBeNull();
  });

  describe('no unit spoken', () => {
    it('falls back to the smallest unit, not the largest', () => {
      // listUnits orders by code, so maize's 100kg bag came first and "ten
      // maize" listed 1,000kg — 40x a farmer who meant ten olonka.
      expect(parseListingText('i have ten maize')).toMatchObject({ unitCode: 'OLONKA', unitQty: 10 });
      expect(kg('i have ten maize')).toBe(25);
      expect(kg('twenty tomato')).toBe(500); // baskets (25kg), not crates (52kg)
    });

    it('a spoken unit still beats the fallback', () => {
      expect(kg('i have ten bags of maize')).toBe(500);
    });
  });

  describe('which crop was actually said', () => {
    it('refuses a sentence naming two different crops', () => {
      // Registry order decided this, so the sentence below listed maize.
      expect(parseListingText('no maize today but ten baskets of tomato')).toBeNull();
      expect(parseListingText('ten bags of maize and five crates of tomato')).toBeNull();
    });

    it('takes the earliest mention when one crop is named more than once', () => {
      expect(parseListingText('maize, plenty maize, ten bags of maize')).toMatchObject({
        commodityCode: 'MAIZE',
        unitQty: 10,
      });
      expect(parseListingText('some corn, ten bags of maize')).toMatchObject({ commodityCode: 'MAIZE', unitQty: 10 });
    });

    it('matches whole words, with plurals', () => {
      expect(parseListingText('ten bags of maizena')).toBeNull();
      expect(parseListingText('ten bags of cornmeal')).toBeNull();
      expect(parseListingText('ten baskets of onions')).toMatchObject({ commodityCode: 'ONION' });
    });
  });

  describe('bag size vs bag count', () => {
    it('reads a spoken kg size as the size of one container', () => {
      // "100 kg" was taken as the count: 100 × the 100kg bag = 10,000kg.
      expect(parseListingText('i have 100 kg bag of maize')).toMatchObject({ unitCode: 'BAG_100KG', unitQty: 1 });
      expect(kg('i have 100 kg bag of maize')).toBe(100);
      expect(kg('i have 50kg bags of maize')).toBe(50);
    });

    it('uses the size to pick the unit and the count to fill it', () => {
      // ASR emits "50 kg" with a space as often as "50kg".
      expect(parseListingText('ten 50 kg bags of maize')).toMatchObject({ unitCode: 'BAG_50KG', unitQty: 10 });
      expect(kg('ten 50 kg bags of maize')).toBe(500);
      expect(kg('five 100 kg bags of maize')).toBe(500);
    });

    it('ignores numbers that are plainly not a count', () => {
      expect(kg('i have ten bags of maize ready in 3 days')).toBe(500);
    });

    it('returns null when count and size cannot be told apart', () => {
      expect(parseListingText('ten bags of maize and twenty bags')).toBeNull();
      expect(parseListingText('i have 100 kg and 50 kg of maize')).toBeNull();
      // A weight matching no container: guessing 8 baskets would invent the
      // number that moves escrow. Before this it listed 2 baskets — 50kg.
      expect(parseListingText('two hundred kilos of tomato')).toBeNull();
    });
  });

  describe('spoken numbers', () => {
    it('knows every teen', () => {
      const teens: Array<[string, number]> = [
        ['thirteen', 13],
        ['fourteen', 14],
        ['sixteen', 16],
        ['seventeen', 17],
        ['eighteen', 18],
        ['nineteen', 19],
      ];
      for (const [word, value] of teens) {
        // Missing from the table, these whole harvests came back unparseable.
        expect(parseListingText(`${word} bags of maize`)).toMatchObject({ unitQty: value });
      }
      expect(kg('fourteen bags of maize')).toBe(700);
    });

    it('composes multi-word numbers instead of stopping at the first', () => {
      expect(parseListingText('twenty five bags of maize')).toMatchObject({ unitQty: 25 }); // was 20
      expect(kg('twenty five bags of maize')).toBe(1250);
      expect(parseListingText('two hundred baskets of tomato')).toMatchObject({ unitQty: 200 }); // was 2
      expect(kg('two hundred baskets of tomato')).toBe(5000);
      expect(parseListingText('two hundred and fifty bags of maize')).toMatchObject({ unitQty: 250 });
      expect(parseListingText('one hundred fifty bags of maize')).toMatchObject({ unitQty: 150 });
    });
  });

  describe('quantity ceiling', () => {
    it('rejects above the ceiling the USSD path already enforces', () => {
      // 1,000,000 bags is 50,000,000kg — it outscores and sweeps every open demand.
      expect(parseListingText('i have 1000000 bags of maize')).toBeNull();
      expect(parseListingText('100001 bags of maize')).toBeNull();
      expect(parseListingText('100000 bags of maize')).toMatchObject({ unitQty: 100000 });
    });
  });
});
