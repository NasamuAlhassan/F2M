import { and, eq, gt, inArray, lt } from 'drizzle-orm';
import { db } from '../db/client';
import {
  contracts,
  demands,
  lots,
  matches,
  offers,
  units,
  type Contract,
  type Demand,
  type Lot,
  type Match,
  type Offer,
} from '../db/schema';
import { t } from '../i18n';
import { transitionContract } from '../state/contractMachine';
import { queueBuyerNotification } from './buyerNotifications';
import { DomainError, notFound } from './errors';
import { getFarmerById } from './farmers';
import { haversineKm, resolvePoint } from './geo';
import { getCommodityById } from './registries';
import { engineBid } from './offers';
import { bestBand, formatGhs, priceTermsSchema, type ClockConfig, type GradeBand, type ScoreBreakdown } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
const BAND_RANK: Record<string, number> = { A: 3, B: 2, C: 1 };

const WEIGHTS: Record<'storable' | 'perishable', Record<string, number>> = {
  storable: { quantityFit: 0.25, distance: 0.15, qualityBand: 0.15, windowFit: 0.15, farmerHistory: 0.3 },
  perishable: { quantityFit: 0.2, distance: 0.35, qualityBand: 0.1, windowFit: 0.15, farmerHistory: 0.2 },
};

export interface FarmerStats {
  settled: number;
  defaulted: number;
}

export function farmerStats(farmerId: string): FarmerStats {
  const all = db.select({ state: contracts.state }).from(contracts).where(eq(contracts.farmerId, farmerId)).all();
  return {
    settled: all.filter((c) => c.state === 'SETTLED').length,
    defaulted: all.filter((c) => c.state === 'CANCELLED_REFUNDED').length,
  };
}

/** Pure scorer — fully unit-testable with fixture lots. */
export function scoreLotForDemand(args: {
  lot: Pick<Lot, 'remainingKg' | 'declaredBand' | 'readyDate'>;
  demand: Pick<Demand, 'remainingKg' | 'minBand' | 'windowStart' | 'windowEnd'>;
  clockType: 'storable' | 'perishable';
  clock: ClockConfig;
  distanceKm: number;
  stats: FarmerStats;
}): { score: number; breakdown: ScoreBreakdown } {
  const { lot, demand, clock, distanceKm, stats } = args;
  const weights = WEIGHTS[args.clockType];

  const quantityFit = Math.min(lot.remainingKg, demand.remainingKg) / demand.remainingKg;
  const distance = Math.exp(-distanceKm / clock.distanceDecayKm);
  const lotRank = BAND_RANK[lot.declaredBand] ?? 0;
  const minRank = BAND_RANK[demand.minBand] ?? 0;
  const qualityBand = lotRank >= minRank ? 1.0 : minRank - lotRank === 1 ? 0.6 : 0.2;
  const windowFit =
    lot.readyDate <= demand.windowStart
      ? 1.0
      : Math.max(0, Math.min(1, (demand.windowEnd - lot.readyDate) / (demand.windowEnd - demand.windowStart)));
  const farmerHistory = (stats.settled + 1) / (stats.settled + stats.defaulted + 2);

  const components = { quantityFit, distance, qualityBand, windowFit, farmerHistory };
  const score = Object.entries(components).reduce((sum, [k, v]) => sum + v * (weights[k] ?? 0), 0);
  return { score, breakdown: { ...components, distanceKm: Math.round(distanceKm * 10) / 10, weights } };
}

/** Clock-compatibility hard filter. */
export function clockCompatible(lot: Pick<Lot, 'readyDate'>, demand: Pick<Demand, 'windowStart' | 'windowEnd'>, clock: ClockConfig): boolean {
  if (clock.allowsForward) {
    // Storable: anything ready by the end of the window works (pre-harvest forwards included).
    return lot.readyDate <= demand.windowEnd;
  }
  // Perishable: ready within [windowStart - 1d, windowEnd] — no long forwards.
  return lot.readyDate >= demand.windowStart - DAY_MS && lot.readyDate <= demand.windowEnd;
}

/** What one matching pass produced: offer threads waiting on the farmer (Phase 1). */
export interface OfferResult {
  offer: Offer;
}

/**
 * One entry point for both directions: a new demand sweeps all eligible lots,
 * a new lot sweeps all open demands, and the sweep job re-runs open demands.
 */
export function runMatching(opts: { demandId?: string; lotId?: string } = {}): OfferResult[] {
  const openDemands = opts.demandId
    ? db.select().from(demands).where(eq(demands.id, opts.demandId)).all()
    : db
        .select()
        .from(demands)
        .where(and(inArray(demands.status, ['open', 'partially_matched']), gt(demands.remainingKg, 0)))
        .all();

  const results: OfferResult[] = [];
  for (const demand of openDemands) {
    if (demand.remainingKg <= 0 || (demand.status !== 'open' && demand.status !== 'partially_matched')) continue;
    results.push(...matchDemand(demand, opts.lotId));
  }
  return results;
}

function matchDemand(demand: Demand, onlyLotId?: string): OfferResult[] {
  const commodity = getCommodityById(demand.commodityId);
  const now = Date.now();

  let candidates = db
    .select()
    .from(lots)
    .where(and(eq(lots.commodityId, demand.commodityId), inArray(lots.status, ['registered', 'matched']), gt(lots.remainingKg, 0)))
    .all();
  if (onlyLotId) candidates = candidates.filter((l) => l.id === onlyLotId);
  candidates = candidates.filter((l) => clockCompatible(l, demand, commodity.clock));

  // A lot gets ONE shot per request (D-016): an offer thread that ever existed
  // for this lot+request — open, refused or lapsed — blocks another, so freed
  // quantity flows to other lots instead of looping the same offer. A buyer's
  // own open thread on a lot (a direct bid) also blocks a second one.
  const tried = new Set(
    db
      .select({ lotId: offers.lotId })
      .from(offers)
      .where(eq(offers.demandId, demand.id))
      .all()
      .map((o) => o.lotId),
  );
  for (const m of db.select({ lotId: matches.lotId }).from(matches).where(eq(matches.demandId, demand.id)).all()) tried.add(m.lotId);
  const buyerOpen = new Set(
    db
      .select({ lotId: offers.lotId })
      .from(offers)
      .where(and(eq(offers.buyerId, demand.buyerId), eq(offers.status, 'open')))
      .all()
      .map((o) => o.lotId),
  );
  candidates = candidates.filter((l) => !tried.has(l.id) && !buyerOpen.has(l.id));

  const demandPoint = resolvePoint(demand.gpsLat, demand.gpsLng, demand.regionCode);
  const scored = candidates
    .map((lot) => {
      const lotPoint = resolvePoint(lot.gpsLat, lot.gpsLng, lot.regionCode);
      const { score } = scoreLotForDemand({
        lot,
        demand,
        clockType: commodity.clockType,
        clock: commodity.clock,
        distanceKm: haversineKm(lotPoint, demandPoint),
        stats: farmerStats(lot.farmerId),
      });
      return { lot, score };
    })
    .sort((a, b) => b.score - a.score);

  const priceTerms = priceTermsSchema.parse(JSON.parse(demand.priceTerms));
  const results: OfferResult[] = [];
  let remainingKg = demand.remainingKg;

  for (const { lot } of scored) {
    if (remainingKg <= 0) break;
    const unit = db.select().from(units).where(eq(units.id, lot.unitId)).get();
    if (!unit || unit.kgPerUnit <= 0) continue;
    // Whole units only — a farmer is offered bags, not 8.4 bags.
    const wholeUnits = Math.floor(Math.min(lot.remainingKg, remainingKg) / unit.kgPerUnit + 1e-9);
    if (wholeUnits < 1) continue;
    // The request's price for the grade the farmer declared, per unit.
    const perKg = priceTerms[lot.declaredBand as GradeBand] ?? priceTerms[demand.minBand as GradeBand] ?? 0;
    if (perKg <= 0) continue;
    const offer = engineBid({ demandId: demand.id, lot, units: wholeUnits, pricePerUnit: Math.round(perKg * unit.kgPerUnit) });
    remainingKg -= wholeUnits * unit.kgPerUnit;
    results.push({ offer });
  }
  return results;
}

/** Expire demands whose delivery window has closed. Sweep-driven. */
export function expireDemands(now = Date.now()): number {
  const stale = db
    .select()
    .from(demands)
    .where(and(inArray(demands.status, ['open', 'partially_matched']), lt(demands.windowEnd, now)))
    .all();
  for (const demand of stale) {
    db.update(demands).set({ status: 'expired' }).where(eq(demands.id, demand.id)).run();
  }
  return stale.length;
}

/** Expire offers past their clock TTL, release reservations, and rematch. Sweep-driven. */
export function expireOffers(now = Date.now()): number {
  const expired = db
    .select()
    .from(matches)
    .where(and(eq(matches.status, 'offered'), lt(matches.expiresAt, now)))
    .all();

  const touchedDemands = new Set<string>();
  for (const match of expired) {
    const contract = db.select().from(contracts).where(eq(contracts.matchId, match.id)).get();
    if (!contract || contract.state !== 'OFFERED') continue;
    const expiredContract = transitionContract(contract.id, 'EXPIRED', { type: 'system' });
    notifyBuyerOfferEvent(expiredContract, 'notif.offerExpired');
    touchedDemands.add(contract.demandId);
  }
  // Freed quantity may match someone else immediately.
  for (const demandId of touchedDemands) runMatching({ demandId });
  return expired.length;
}

/** In-app alert to the buyer about an offer outcome (M15 fan-out). */
function notifyBuyerOfferEvent(contract: Contract, templateKey: string): void {
  const farmer = getFarmerById(contract.farmerId);
  const commodity = getCommodityById(contract.commodityId);
  queueBuyerNotification({
    buyerId: contract.buyerId,
    templateKey,
    params: { farmer: farmer?.name ?? 'Farmer', kg: contract.quantityKg, commodity: t('en', commodity.nameKey) },
    contractId: contract.id,
    lotId: contract.lotId,
    demandId: contract.demandId,
  });
}

export function getMatch(id: string): Match {
  const match = db.select().from(matches).where(eq(matches.id, id)).get();
  if (!match) throw notFound('match');
  return match;
}

export function listMatchesForDemand(demandId: string): Array<Match & { breakdown: ScoreBreakdown }> {
  return db
    .select()
    .from(matches)
    .where(eq(matches.demandId, demandId))
    .all()
    .map((m) => ({ ...m, breakdown: JSON.parse(m.scoreBreakdown) as ScoreBreakdown }))
    .sort((a, b) => b.score - a.score);
}

/** Farmer-facing accept: guarded by the state machine, expiry-checked here. */
export function acceptOffer(contractId: string, farmerId: string): Contract {
  const contract = db.select().from(contracts).where(eq(contracts.id, contractId)).get();
  if (!contract) throw notFound('contract');
  const match = getMatch(contract.matchId);
  if (contract.state === 'OFFERED' && match.expiresAt && match.expiresAt < Date.now()) {
    transitionContract(contract.id, 'EXPIRED', { type: 'system' });
    throw new DomainError('This offer has expired', 'OFFER_EXPIRED', 409);
  }
  const accepted = transitionContract(contractId, 'ACCEPTED', { type: 'farmer', id: farmerId });
  notifyBuyerOfferEvent(accepted, 'notif.offerAccepted');
  return accepted;
}

export function declineOffer(contractId: string, farmerId: string, reasonKey?: string): Contract {
  const declined = transitionContract(contractId, 'DECLINED', { type: 'farmer', id: farmerId }, { declineReasonKey: reasonKey });
  notifyBuyerOfferEvent(declined, 'notif.offerDeclined');
  return declined;
}

export { type GradeBand };
