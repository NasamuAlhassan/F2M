import { asc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { commodities, regions, rubrics, units, type Commodity, type Region, type Rubric, type Unit } from '../db/schema';
import { DomainError, notFound } from './errors';
import { clockConfigSchema, rubricDocSchema, type ClockConfig, type RubricDoc } from './types';

export function listRegions(): Region[] {
  return db.select().from(regions).orderBy(asc(regions.code)).all();
}

export function getRegion(code: string): Region {
  const region = db.select().from(regions).where(eq(regions.code, code)).get();
  if (!region) throw notFound(`region ${code}`);
  return region;
}

export function listCommodities(): Array<Commodity & { clock: ClockConfig; units: Unit[] }> {
  const all = db.select().from(commodities).orderBy(asc(commodities.sortOrder), asc(commodities.code)).all();
  const allUnits = db.select().from(units).all();
  return all.map((c) => ({
    ...c,
    clock: clockConfigSchema.parse(JSON.parse(c.clockConfig)),
    units: allUnits.filter((u) => u.commodityId === c.id),
  }));
}

export function getCommodityByCode(code: string): Commodity & { clock: ClockConfig } {
  const commodity = db.select().from(commodities).where(eq(commodities.code, code)).get();
  if (!commodity) throw notFound(`commodity ${code}`);
  return { ...commodity, clock: clockConfigSchema.parse(JSON.parse(commodity.clockConfig)) };
}

export function getCommodityById(id: string): Commodity & { clock: ClockConfig } {
  const commodity = db.select().from(commodities).where(eq(commodities.id, id)).get();
  if (!commodity) throw notFound(`commodity ${id}`);
  return { ...commodity, clock: clockConfigSchema.parse(JSON.parse(commodity.clockConfig)) };
}

export function listUnits(commodityId: string): Unit[] {
  // Deterministic order — these become numbered USSD menu items.
  return db.select().from(units).where(eq(units.commodityId, commodityId)).orderBy(asc(units.code)).all();
}

export function getUnit(commodityId: string, unitCode: string): Unit {
  const unit = db
    .select()
    .from(units)
    .where(eq(units.commodityId, commodityId))
    .all()
    .find((u) => u.code === unitCode);
  if (!unit) throw notFound(`unit ${unitCode} for commodity`);
  return unit;
}

/** Convert a locally-quoted quantity to canonical kg — done exactly once, at intake. */
export function convertToKg(unit: Unit, unitQty: number): number {
  if (unitQty <= 0) throw new DomainError('Quantity must be positive', 'INVALID_QUANTITY');
  return Math.round(unit.kgPerUnit * unitQty * 10) / 10;
}

/** The active rubric for a commodity, parsed and validated. */
export function getActiveRubric(commodityId: string): { rubric: Rubric; doc: RubricDoc } {
  const commodity = getCommodityById(commodityId);
  const rubric = db
    .select()
    .from(rubrics)
    .where(eq(rubrics.commodityId, commodityId))
    .all()
    .find((r) => r.version === commodity.activeRubricVersion);
  if (!rubric) throw notFound(`rubric v${commodity.activeRubricVersion} for ${commodity.code}`);
  return { rubric, doc: rubricDocSchema.parse(JSON.parse(rubric.doc)) };
}

export function getRubricById(rubricId: string): { rubric: Rubric; doc: RubricDoc } {
  const rubric = db.select().from(rubrics).where(eq(rubrics.id, rubricId)).get();
  if (!rubric) throw notFound(`rubric ${rubricId}`);
  return { rubric, doc: rubricDocSchema.parse(JSON.parse(rubric.doc)) };
}
