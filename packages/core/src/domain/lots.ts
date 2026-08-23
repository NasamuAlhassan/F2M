import { desc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { lots, type Lot } from '../db/schema';
import { DomainError, notFound } from './errors';
import { getFarmerById } from './farmers';
import { generateLotCode } from './ids';
import { convertToKg, getCommodityByCode, getUnit } from './registries';
import { appendLotEvent } from './trace';
import { gradeBandSchema, type GradeBand } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RegisterLotInput {
  farmerId: string;
  commodityCode: string;
  unitCode: string;
  unitQty: number;
  declaredBand: GradeBand;
  /** ms epoch; defaults to now. A future date on a storable commodity is a forward listing. */
  readyDate?: number;
  askingPricePerKg?: number; // pesewas
  gpsLat?: number;
  gpsLng?: number;
}

export function registerLot(input: RegisterLotInput): Lot {
  const farmer = getFarmerById(input.farmerId);
  if (!farmer) throw notFound('farmer');
  const commodity = getCommodityByCode(input.commodityCode);
  const unit = getUnit(commodity.id, input.unitCode);
  const declaredBand = gradeBandSchema.parse(input.declaredBand);
  if (declaredBand === 'REJECT') throw new DomainError('Cannot list a rejected lot', 'INVALID_BAND');

  const now = Date.now();
  const readyDate = input.readyDate ?? now;
  if (readyDate < now - DAY_MS) {
    throw new DomainError('Ready date is in the past', 'INVALID_READY_DATE');
  }
  // The commodity clock: perishables cannot be forward-listed beyond tomorrow.
  const horizon = commodity.clock.allowsForward ? 180 * DAY_MS : DAY_MS;
  if (readyDate > now + horizon) {
    throw new DomainError(
      commodity.clock.allowsForward
        ? 'Ready date is too far in the future'
        : 'Perishables can only be listed for today or tomorrow',
      'READY_DATE_TOO_FAR',
    );
  }

  const quantityKg = convertToKg(unit, input.unitQty);

  return db.transaction((tx) => {
    let lotCode = generateLotCode();
    // lot_code is unique — retry the 1-in-a-million collision instead of failing a farmer.
    while (tx.select().from(lots).where(eq(lots.lotCode, lotCode)).get()) lotCode = generateLotCode();

    const lot = tx
      .insert(lots)
      .values({
        lotCode,
        farmerId: farmer.id,
        commodityId: commodity.id,
        quantityKg,
        remainingKg: quantityKg,
        unitId: unit.id,
        unitQty: input.unitQty,
        declaredBand,
        readyDate,
        askingPricePerKg: input.askingPricePerKg ?? null,
        regionCode: farmer.regionCode,
        gpsLat: input.gpsLat ?? farmer.gpsLat,
        gpsLng: input.gpsLng ?? farmer.gpsLng,
      })
      .returning()
      .get();

    appendLotEvent(tx, {
      lotId: lot.id,
      type: 'LOT_REGISTERED',
      actorType: 'farmer',
      actorId: farmer.id,
      payload: {
        lotCode,
        commodity: commodity.code,
        quantityKg,
        unit: unit.code,
        unitQty: input.unitQty,
        declaredBand,
      },
    });
    return lot;
  });
}

export function getLot(id: string): Lot {
  const lot = db.select().from(lots).where(eq(lots.id, id)).get();
  if (!lot) throw notFound('lot');
  return lot;
}

export function getLotByCode(lotCode: string): Lot | undefined {
  return db.select().from(lots).where(eq(lots.lotCode, lotCode.toUpperCase())).get();
}

export function listLotsByFarmer(farmerId: string): Lot[] {
  return db.select().from(lots).where(eq(lots.farmerId, farmerId)).orderBy(desc(lots.createdAt)).all();
}
