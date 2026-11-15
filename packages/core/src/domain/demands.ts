import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { buyers, demands, type Demand } from '../db/schema';
import { DomainError, notFound } from './errors';
import { runMatching } from './matching';
import { tryAlertOnNewRequest } from './alerts';
import { publishLive } from './events';
import { observePrice } from './priceIntel';
import { convertToKg, getCommodityByCode, getRegion, getUnit } from './registries';
import {
  expandPriceTerms,
  gradeBandSchema,
  priceTermsSchema,
  type GradeBand,
  type PriceTerms,
} from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CreateDemandInput {
  buyerId: string;
  commodityCode: string;
  /** Either canonical kg directly, or a unit quote converted at intake. */
  quantityKg?: number;
  unitCode?: string;
  unitQty?: number;
  minBand: GradeBand;
  /** Base price (pesewas/kg) for the minimum acceptable band; expanded via multipliers... */
  basePricePerKg?: number;
  /** ...or an explicit per-band schedule from the portal's price editor. */
  priceTerms?: PriceTerms;
  windowStart: number;
  windowEnd: number;
  regionCode: string;
  gpsLat?: number;
  gpsLng?: number;
}

export async function createDemand(input: CreateDemandInput): Promise<Demand> {
  const buyer = (await db.select().from(buyers).where(eq(buyers.id, input.buyerId)))[0];
  if (!buyer) throw notFound('buyer');
  const commodity = getCommodityByCode(input.commodityCode);
  getRegion(input.regionCode);

  const minBand = gradeBandSchema.parse(input.minBand);
  if (minBand === 'REJECT') throw new DomainError('Minimum band cannot be REJECT', 'INVALID_BAND');

  let quantityKg = input.quantityKg;
  if (quantityKg === undefined) {
    if (!input.unitCode || input.unitQty === undefined) {
      throw new DomainError('Provide quantityKg or unitCode+unitQty', 'INVALID_QUANTITY');
    }
    quantityKg = convertToKg(getUnit(commodity.id, input.unitCode), input.unitQty);
  }
  if (quantityKg <= 0) throw new DomainError('Quantity must be positive', 'INVALID_QUANTITY');

  const now = Date.now();
  if (input.windowEnd <= input.windowStart) {
    throw new DomainError('Delivery window must end after it starts', 'INVALID_WINDOW');
  }
  if (input.windowEnd < now) throw new DomainError('Delivery window is in the past', 'INVALID_WINDOW');
  // The commodity clock constrains the window: tomato demand cannot book next month.
  if (input.windowEnd > now + commodity.clock.maxWindowDays * DAY_MS) {
    throw new DomainError(
      `Delivery window exceeds ${commodity.clock.maxWindowDays} days for ${commodity.code}`,
      'WINDOW_TOO_FAR',
    );
  }

  let priceTerms: PriceTerms;
  if (input.priceTerms) {
    priceTerms = priceTermsSchema.parse(input.priceTerms);
    if (priceTerms.REJECT !== 0) throw new DomainError('REJECT price must be 0', 'INVALID_PRICE_TERMS');
  } else if (input.basePricePerKg && input.basePricePerKg > 0) {
    priceTerms = expandPriceTerms(input.basePricePerKg, minBand);
  } else {
    throw new DomainError('Provide basePricePerKg or priceTerms', 'INVALID_PRICE_TERMS');
  }

  const demand = (await db
        .insert(demands)
        .values({
          buyerId: buyer.id,
          commodityId: commodity.id,
          quantityKg,
          remainingKg: quantityKg,
          minBand,
          priceTerms: JSON.stringify(priceTerms),
          windowStart: input.windowStart,
          windowEnd: input.windowEnd,
          regionCode: input.regionCode,
          gpsLat: input.gpsLat ?? buyer.gpsLat,
          gpsLng: input.gpsLng ?? buyer.gpsLng,
        })
        .returning())[0]!;

  // What the buyer is prepared to pay for the lowest grade they accept is a market signal too (D-053).
  const wantedPerKg = priceTerms[minBand as keyof PriceTerms] as number | undefined;
  if (wantedPerKg && wantedPerKg > 0) {
    await observePrice({ commodityId: commodity.id, regionCode: input.regionCode, pricePerKg: wantedPerKg, source: 'request', refId: demand.id });
  }

  publishLive({ topic: 'demands', audience: ['all'], ref: { demandId: demand.id } });

  // Matching runs the moment demand lands (and again on lot registration + sweep).
  await runMatching({ demandId: demand.id });
  await tryAlertOnNewRequest(demand.id); // farmers who could supply it, and have nothing listed yet (D-055)
  return getDemand(demand.id); // re-read: matching may have moved it to partially_matched/fulfilled
}

/**
 * Open buyer requests (Phase 1) — public to every farmer: still wanting
 * kilograms, window not over, and a real request (never the record behind a
 * negotiated deal). Optionally one crop only.
 */
export async function listOpenRequests(opts: { commodityId?: string; now?: number } = {}): Promise<Demand[]> {
  const now = opts.now ?? Date.now();
  return (await db
      .select()
      .from(demands)
      .where(
        and(
          eq(demands.origin, 'request'),
          inArray(demands.status, ['open', 'partially_matched']),
          gt(demands.remainingKg, 0),
          gt(demands.windowEnd, now),
          ...(opts.commodityId ? [eq(demands.commodityId, opts.commodityId)] : []),
        ),
      )
      .orderBy(desc(demands.createdAt)));
}

export async function getDemand(id: string): Promise<Demand> {
  const demand = (await db.select().from(demands).where(eq(demands.id, id)))[0];
  if (!demand) throw notFound('demand');
  return demand;
}

export async function listDemandsByBuyer(buyerId: string): Promise<Demand[]> {
  return (await db.select().from(demands).where(eq(demands.buyerId, buyerId)).orderBy(desc(demands.createdAt)));
}

export function demandPriceTerms(demand: Demand): PriceTerms {
  return priceTermsSchema.parse(JSON.parse(demand.priceTerms));
}
