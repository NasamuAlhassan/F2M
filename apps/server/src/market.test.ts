import { db, registerFarmer, registerLot, schema } from '@ftm/core';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from './app';

let app: FastifyInstance;
let token: string;

interface MarketLotRow {
  id: string;
  lotCode: string;
  commodityCode: string;
  listingType: string;
  declaredBand: string;
  remainingKg: number;
  unitCode: string | null;
  kgPerUnit: number;
  unitsRemaining: number | null;
  pricePerKg: number | null;
  pricePerUnit: number | null;
  priceSource: string | null;
  fairPrice: boolean;
  farmerName: string | null;
  regionName: string;
  distanceKm: number;
}

beforeAll(async () => {
  app = await buildServer({ logger: false });
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: JSON.stringify({ email: 'buyer@demo.ftm', password: 'demo-buyer-2026' }),
    headers: { 'content-type': 'application/json' },
  });
  token = login.json().token;
});
afterAll(async () => {
  await app.close();
});

async function getLots(): Promise<MarketLotRow[]> {
  const res = await app.inject({
    method: 'GET',
    url: '/api/market/lots',
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { lots: MarketLotRow[] }).lots;
}

describe('marketplace lots (M21)', () => {
  it('lists open lots as browsable cards with units, market-reference pricing, and distance', async () => {
    // Yam lane janitor: park existing open yam lots so ours is deterministic.
    const yam = db.select().from(schema.commodities).all().find((c) => c.code === 'YAM')!;
    db.update(schema.demands)
      .set({ status: 'cancelled' })
      .where(and(eq(schema.demands.commodityId, yam.id), inArray(schema.demands.status, ['open', 'partially_matched'])))
      .run();
    db.update(schema.lots)
      .set({ status: 'withdrawn' })
      .where(and(eq(schema.lots.commodityId, yam.id), eq(schema.lots.status, 'registered')))
      .run();

    const farmer = registerFarmer({ phone: '+233207450101', name: 'Market Farmer', regionCode: 'BONO_EAST' });
    const lot = registerLot({ farmerId: farmer.id, commodityCode: 'YAM', unitCode: 'HUNDRED', unitQty: 2, declaredBand: 'B' });

    const rows = await getLots();
    const row = rows.find((r) => r.id === lot.id);
    expect(row).toBeDefined();
    expect(row!.commodityCode).toBe('YAM');
    expect(row!.declaredBand).toBe('B');
    expect(row!.farmerName).toBe('Market Farmer');
    expect(row!.regionName.length).toBeGreaterThan(0);
    expect(row!.distanceKm).toBeGreaterThan(0); // Bono East → the demo buyer in Greater Accra
    expect(row!.unitCode).toBe('HUNDRED');
    expect(row!.kgPerUnit).toBeGreaterThan(0);
    expect(row!.unitsRemaining).toBe(Math.round(row!.remainingKg / row!.kgPerUnit));
    // No asking price over USSD → the card shows the cross-market reference.
    expect(row!.priceSource).toBe('market');
    expect(row!.pricePerKg).toBeGreaterThan(0);
    expect(row!.pricePerUnit).toBe(Math.round(row!.pricePerKg! * row!.kgPerUnit));
    expect(row!.fairPrice).toBe(true);
    expect(['SAME_DAY', 'FORWARD']).toContain(row!.listingType);

    // Withdrawn lots disappear from the marketplace.
    db.update(schema.lots).set({ status: 'withdrawn' }).where(eq(schema.lots.id, lot.id)).run();
    const after = await getLots();
    expect(after.find((r) => r.id === lot.id)).toBeUndefined();
  });

  it('requires a buyer token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/market/lots' });
    expect(res.statusCode).toBe(401);
  });
});
