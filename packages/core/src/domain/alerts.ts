import { and, desc, eq, gt, gte, inArray, isNotNull } from 'drizzle-orm';
import { config } from '../config';
import { db } from '../db/client';
import {
  alertLog,
  buyers,
  contracts,
  demands,
  farmers,
  lots,
  offers,
  priceWatches,
  units,
  type Lot,
  type PriceWatch,
  type WatchKind,
} from '../db/schema';
import { t } from '../i18n';
import { queueBuyerNotification } from './buyerNotifications';
import { DomainError, notFound } from './errors';
import { publishLive } from './events';
import { haversineKm, resolvePoint } from './geo';
import { queueSms } from './notifications';
import { estimatePrice, priceGuidance, priceTrend } from './priceIntel';
import { getCommodityByCode, getCommodityById, listCommodities } from './registries';
import { formatGhs } from './types';

/**
 * Smart alerts (D-055): when something new appears, tell the people it matters
 * to, once, and never in bulk.
 *
 *  - A new listing reaches buyers who asked to watch that crop, who have an open
 *    request for it, or who have bought it before — nearest first.
 *  - A new buyer request reaches farmers who have sold that crop before, or
 *    asked to hear of it, and have nothing listed yet (those with a listing
 *    already get a matched offer from the engine).
 *  - A market price that crosses a person's line, or moves sharply, reaches the
 *    people it touches.
 *
 * It is rules over the data, not a model: every alert can be explained by "you
 * asked", "you have a request", "you sold this", or "you listed it". Each goes
 * out at most once per subject, a farmer gets few SMS a day, and a failure here
 * never stops the listing or request that triggered it.
 */

const DAY = 24 * 60 * 60 * 1000;
/** Someone who bought this crop within this long is a repeat buyer. */
const REPEAT_BUYER_DAYS = 180;
/** A farmer who listed this crop within this long still "grows" it. */
const FARMER_HISTORY_DAYS = 365;
const MAX_WATCHES_PER_PERSON = 20;

// ── The log: one alert per subject, and a daily ceiling ──────────────────────

/** Record that this person was told about this subject. False when they already were. */
function claim(kind: string, recipient: string, subject: string): boolean {
  return db.insert(alertLog).values({ kind, recipient, subject }).onConflictDoNothing().run().changes > 0;
}

function alertsToday(recipient: string, now = Date.now()): number {
  return db
    .select()
    .from(alertLog)
    .where(and(eq(alertLog.recipient, recipient), gte(alertLog.createdAt, now - DAY)))
    .all().length;
}

const placeOf = (lot: Pick<Lot, 'community' | 'regionCode'>, locale = 'en') => lot.community?.trim() || t(locale, `region.${lot.regionCode}`);

function unitNameOf(unitId: string, locale = 'en'): string {
  const unit = db.select().from(units).where(eq(units.id, unitId)).get();
  return unit ? t(locale, unit.nameKey) : 'unit';
}

// ── Watches: what a person asked to be told ──────────────────────────────────

export interface WatchInput {
  role: 'buyer' | 'farmer';
  ownerId: string;
  commodityCode: string;
  regionCode?: string | null;
  kind: WatchKind;
  /** Pesewas per kg. */
  thresholdPerKg: number;
}

export function createWatch(input: WatchInput): PriceWatch {
  if (!Number.isInteger(input.thresholdPerKg) || input.thresholdPerKg <= 0 || input.thresholdPerKg > 100_000) {
    throw new DomainError('Enter a price per kg above zero', 'INVALID_PRICE');
  }
  const commodity = getCommodityByCode(input.commodityCode);
  const mine = db.select().from(priceWatches).where(and(eq(priceWatches.role, input.role), eq(priceWatches.ownerId, input.ownerId))).all();
  if (mine.length >= MAX_WATCHES_PER_PERSON) {
    throw new DomainError(`You can keep up to ${MAX_WATCHES_PER_PERSON} alerts. Remove one first.`, 'TOO_MANY_WATCHES', 409);
  }
  const same = mine.find(
    (w) => w.commodityId === commodity.id && w.kind === input.kind && (w.regionCode ?? null) === (input.regionCode ?? null),
  );
  if (same) {
    // Asking again for the same thing changes its line instead of doubling it.
    return db.update(priceWatches).set({ thresholdPerKg: input.thresholdPerKg, lastNotifiedAt: null }).where(eq(priceWatches.id, same.id)).returning().get()!;
  }
  return db
    .insert(priceWatches)
    .values({ role: input.role, ownerId: input.ownerId, commodityId: commodity.id, regionCode: input.regionCode ?? null, kind: input.kind, thresholdPerKg: input.thresholdPerKg })
    .returning()
    .get();
}

export function listWatches(role: 'buyer' | 'farmer', ownerId: string): PriceWatch[] {
  return db
    .select()
    .from(priceWatches)
    .where(and(eq(priceWatches.role, role), eq(priceWatches.ownerId, ownerId)))
    .orderBy(desc(priceWatches.createdAt))
    .all();
}

export function deleteWatch(id: string, role: 'buyer' | 'farmer', ownerId: string): void {
  const w = db.select().from(priceWatches).where(eq(priceWatches.id, id)).get();
  if (!w || w.role !== role || w.ownerId !== ownerId) throw notFound('alert');
  db.delete(priceWatches).where(eq(priceWatches.id, id)).run();
}

// ── Telling people ───────────────────────────────────────────────────────────

function tellBuyer(buyerId: string, templateKey: string, params: Record<string, string | number>, ref: { lotId?: string; demandId?: string } = {}): void {
  queueBuyerNotification({ buyerId, templateKey, params, lotId: ref.lotId, demandId: ref.demandId });
  publishLive({ topic: 'alerts', audience: [`buyer:${buyerId}`] });
}

/** Text a farmer in her own language. Counts toward her daily ceiling. */
function tellFarmer(farmerId: string, templateKey: string, params: (locale: string) => Record<string, string | number>, ref: { lotId?: string } = {}): void {
  const farmer = db.select().from(farmers).where(eq(farmers.id, farmerId)).get();
  if (!farmer) return;
  queueSms({ phone: farmer.phone, locale: farmer.locale, templateKey, params: params(farmer.locale), lotId: ref.lotId });
  publishLive({ topic: 'alerts', audience: [`farmer:${farmerId}`] });
}

// ── 1. A new listing → the buyers it matters to ──────────────────────────────

interface Candidate {
  id: string;
  score: number;
  why: 'watch' | 'request' | 'repeat';
}

const WHY_TEXT: Record<Candidate['why'], string> = {
  watch: 'You asked to hear about this crop.',
  request: 'It fits your open request.',
  repeat: 'You have bought this crop before.',
};

export function alertOnNewLot(lotId: string, now = Date.now()): number {
  const lot = db.select().from(lots).where(eq(lots.id, lotId)).get();
  if (!lot || (lot.status !== 'registered' && lot.status !== 'matched') || lot.remainingKg <= 0) return 0;
  const commodity = getCommodityById(lot.commodityId);
  const lotPoint = resolvePoint(lot.gpsLat, lot.gpsLng, lot.regionCode);
  const found = new Map<string, Candidate>();
  const consider = (buyerId: string, why: Candidate['why'], base: number) => {
    const buyer = db.select().from(buyers).where(eq(buyers.id, buyerId)).get();
    if (!buyer) return;
    const km = haversineKm(lotPoint, resolvePoint(buyer.gpsLat, buyer.gpsLng, buyer.regionCode ?? 'GREATER_ACCRA'));
    const score = base + Math.exp(-km / commodity.clock.distanceDecayKm);
    const had = found.get(buyerId);
    if (!had || score > had.score) found.set(buyerId, { id: buyerId, score, why: had && had.score > score ? had.why : why });
  };

  // Asked to be told: a 'listing' watch for this crop, in this region (or anywhere), at or under their line.
  for (const w of db.select().from(priceWatches).where(and(eq(priceWatches.commodityId, lot.commodityId), eq(priceWatches.kind, 'listing'), eq(priceWatches.role, 'buyer'))).all()) {
    if (w.regionCode && w.regionCode !== lot.regionCode) continue;
    if (lot.askingPricePerKg !== null && lot.askingPricePerKg > w.thresholdPerKg) continue;
    consider(w.ownerId, 'watch', 3);
  }
  // An open request for this crop that the engine will already bid on is told by that bid, so only the rest hear from us.
  const open = db
    .select()
    .from(demands)
    .where(and(eq(demands.commodityId, lot.commodityId), eq(demands.origin, 'request'), inArray(demands.status, ['open', 'partially_matched']), gt(demands.windowEnd, now)))
    .all();
  for (const d of open) consider(d.buyerId, 'request', 2);
  // People who have bought this crop lately.
  for (const c of db
    .select({ buyerId: contracts.buyerId })
    .from(contracts)
    .where(and(eq(contracts.commodityId, lot.commodityId), isNotNull(contracts.acceptedAt), gte(contracts.acceptedAt, now - REPEAT_BUYER_DAYS * DAY)))
    .all()) {
    consider(c.buyerId, 'repeat', 1);
  }

  const alreadyBidding = new Set(db.select().from(offers).where(and(eq(offers.lotId, lot.id), eq(offers.status, 'open'))).all().map((o) => o.buyerId));
  const farmer = db.select().from(farmers).where(eq(farmers.id, lot.farmerId)).get();
  const unit = unitNameOf(lot.unitId);

  // How the asking price sits against the market is the most useful single fact for a buyer.
  let priceNote = '';
  let ask = '';
  if (lot.askingPricePerUnit) {
    ask = ` at ${formatGhs(lot.askingPricePerUnit)} per ${unit.toLowerCase()}`;
    const unitRow = db.select().from(units).where(eq(units.id, lot.unitId)).get();
    try {
      const g = priceGuidance({ commodityCode: commodity.code, side: 'buy', unitCode: unitRow?.code, regionCode: lot.regionCode, price: lot.askingPricePerUnit, now });
      if (g.deviation !== null && g.estimate && g.estimate.confidence !== 'reference' && g.estimate.confidence !== 'low') {
        const pct = Math.round(Math.abs(g.deviation) * 100);
        if (g.deviation <= -0.05) priceNote = ` That is about ${pct}% under the market.`;
        else if (g.deviation >= 0.1) priceNote = ` That is about ${pct}% over the market.`;
      }
    } catch {
      // advice is a bonus; the alert goes out without it
    }
  }

  let sent = 0;
  const ranked = [...found.values()].filter((c) => !alreadyBidding.has(c.id)).sort((a, b) => b.score - a.score);
  for (const c of ranked) {
    if (sent >= config.ALERT_MAX_RECIPIENTS) break;
    if (!claim('lot_match', `buyer:${c.id}`, lot.id)) continue;
    tellBuyer(
      c.id,
      'notif.newListing',
      {
        farmer: farmer?.name ?? 'A farmer',
        qty: lot.unitQty,
        unit: unit.toLowerCase(),
        commodity: t('en', commodity.nameKey),
        place: placeOf(lot),
        ask,
        priceNote,
        why: WHY_TEXT[c.why],
      },
      { lotId: lot.id },
    );
    sent += 1;
  }
  return sent;
}

// ── 2. A new buyer request → the farmers who could supply it ─────────────────

export function alertOnNewRequest(demandId: string, now = Date.now()): number {
  const demand = db.select().from(demands).where(eq(demands.id, demandId)).get();
  if (!demand || demand.origin !== 'request' || demand.remainingKg <= 0) return 0;
  const commodity = getCommodityById(demand.commodityId);
  const demandPoint = resolvePoint(demand.gpsLat, demand.gpsLng, demand.regionCode);
  const wanted = (JSON.parse(demand.priceTerms) as Record<string, number>)[demand.minBand] ?? 0;
  const reach = commodity.clock.distanceDecayKm * 3; // beyond this the haul eats the price

  const found = new Map<string, { id: string; score: number }>();
  const consider = (farmerId: string, base: number) => {
    const f = db.select().from(farmers).where(eq(farmers.id, farmerId)).get();
    if (!f) return;
    const km = haversineKm(demandPoint, resolvePoint(f.gpsLat, f.gpsLng, f.regionCode));
    if (km > reach) return;
    const score = base + Math.exp(-km / commodity.clock.distanceDecayKm);
    if (!found.has(farmerId) || found.get(farmerId)!.score < score) found.set(farmerId, { id: farmerId, score });
  };

  // Asked to hear of requests for this crop at or above a price.
  for (const w of db.select().from(priceWatches).where(and(eq(priceWatches.commodityId, demand.commodityId), eq(priceWatches.kind, 'listing'), eq(priceWatches.role, 'farmer'))).all()) {
    if (w.regionCode && w.regionCode !== demand.regionCode) continue;
    if (wanted < w.thresholdPerKg) continue;
    consider(w.ownerId, 2);
  }
  // Farmers who have listed this crop in the last year.
  const sold = db
    .select({ farmerId: lots.farmerId })
    .from(lots)
    .where(and(eq(lots.commodityId, demand.commodityId), gte(lots.createdAt, now - FARMER_HISTORY_DAYS * DAY)))
    .all();
  for (const l of sold) consider(l.farmerId, 1);

  // Whoever already has this crop on the market was matched by the engine and has a bid waiting.
  const listed = new Set(
    db
      .select({ farmerId: lots.farmerId })
      .from(lots)
      .where(and(eq(lots.commodityId, demand.commodityId), inArray(lots.status, ['registered', 'matched']), gt(lots.remainingKg, 0)))
      .all()
      .map((l) => l.farmerId),
  );
  const bidding = new Set(db.select().from(offers).where(and(eq(offers.demandId, demand.id), eq(offers.status, 'open'))).all().map((o) => o.farmerId));

  let sent = 0;
  const ranked = [...found.values()].filter((c) => !listed.has(c.id) && !bidding.has(c.id)).sort((a, b) => b.score - a.score);
  for (const c of ranked) {
    if (sent >= config.ALERT_MAX_RECIPIENTS) break;
    if (alertsToday(`farmer:${c.id}`, now) >= config.ALERT_SMS_PER_FARMER_PER_DAY) continue; // a farmer is not a notification feed
    if (!claim('request_nearby', `farmer:${c.id}`, demand.id)) continue;
    tellFarmer(c.id, 'sms.requestNearby', (locale) => ({
      kg: Math.round(demand.remainingKg),
      commodity: t(locale, commodity.nameKey),
      price: formatGhs(wanted),
      place: t(locale, `region.${demand.regionCode}`),
      code: config.USSD_SHORTCODE,
    }));
    sent += 1;
  }
  return sent;
}

// ── 3. The market moves → the people it touches ──────────────────────────────

/** Calendar week, so a crop's move is announced once a week at most. */
const weekOf = (ms: number) => Math.floor(ms / (7 * DAY));
/** A price line that has been crossed is announced once, then left alone for this long. */
const WATCH_COOLDOWN = 7 * DAY;

/**
 * Run from the sweep: price lines crossed, and sharp moves. Cheap when nothing
 * has happened. A price based on little data never triggers an alert.
 */
export function sweepAlerts(now = Date.now()): { watches: number; moves: number } {
  let watches = 0;
  let moves = 0;

  // Lines crossed. Listing watches are handled when the listing appears, not here.
  for (const w of db.select().from(priceWatches).all()) {
    if (w.kind === 'listing') continue;
    if (w.lastNotifiedAt && now - w.lastNotifiedAt < WATCH_COOLDOWN) continue;
    const e = estimatePrice(w.commodityId, { regionCode: w.regionCode, now });
    if (!e || e.confidence === 'low' || e.confidence === 'reference') continue;
    const crossed = w.kind === 'price_above' ? e.pricePerKg >= w.thresholdPerKg : e.pricePerKg <= w.thresholdPerKg;
    if (!crossed) continue;
    const commodity = getCommodityById(w.commodityId);
    const recipient = `${w.role}:${w.ownerId}`;
    if (!claim('watch_price', recipient, `${w.id}:${weekOf(now)}`)) continue;
    db.update(priceWatches).set({ lastNotifiedAt: now }).where(eq(priceWatches.id, w.id)).run();
    const common = { price: formatGhs(e.pricePerKg), line: formatGhs(w.thresholdPerKg) };
    const side = w.kind === 'price_above' ? 'Above' : 'Below'; // separate phrases, so each language words it whole
    if (w.role === 'buyer') {
      tellBuyer(w.ownerId, `notif.priceWatch${side}`, { commodity: t('en', commodity.nameKey), ...common });
    } else {
      tellFarmer(w.ownerId, `sms.priceWatch${side}`, (locale) => ({ commodity: t(locale, commodity.nameKey), ...common }));
    }
    watches += 1;
  }

  // Sharp moves: tell sellers when it is a good time to ask more, and buyers when their request may be too low.
  for (const commodity of listCommodities()) {
    const trend = priceTrend(commodity.id, { windowDays: 14, now });
    const e = estimatePrice(commodity.id, { now });
    if (!trend || !e || e.confidence === 'reference' || e.confidence === 'low') continue;
    if (Math.abs(trend.change) < config.ALERT_PRICE_MOVE_PCT / 100) continue;
    const dir = trend.direction;
    const subject = `${commodity.code}:${dir}:${weekOf(now)}`;
    const pct = Math.round(Math.abs(trend.change) * 100);

    const sellers = new Set(
      db.select({ farmerId: lots.farmerId }).from(lots).where(and(eq(lots.commodityId, commodity.id), inArray(lots.status, ['registered', 'matched']), gt(lots.remainingKg, 0))).all().map((l) => l.farmerId),
    );
    for (const farmerId of sellers) {
      if (alertsToday(`farmer:${farmerId}`, now) >= config.ALERT_SMS_PER_FARMER_PER_DAY) continue;
      if (!claim('price_move', `farmer:${farmerId}`, subject)) continue;
      tellFarmer(farmerId, dir === 'rising' ? 'sms.priceUp' : 'sms.priceDown', (locale) => ({ commodity: t(locale, commodity.nameKey), pct, price: formatGhs(e.pricePerKg) }));
      moves += 1;
    }
    const askers = new Set(
      db.select({ buyerId: demands.buyerId }).from(demands).where(and(eq(demands.commodityId, commodity.id), eq(demands.origin, 'request'), inArray(demands.status, ['open', 'partially_matched']), gt(demands.windowEnd, now))).all().map((d) => d.buyerId),
    );
    for (const buyerId of askers) {
      if (!claim('price_move', `buyer:${buyerId}`, subject)) continue;
      tellBuyer(buyerId, dir === 'rising' ? 'notif.priceUp' : 'notif.priceDown', { commodity: t('en', commodity.nameKey), pct, price: formatGhs(e.pricePerKg) });
      moves += 1;
    }
  }
  return { watches, moves };
}

/** Safe wrappers for the triggers: an alert problem must never undo the listing or request that caused it. */
export function tryAlertOnNewLot(lotId: string): void {
  try {
    alertOnNewLot(lotId);
  } catch {
    // swallowed on purpose — see above
  }
}
export function tryAlertOnNewRequest(demandId: string): void {
  try {
    alertOnNewRequest(demandId);
  } catch {
    // swallowed on purpose — see above
  }
}

export { WATCH_KINDS, type WatchKind } from '../db/schema';
