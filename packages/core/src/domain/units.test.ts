import { describe, expect, it } from 'vitest';
import { convertToKg, getCommodityByCode, getUnit } from './registries';
import { normalizePhone, toMsisdn } from './farmers';
import { expandPriceTerms } from './types';

describe('unit conversion', () => {
  it('converts olonka to canonical kg for maize', () => {
    const maize = getCommodityByCode('MAIZE');
    const olonka = getUnit(maize.id, 'OLONKA');
    expect(convertToKg(olonka, 20)).toBe(50); // 20 olonka × 2.5kg
  });

  it('converts bags, crates and tubers', () => {
    const maize = getCommodityByCode('MAIZE');
    expect(convertToKg(getUnit(maize.id, 'BAG_100KG'), 5)).toBe(500);
    const tomato = getCommodityByCode('TOMATO');
    expect(convertToKg(getUnit(tomato.id, 'CRATE'), 3)).toBe(156);
    const yam = getCommodityByCode('YAM');
    expect(convertToKg(getUnit(yam.id, 'HUNDRED'), 2)).toBe(500);
  });

  it('rejects non-positive quantities', () => {
    const maize = getCommodityByCode('MAIZE');
    expect(() => convertToKg(getUnit(maize.id, 'OLONKA'), 0)).toThrow();
  });
});

describe('phone normalization', () => {
  it('normalizes Ghanaian formats to E.164', () => {
    expect(normalizePhone('0244123456')).toBe('+233244123456');
    expect(normalizePhone('233244123456')).toBe('+233244123456');
    expect(normalizePhone('+233 24 412 3456')).toBe('+233244123456');
    expect(toMsisdn('0244123456')).toBe('233244123456');
  });

  it('rejects non-Ghanaian numbers', () => {
    expect(() => normalizePhone('12345')).toThrow();
  });
});

describe('price terms', () => {
  it('expands a base price for min band B into a full schedule', () => {
    // 400 pesewas/kg for band B → A above it, C below, REJECT zero.
    const terms = expandPriceTerms(400, 'B');
    expect(terms.B).toBe(400);
    expect(terms.A).toBe(Math.round(400 / 0.88));
    expect(terms.C).toBe(Math.round((400 * 0.7) / 0.88));
    expect(terms.REJECT).toBe(0);
  });
});
