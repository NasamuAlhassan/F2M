import {
  AVAILABLE_LOCALES,
  db,
  getCommodityById,
  getFarmerById,
  getLot,
  getRegion,
  getTrace,
  isLocaleLive,
  isLocaleReviewed,
  schema,
  t,
} from '@ftm/core';
import { desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

// What a QR-scanning consumer may see per event type (D-033): the journey and
// the quality story — never phone numbers, MoMo details, or money amounts.
const PUBLIC_PAYLOAD_FIELDS: Record<string, string[]> = {
  LOT_REGISTERED: ['quantityKg', 'declaredBand', 'unit', 'unitQty', 'commodity'],
  MATCHED: ['allocatedKg'],
  CONTRACT_OFFERED: ['allocatedKg'],
  GRADED: ['gradeBand', 'confidence'],
  DISPUTE_RESOLVED: ['gradeBand'],
  DRIVER_ASSIGNED: ['vehicleClassCode', 'distanceKm'],
  IN_TRANSIT: ['distanceKm'],
};

/**
 * The QR-code destination (D-033): anyone who scans a lot's certification QR
 * reads this — no login. Lot ids are unguessable UUIDs (capability URLs).
 */
export async function publicRoutes(app: FastifyInstance): Promise<void> {
  // The locale registry with its honest gate status (D-040): reviewed = a
  // native speaker signed off; live = allowed on real farmer-facing surfaces.
  app.get('/i18n/locales', async () => ({
    locales: AVAILABLE_LOCALES.map((l) => ({
      ...l,
      reviewed: isLocaleReviewed(l.code),
      live: isLocaleLive(l.code),
    })),
  }));

  app.get('/public/trace/:lotId', async (req) => {
    const { lotId } = req.params as { lotId: string };
    const lot = getLot(lotId); // 404s on unknown
    const commodity = getCommodityById(lot.commodityId);
    const farmer = getFarmerById(lot.farmerId);
    const unit = db.select().from(schema.units).where(eq(schema.units.id, lot.unitId)).get();

    // The latest completed grading across this lot's contracts = the certificate.
    const contracts = db.select().from(schema.contracts).where(eq(schema.contracts.lotId, lot.id)).all();
    const grading = contracts.length
      ? db
          .select()
          .from(schema.gradings)
          .where(
            inArray(
              schema.gradings.contractId,
              contracts.map((c) => c.id),
            ),
          )
          .orderBy(desc(schema.gradings.createdAt))
          .all()
          .find((g) => g.gradeBand !== null)
      : undefined;

    const events = getTrace(lot.id).map((e) => {
      const allowed = PUBLIC_PAYLOAD_FIELDS[e.type] ?? [];
      const raw = (e.payload ?? {}) as Record<string, unknown>;
      const payload: Record<string, unknown> = {};
      for (const key of allowed) if (raw[key] !== undefined && raw[key] !== null) payload[key] = raw[key];
      return {
        id: e.id,
        seq: e.seq,
        type: e.type,
        actorType: e.actorType,
        createdAt: e.createdAt,
        payload: Object.keys(payload).length ? payload : null,
      };
    });

    return {
      lot: {
        id: lot.id,
        lotCode: lot.lotCode,
        commodityCode: commodity.code,
        commodityName: t('en', commodity.nameKey),
        clockType: commodity.clockType,
        quantityKg: lot.quantityKg,
        unitName: unit ? t('en', unit.nameKey) : 'unit',
        declaredBand: lot.declaredBand,
        regionName: t('en', getRegion(lot.regionCode).nameKey),
        readyDate: lot.readyDate,
        status: lot.status,
        createdAt: lot.createdAt,
      },
      farmer: farmer ? { name: farmer.name, regionName: t('en', getRegion(farmer.regionCode).nameKey), district: farmer.district } : null,
      certification: grading
        ? { gradeBand: grading.gradeBand, confidence: grading.confidence, model: grading.model, gradedAt: grading.createdAt }
        : null,
      events,
    };
  });
}
