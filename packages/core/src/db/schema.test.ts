import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { clockConfigSchema, rubricDocSchema } from '../domain/types';
import { db } from './client';
import { commodities, farmers, lots, marketPrices, regions, rubrics, units } from './schema';
import { seed } from './seed';

describe('schema + seed', () => {
  it('seeds the three registries', async () => {
    const all = (await db.select().from(commodities));
    expect(all.map((c) => c.code).sort()).toEqual([
      'CASSAVA',
      'COWPEA',
      'GROUNDNUT',
      'MAIZE',
      'MILLET',
      'ONION',
      'PEPPER',
      'PLANTAIN',
      'RICE',
      'SORGHUM',
      'SOYBEAN',
      'TOMATO',
      'YAM',
    ]);
    expect((await db.select().from(regions))).toHaveLength(16);

    for (const c of all) {
      const clock = clockConfigSchema.parse(JSON.parse(c.clockConfig));
      expect(clock.offerTtlMinutes).toBeGreaterThan(0);
      const rubric = (await db.select().from(rubrics).where(eq(rubrics.commodityId, c.id)))[0];
      expect(rubric).toBeDefined();
      const doc = rubricDocSchema.parse(JSON.parse(rubric!.doc));
      expect(doc.criteria.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('the start-up seed adds what is missing and changes nothing that exists', async () => {
    const maize = (await db.select().from(commodities).where(eq(commodities.code, 'MAIZE')))[0]!;
    const price = (await db.select().from(marketPrices).where(eq(marketPrices.commodityId, maize.id)))[0]!;
    (await db.update(marketPrices).set({ pricePerKg: 999 }).where(eq(marketPrices.id, price.id)));
    const cassava = (await db.select().from(commodities).where(eq(commodities.code, 'CASSAVA')))[0]!;
    (await db.delete(marketPrices).where(eq(marketPrices.commodityId, cassava.id)));

    await seed({ refresh: false });
    expect((await db.select().from(marketPrices).where(eq(marketPrices.id, price.id)))[0]!.pricePerKg).toBe(999);
    expect((await db.select().from(marketPrices).where(eq(marketPrices.commodityId, cassava.id)))).toHaveLength(4);

    await seed(); // db:reset's refresh puts the reference value back
    expect((await db.select().from(marketPrices).where(eq(marketPrices.id, price.id)))[0]!.pricePerKg).toBe(price.pricePerKg);
  });

  it('enforces the perishable/storable clock split in seed data', async () => {
    const tomato = (await db.select().from(commodities).where(eq(commodities.code, 'TOMATO')))[0]!;
    const maize = (await db.select().from(commodities).where(eq(commodities.code, 'MAIZE')))[0]!;
    expect(clockConfigSchema.parse(JSON.parse(tomato.clockConfig)).allowsForward).toBe(false);
    expect(clockConfigSchema.parse(JSON.parse(maize.clockConfig)).allowsForward).toBe(true);
  });

  it('scopes informal units per commodity', async () => {
    const maize = (await db.select().from(commodities).where(eq(commodities.code, 'MAIZE')))[0]!;
    const olonka = (await db
          .select()
          .from(units)
          .where(eq(units.commodityId, maize.id)))
      .find((u) => u.code === 'OLONKA');
    expect(olonka?.kgPerUnit).toBe(2.5);
    expect(olonka?.isInformal).toBe(true);
  });

  it('accepts a farmer + lot insert and enforces unique phone', async () => {
    const maize = (await db.select().from(commodities).where(eq(commodities.code, 'MAIZE')))[0]!;
    const bag = (await db
          .select()
          .from(units)
          .where(eq(units.commodityId, maize.id)))
      .find((u) => u.code === 'BAG_50KG')!;

    const farmer = (await db
              .insert(farmers)
              .values({
                phone: '+233200000001',
                name: 'Abena Owusu',
                regionCode: 'BONO_EAST',
                momoMsisdn: '233200000001',
              })
              .returning())[0]!;

    const lot = (await db
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
              .returning())[0]!;
    expect(lot.status).toBe('registered');

    // Postgres's unique-violation code; drizzle wraps it as the error's cause.
    await expect(
      db.insert(farmers).values({ phone: '+233200000001', name: 'Duplicate', regionCode: 'BONO', momoMsisdn: 'x' }),
    ).rejects.toMatchObject({ cause: { code: '23505' } });
  });
});
