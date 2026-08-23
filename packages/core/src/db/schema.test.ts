import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { clockConfigSchema, rubricDocSchema } from '../domain/types';
import { db } from './client';
import { commodities, farmers, lots, regions, rubrics, units } from './schema';

describe('schema + seed', () => {
  it('seeds the three registries', () => {
    const all = db.select().from(commodities).all();
    expect(all.map((c) => c.code).sort()).toEqual(['MAIZE', 'TOMATO', 'YAM']);
    expect(db.select().from(regions).all()).toHaveLength(16);

    for (const c of all) {
      const clock = clockConfigSchema.parse(JSON.parse(c.clockConfig));
      expect(clock.offerTtlMinutes).toBeGreaterThan(0);
      const rubric = db.select().from(rubrics).where(eq(rubrics.commodityId, c.id)).get();
      expect(rubric).toBeDefined();
      const doc = rubricDocSchema.parse(JSON.parse(rubric!.doc));
      expect(doc.criteria.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('enforces the perishable/storable clock split in seed data', () => {
    const tomato = db.select().from(commodities).where(eq(commodities.code, 'TOMATO')).get()!;
    const maize = db.select().from(commodities).where(eq(commodities.code, 'MAIZE')).get()!;
    expect(clockConfigSchema.parse(JSON.parse(tomato.clockConfig)).allowsForward).toBe(false);
    expect(clockConfigSchema.parse(JSON.parse(maize.clockConfig)).allowsForward).toBe(true);
  });

  it('scopes informal units per commodity', () => {
    const maize = db.select().from(commodities).where(eq(commodities.code, 'MAIZE')).get()!;
    const olonka = db
      .select()
      .from(units)
      .where(eq(units.commodityId, maize.id))
      .all()
      .find((u) => u.code === 'OLONKA');
    expect(olonka?.kgPerUnit).toBe(2.5);
    expect(olonka?.isInformal).toBe(true);
  });

  it('accepts a farmer + lot insert and enforces unique phone', () => {
    const maize = db.select().from(commodities).where(eq(commodities.code, 'MAIZE')).get()!;
    const bag = db
      .select()
      .from(units)
      .where(eq(units.commodityId, maize.id))
      .all()
      .find((u) => u.code === 'BAG_50KG')!;

    const farmer = db
      .insert(farmers)
      .values({
        phone: '+233200000001',
        name: 'Abena Owusu',
        regionCode: 'BONO_EAST',
        momoMsisdn: '233200000001',
      })
      .returning()
      .get();

    const lot = db
      .insert(lots)
      .values({
        lotCode: 'FTM-TEST',
        farmerId: farmer.id,
        commodityId: maize.id,
        quantityKg: 500,
        remainingKg: 500,
        unitId: bag.id,
        unitQty: 10,
        declaredBand: 'B',
        readyDate: Date.now(),
        regionCode: 'BONO_EAST',
      })
      .returning()
      .get();
    expect(lot.status).toBe('registered');

    expect(() =>
      db
        .insert(farmers)
        .values({ phone: '+233200000001', name: 'Duplicate', regionCode: 'BONO', momoMsisdn: 'x' })
        .run(),
    ).toThrow(/UNIQUE/);
  });
});
