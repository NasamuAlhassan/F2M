import { describe, expect, it } from 'vitest';
import { hasKey } from '../i18n';
import { getActiveRubric, listCommodities } from './registries';

/**
 * Registry coherence — the invariant that makes "adding a commodity = writing
 * a rubric" true. Every commodity must arrive complete: display keys in the
 * catalog, at least one unit, a parsing rubric whose criteria all have labels,
 * and a clock consistent with its category.
 */
describe('registry coherence (M9)', () => {
  const commodities = listCommodities();

  it('seeds all eight commodities, most-traded first', () => {
    expect(commodities.map((c) => c.code)).toEqual([
      'MAIZE',
      'TOMATO',
      'YAM',
      'RICE',
      'GROUNDNUT',
      'PEPPER',
      'ONION',
      'PLANTAIN',
    ]);
  });

  for (const commodity of commodities) {
    describe(commodity.code, () => {
      it('has a catalog name', () => {
        expect(hasKey('en', commodity.nameKey)).toBe(true);
      });

      it('has at least one unit, each with a catalog name and positive kg', () => {
        expect(commodity.units.length).toBeGreaterThanOrEqual(1);
        for (const unit of commodity.units) {
          expect(hasKey('en', unit.nameKey)).toBe(true);
          expect(unit.kgPerUnit).toBeGreaterThan(0);
        }
      });

      it('has an active rubric whose criteria all carry catalog labels and full band descriptors', () => {
        const { doc } = getActiveRubric(commodity.id);
        expect(doc.criteria.length).toBeGreaterThanOrEqual(4);
        for (const criterion of doc.criteria) {
          expect(hasKey('en', criterion.labelKey)).toBe(true);
          for (const band of doc.gradeBands) {
            expect(criterion.bandDescriptors[band]).toBeTruthy();
          }
        }
      });

      it('has a clock consistent with its category', () => {
        if (commodity.clockType === 'perishable') {
          expect(commodity.clock.allowsForward).toBe(false);
          expect(commodity.clock.maxWindowDays).toBeLessThanOrEqual(7);
        } else {
          expect(commodity.clock.allowsForward).toBe(true);
        }
        if (commodity.category === 'grain') expect(commodity.clockType).toBe('storable');
      });
    });
  }
});
