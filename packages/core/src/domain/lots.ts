import { desc, eq } from 'drizzle-orm';
import { config } from '../config';
import { db } from '../db/client';
import { farmers, lots, units, type Lot } from '../db/schema';
import { t } from '../i18n';
import { DomainError, notFound } from './errors';
import { getFarmerById } from './farmers';
import { generateLotCode } from './ids';
import { listContractsForLot } from './contracts';
import { declineOffer, runMatching } from './matching';
import { closeOffersForLot } from './offers';
import { queueSms } from './notifications';
import { tryAlertOnNewLot } from './alerts';
import { observePrice } from './priceIntel';
import { convertToKg, getCommodityByCode, getCommodityById, getUnit } from './registries';
import { appendLotEvent } from './trace';
import { gradeBandSchema, type GradeBand } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
/** A listing about to lapse gets a warning SMS this long before (Phase 1). */
const EXPIRY_WARNING_MS = 2 * DAY_MS;

function askingPrices(
  kgPerUnit: number,
  perUnit?: number | null,
  perKg?: number | null,
): { askingPricePerUnit: number | null; askingPricePerKg: number | null } {
  for (const v of [perUnit, perKg]) {
    if (v !== undefined && v !== null && (!Number.isInteger(v) || v <= 0)) throw new DomainError('Enter a price above zero', 'INVALID_PRICE');
  }
  if (perUnit) return { askingPricePerUnit: perUnit, askingPricePerKg: Math.round(perUnit / kgPerUnit) };
  if (perKg) return { askingPricePerUnit: Math.round(perKg * kgPerUnit), askingPricePerKg: perKg };
  return { askingPricePerUnit: null, askingPricePerKg: null };
}

export interface RegisterLotInput {
  farmerId: string;
  commodityCode: string;
  unitCode: string;
  unitQty: number;
  declaredBand: GradeBand;
  /** ms epoch; defaults to now. A future date on a storable commodity is a forward listing. */
  readyDate?: number;
  askingPricePerKg?: number; // pesewas
  /** The farmer's asking price per unit of this listing (per bag…), pesewas — preferred (Phase 1). */
  askingPricePerUnit?: number;
  harvestedAt?: number; // ms
  community?: string;
  landmark?: string;
  /** How the listing was made (D-036). Defaults to 'ussd' — the basic-phone path. */
  channel?: 'web' | 'ussd' | 'ivr';
  gpsLat?: number;
  gpsLng?: number;
}

export async function registerLot(input: RegisterLotInput): Promise<Lot> {
  const farmer = await getFarmerById(input.farmerId);
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
  if (input.harvestedAt !== undefined && input.harvestedAt > now + DAY_MS) {
    throw new DomainError('The harvest date cannot be in the future', 'INVALID_HARVEST_DATE');
  }
  // One asking price, stored both ways: per unit (what the farmer says) and per kg (what matching compares).
  const prices = askingPrices(unit.kgPerUnit, input.askingPricePerUnit, input.askingPricePerKg);

  const lot = await db.transaction(async (tx) => {
      let lotCode = generateLotCode();
      // lot_code is unique — retry the 1-in-a-million collision instead of failing a farmer.
      while ((await tx.select().from(lots).where(eq(lots.lotCode, lotCode)))[0]) lotCode = generateLotCode();

      const lot = (await tx
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
                    channel: input.channel ?? 'ussd',
                    readyDate,
                    ...prices,
                    harvestedAt: input.harvestedAt ?? null,
                    community: input.community?.trim() || null,
                    landmark: input.landmark?.trim() || null,
                    expiresAt: now + config.LISTING_TTL_DAYS * DAY_MS,
                    regionCode: farmer.regionCode,
                    gpsLat: input.gpsLat ?? farmer.gpsLat,
                    gpsLng: input.gpsLng ?? farmer.gpsLng,
                  })
                  .returning())[0]!;

      await appendLotEvent(tx, {
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

  // The USSD END confirmation evaporates with the session — the SMS receipt is
  // the basic-phone farmer's only written record (the voice path already sends
  // sms.listingCreated; web sellers see their dashboard).
  if ((input.channel ?? 'ussd') === 'ussd') {
    await queueSms({
            phone: farmer.phone,
            locale: farmer.locale,
            templateKey: 'sms.lotListed',
            params: {
              lotCode: lot.lotCode,
              qty: input.unitQty,
              unit: t(farmer.locale, unit.nameKey),
              commodity: t(farmer.locale, commodity.nameKey),
            },
          });
  }

  if (lot.askingPricePerKg) {
    await observePrice({ commodityId: lot.commodityId, regionCode: lot.regionCode, pricePerKg: lot.askingPricePerKg, source: 'ask', refId: lot.id });
  }

  // A fresh lot may satisfy demand posted last night — match immediately.
  await runMatching({ lotId: lot.id });
  // Then tell the buyers it matters to — after matching, so those it already bid for are not told twice (D-055).
  await tryAlertOnNewLot(lot.id);
  return getLot(lot.id);
}

export async function getLot(id: string): Promise<Lot> {
  const lot = (await db.select().from(lots).where(eq(lots.id, id)))[0];
  if (!lot) throw notFound('lot');
  return lot;
}

export async function getLotByCode(lotCode: string): Promise<Lot | undefined> {
  return (await db.select().from(lots).where(eq(lots.lotCode, lotCode.toUpperCase())))[0];
}

/**
 * The farmer takes a listing off the market. Open negotiations on it end
 * first (any request kg they held go back, each buyer is told), then whatever
 * is still unsold leaves the market. Since Phase 1 part of a listing can
 * already be in an order: that order goes ahead untouched — only the unsold
 * rest is removed. A listing that is wholly in orders (no longer on the
 * market) cannot be removed: a buyer's money and a pickup are committed to it.
 */
export async function withdrawLot(lotId: string, farmerId: string): Promise<Lot> {
  const lot = await getLot(lotId);
  if (lot.farmerId !== farmerId) throw new DomainError('Not your lot', 'FORBIDDEN', 403);
  if (lot.status === 'withdrawn') return lot;
  if (lot.status !== 'registered' && lot.status !== 'matched') {
    throw new DomainError('This lot already has an order, so it can no longer be removed', 'LOT_IN_ORDER', 409);
  }
  for (const contract of (await listContractsForLot(lotId)).filter((c) => c.state === 'OFFERED')) {
    await declineOffer(contract.id, farmerId);
  }
  await closeOffersForLot(lotId, 'withdrawn'); // negotiations on it end too, and each buyer is told
  return db.transaction(async (tx) => {
    const current = (await tx.select().from(lots).where(eq(lots.id, lotId)))[0]!;
    const withdrawn = (await tx
          .update(lots)
          .set({ status: 'withdrawn', remainingKg: 0 })
          .where(eq(lots.id, lotId))
          .returning())[0]!;
    await appendLotEvent(tx, {
            lotId,
            type: 'LOT_WITHDRAWN',
            actorType: 'farmer',
            actorId: farmerId,
            payload: { withdrawnKg: current.remainingKg },
          });
    return withdrawn;
  });
}

async function ownedOpenLot(lotId: string, farmerId: string): Promise<Lot> {
  const lot = await getLot(lotId);
  if (lot.farmerId !== farmerId) throw new DomainError('Not your lot', 'FORBIDDEN', 403);
  if (lot.status !== 'registered' && lot.status !== 'matched') {
    throw new DomainError('This listing is no longer on the market', 'LOT_CLOSED', 409);
  }
  return lot;
}

export interface UpdateLotInput {
  /** New total quantity, in the listing's unit. Can't drop below what is already sold. */
  units?: number;
  askingPricePerUnit?: number | null;
  readyDate?: number;
  community?: string;
  landmark?: string;
}

/** The farmer changes a listing (Phase 1). Any change also renews the listing for another full term. */
export async function updateLot(lotId: string, farmerId: string, input: UpdateLotInput): Promise<Lot> {
  const lot = await ownedOpenLot(lotId, farmerId);
  const unit = (await db.select().from(units).where(eq(units.id, lot.unitId)))[0]!;
  const commodity = getCommodityById(lot.commodityId);
  const now = Date.now();
  const updates: Partial<typeof lots.$inferInsert> = { expiresAt: now + config.LISTING_TTL_DAYS * DAY_MS, expiryWarnedAt: null };
  if (input.units !== undefined) {
    if (!Number.isFinite(input.units) || input.units <= 0) throw new DomainError('Enter how many you have, at least 1', 'INVALID_UNITS');
    const committedKg = lot.quantityKg - lot.remainingKg; // already in orders
    const totalKg = convertToKg(unit, input.units);
    if (totalKg + 1e-9 < committedKg) {
      throw new DomainError(
        `${Math.round(committedKg / unit.kgPerUnit)} are already sold, so the total cannot be less`,
        'BELOW_SOLD',
      );
    }
    Object.assign(updates, { quantityKg: totalKg, unitQty: input.units, remainingKg: totalKg - committedKg });
  }
  if (input.askingPricePerUnit !== undefined) Object.assign(updates, askingPrices(unit.kgPerUnit, input.askingPricePerUnit, null));
  if (input.readyDate !== undefined) {
    const horizon = commodity.clock.allowsForward ? 180 * DAY_MS : DAY_MS;
    if (input.readyDate > now + horizon) throw new DomainError('Ready date is too far in the future', 'READY_DATE_TOO_FAR');
    updates.readyDate = input.readyDate;
  }
  if (input.community !== undefined) updates.community = input.community.trim() || null;
  if (input.landmark !== undefined) updates.landmark = input.landmark.trim() || null;
  const changed = await db.transaction(async (tx) => {
      const updated = (await tx.update(lots).set(updates).where(eq(lots.id, lotId)).returning())[0]!;
      await appendLotEvent(tx, {
              lotId,
              type: 'LOT_UPDATED',
              actorType: 'farmer',
              actorId: farmerId,
              payload: { quantityKg: updated.quantityKg, remainingKg: updated.remainingKg, changed: Object.keys(input) },
            });
      return updated;
    });
  if (input.askingPricePerUnit && changed.askingPricePerKg) {
    await observePrice({ commodityId: changed.commodityId, regionCode: changed.regionCode, pricePerKg: changed.askingPricePerKg, source: 'ask', refId: changed.id });
  }
  return changed;
}

/** Sold elsewhere (market day, a neighbour): off the market, open offers closed, buyers told. */
export async function markLotSold(lotId: string, farmerId: string): Promise<Lot> {
  const lot = await ownedOpenLot(lotId, farmerId);
  for (const contract of (await listContractsForLot(lotId)).filter((c) => c.state === 'OFFERED')) await declineOffer(contract.id, farmerId);
  await closeOffersForLot(lotId, 'withdrawn');
  return db.transaction(async (tx) => {
    const sold = (await tx.update(lots).set({ status: 'sold', remainingKg: 0 }).where(eq(lots.id, lotId)).returning())[0]!;
    await appendLotEvent(tx, { lotId, type: 'LOT_SOLD', actorType: 'farmer', actorId: farmerId, payload: { soldElsewhereKg: lot.remainingKg } });
    return sold;
  });
}

/** Sweep: warn two days before a listing lapses, then take lapsed listings off the market. */
export async function sweepListings(now = Date.now()): Promise<{ warned: number; expired: number }> {
  const open = (await db
      .select()
      .from(lots))
    .filter((l) => (l.status === 'registered' || l.status === 'matched') && l.expiresAt !== null);
  let warned = 0;
  let expired = 0;
  for (const lot of open) {
    const farmer = (await db.select().from(farmers).where(eq(farmers.id, lot.farmerId)))[0];
    const commodity = getCommodityById(lot.commodityId);
    if (lot.expiresAt! <= now) {
      await closeOffersForLot(lot.id, 'expired');
      await db.transaction(async (tx) => {
                (await tx.update(lots).set({ status: 'expired' }).where(eq(lots.id, lot.id)));
                await appendLotEvent(tx, { lotId: lot.id, type: 'LOT_EXPIRED', actorType: 'system', payload: { remainingKg: lot.remainingKg } });
              });
      if (farmer) {
        await queueSms({
                    phone: farmer.phone,
                    locale: farmer.locale,
                    templateKey: 'sms.listingExpired',
                    params: { commodity: t(farmer.locale, commodity.nameKey), lotCode: lot.lotCode, code: config.USSD_SHORTCODE },
                    lotId: lot.id,
                  });
      }
      expired++;
    } else if (lot.expiryWarnedAt === null && lot.expiresAt! - EXPIRY_WARNING_MS <= now) {
      (await db.update(lots).set({ expiryWarnedAt: now }).where(eq(lots.id, lot.id)));
      if (farmer) {
        await queueSms({
                    phone: farmer.phone,
                    locale: farmer.locale,
                    templateKey: 'sms.listingExpiring',
                    params: {
                      commodity: t(farmer.locale, commodity.nameKey),
                      lotCode: lot.lotCode,
                      date: new Date(lot.expiresAt!).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
                      code: config.USSD_SHORTCODE,
                    },
                    lotId: lot.id,
                  });
      }
      warned++;
    }
  }
  return { warned, expired };
}

export async function listLotsByFarmer(farmerId: string): Promise<Lot[]> {
  return (await db.select().from(lots).where(eq(lots.farmerId, farmerId)).orderBy(desc(lots.createdAt)));
}
