import { asc } from 'drizzle-orm';
import { db } from '../db/client';
import { commodities, regions, rubrics, units, type Commodity, type Region, type Rubric, type Unit } from '../db/schema';
import { DomainError, notFound } from './errors';
import { clockConfigSchema, rubricDocSchema, type ClockConfig, type RubricDoc } from './types';

/**
 * The registries — regions, crops, units, rubrics — held in memory (docs/HOSTING.md).
 * They change only when the seed runs, are a few hundred rows, and are read on
 * nearly every request (every crop name in a USSD menu or an SMS). With
 * Postgres every read is a network round trip and async; cached, the lookups
 * stay instant and synchronous. Load once at start (server, serverless
 * entry, tests, scripts) with loadRegistries(); the seed reloads after writing.
 */
type CommodityRow = Commodity & { clock: ClockConfig };

let cache: {
  regions: Region[];
  commodities: CommodityRow[];
  units: Unit[];
  rubrics: Rubric[];
} | null = null;

export async function loadRegistries(): Promise<void> {
  const [r, c, u, rb] = await Promise.all([
    db.select().from(regions).orderBy(asc(regions.code)),
    db.select().from(commodities).orderBy(asc(commodities.sortOrder), asc(commodities.code)),
    db.select().from(units).orderBy(asc(units.code)),
    db.select().from(rubrics),
  ]);
  cache = {
    regions: r,
    commodities: c.map((row) => ({ ...row, clock: clockConfigSchema.parse(JSON.parse(row.clockConfig)) })),
    units: u,
    rubrics: rb,
  };
}

function registries() {
  if (!cache) throw new Error('Registries not loaded: call loadRegistries() at start-up');
  return cache;
}

export function listRegions(): Region[] {
  return registries().regions;
}

export function getRegion(code: string): Region {
  const region = registries().regions.find((r) => r.code === code);
  if (!region) throw notFound(`region ${code}`);
  return region;
}

export function listCommodities(): Array<CommodityRow & { units: Unit[] }> {
  const { commodities: all, units: allUnits } = registries();
  return all.map((c) => ({ ...c, units: allUnits.filter((u) => u.commodityId === c.id) }));
}

export function getCommodityByCode(code: string): CommodityRow {
  const commodity = registries().commodities.find((c) => c.code === code);
  if (!commodity) throw notFound(`commodity ${code}`);
  return commodity;
}

export function getCommodityById(id: string): CommodityRow {
  const commodity = registries().commodities.find((c) => c.id === id);
  if (!commodity) throw notFound(`commodity ${id}`);
  return commodity;
}

export function listUnits(commodityId: string): Unit[] {
  // Deterministic order (by code) — these become numbered USSD menu items.
  return registries().units.filter((u) => u.commodityId === commodityId);
}

export function getUnit(commodityId: string, unitCode: string): Unit {
  const unit = listUnits(commodityId).find((u) => u.code === unitCode);
  if (!unit) throw notFound(`unit ${unitCode} for commodity`);
  return unit;
}

/** A unit by its row id (lots and contracts store the id). */
export function getUnitById(id: string): Unit {
  const unit = registries().units.find((u) => u.id === id);
  if (!unit) throw notFound(`unit ${id}`);
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
  const rubric = registries().rubrics.find((r) => r.commodityId === commodityId && r.version === commodity.activeRubricVersion);
  if (!rubric) throw notFound(`rubric v${commodity.activeRubricVersion} for ${commodity.code}`);
  return { rubric, doc: rubricDocSchema.parse(JSON.parse(rubric.doc)) };
}

export function getRubricById(rubricId: string): { rubric: Rubric; doc: RubricDoc } {
  const rubric = registries().rubrics.find((r) => r.id === rubricId);
  if (!rubric) throw notFound(`rubric ${rubricId}`);
  return { rubric, doc: rubricDocSchema.parse(JSON.parse(rubric.doc)) };
}
