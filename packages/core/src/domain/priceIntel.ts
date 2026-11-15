import { and, asc, desc, eq, gte, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { lots, demands, priceObservations, type PriceObservation, type PriceSource } from '../db/schema';
import { t } from '../i18n';
import { publishLive } from './events';
import { DomainError } from './errors';
import { getCommodityByCode, getCommodityById, getUnit, listCommodities } from './registries';
import { formatGhs } from './types';

/**
 * Price intelligence (D-053): what a crop is worth right now, which way it is
 * moving, and whether a price someone is about to type is sensible.
 *
 * Everything here is arithmetic over `price_observations` — no model decides a
 * price. An AI may later phrase the result; it never produces the number.
 */

const DAY = 24 * 60 * 60 * 1000;

/** How far each kind of evidence is trusted. Money that moved counts most; a hope counts least. */
export const SOURCE_WEIGHT: Record<PriceSource, number> = {
  deal: 1,
  market: 0.8,
  ask: 0.5,
  offer: 0.35,
  request: 0.35,
  reference: 0.15,
};

/** Evidence loses half its weight every this many days — "latest" really means latest. */
const HALF_LIFE_DAYS = 21;
/** Nothing older than this speaks for today's price. */
const MAX_AGE_DAYS = 180;
/** Prices from another region still count, a little less. */
const OTHER_REGION_FACTOR = 0.6;
/** A price above GHS 1,000/kg is a typo, not a price. */
const MAX_PRICE_PER_KG = 100_000;

export interface RecordPriceInput {
  commodityId: string;
  regionCode?: string | null;
  market?: string | null;
  /** Pesewas per kg. */
  pricePerKg: number;
  source: PriceSource;
  dataset?: string | null;
  refId?: string | null;
  observedAt?: number;
}

/**
 * Remember a price. With a `refId` the same thing seen again updates its row
 * (a listing whose price changed, an import run twice) instead of adding one.
 */
export async function recordPrice(input: RecordPriceInput): Promise<PriceObservation> {
  if (!Number.isFinite(input.pricePerKg) || input.pricePerKg <= 0 || input.pricePerKg > MAX_PRICE_PER_KG) {
    throw new DomainError('That price per kg is outside what we record', 'INVALID_PRICE');
  }
  const values = {
    commodityId: input.commodityId,
    regionCode: input.regionCode ?? null,
    market: input.market ?? null,
    pricePerKg: Math.round(input.pricePerKg),
    source: input.source,
    dataset: input.dataset ?? null,
    refId: input.refId ?? null,
    observedAt: input.observedAt ?? Date.now(),
  };
  const row = (await db
        .insert(priceObservations)
        .values(values)
        .onConflictDoUpdate({
          target: [priceObservations.source, priceObservations.refId],
          set: { pricePerKg: values.pricePerKg, observedAt: values.observedAt, regionCode: values.regionCode, market: values.market },
        })
        .returning())[0]!;
  publishLive({ topic: 'prices', audience: ['all'], ref: { commodityId: row.commodityId } });
  return row;
}

/**
 * Record a price as a side effect of something else happening (a listing, a bid,
 * a deal). Never throws: a price we cannot record must not stop a farmer listing
 * or a buyer paying.
 */
export async function observePrice(input: RecordPriceInput): Promise<void> {
  try {
    await recordPrice(input);
  } catch {
    // outside what we record, or a transient write — the trade itself carries on
  }
}

/** Bumped when the history the cached seasonality is built from changes (an import) — not on every live price. */
let priceCacheEpoch = 0;
export function clearPriceCaches(): void {
  priceCacheEpoch += 1;
  seasonCache.clear();
  publishLive({ topic: 'prices', audience: ['all'] }); // a bulk import or feed landed
}

// ── Weighted statistics ─────────────────────────────────────────────────────

interface Weighted {
  v: number;
  w: number;
}

/** Quantile of weighted values, interpolating between neighbours (q in 0..1). */
export function weightedQuantile(items: Weighted[], q: number): number {
  if (items.length === 0) throw new Error('weightedQuantile of nothing');
  const sorted = [...items].sort((a, b) => a.v - b.v);
  const total = sorted.reduce((s, i) => s + i.w, 0);
  let acc = 0;
  const pos = sorted.map((i) => {
    acc += i.w;
    return (acc - i.w / 2) / total;
  });
  if (q <= pos[0]!) return sorted[0]!.v;
  if (q >= pos[pos.length - 1]!) return sorted[sorted.length - 1]!.v;
  for (let i = 0; i < pos.length - 1; i += 1) {
    if (q >= pos[i]! && q <= pos[i + 1]!) {
      const span = pos[i + 1]! - pos[i]!;
      const f = span === 0 ? 0 : (q - pos[i]!) / span;
      return sorted[i]!.v + f * (sorted[i + 1]!.v - sorted[i]!.v);
    }
  }
  return sorted[sorted.length - 1]!.v;
}

/** Drop prices more than 3× above or below the weighted median — a stray extra zero must not move the market. */
function trimOutliers(items: Weighted[]): Weighted[] {
  if (items.length < 4) return items;
  const m = weightedQuantile(items, 0.5);
  const kept = items.filter((i) => i.v >= m / 3 && i.v <= m * 3);
  return kept.length > 0 ? kept : items;
}

function effectiveSampleSize(items: Weighted[]): number {
  const sum = items.reduce((s, i) => s + i.w, 0);
  const sq = items.reduce((s, i) => s + i.w * i.w, 0);
  return sq === 0 ? 0 : (sum * sum) / sq;
}

// ── The fair-price estimate ─────────────────────────────────────────────────

export type Confidence = 'high' | 'medium' | 'low' | 'reference';

export interface PriceEstimate {
  /** Pesewas per kg. */
  pricePerKg: number;
  lowPerKg: number;
  highPerKg: number;
  confidence: Confidence;
  /** How many observations it rests on, by kind. */
  basis: Partial<Record<PriceSource, number>>;
  count: number;
  newestAt: number;
  /** 'region' when the farmer's own region carries real weight, else the national picture. */
  scope: 'region' | 'national';
}

async function loadObservations(commodityId: string, since: number): Promise<PriceObservation[]> {
  return (await db
      .select()
      .from(priceObservations)
      .where(and(eq(priceObservations.commodityId, commodityId), gte(priceObservations.observedAt, since)))
      .orderBy(asc(priceObservations.observedAt)));
}

function weigh(o: PriceObservation, now: number, regionCode?: string | null): number {
  const ageDays = Math.max(0, (now - o.observedAt) / DAY);
  const decay = 0.5 ** (ageDays / HALF_LIFE_DAYS);
  const region = regionCode && o.regionCode && o.regionCode !== regionCode ? OTHER_REGION_FACTOR : 1;
  return SOURCE_WEIGHT[o.source] * decay * region;
}

/**
 * What this crop is worth per kg now. Recent deals and market reports lead;
 * asks and offers inform; seed placeholders only speak when nothing else does,
 * and say so. Returns null when there is nothing fresh enough to stand on —
 * never a stale number dressed up as today's.
 */
export async function estimatePrice(
  commodityId: string,
  opts: { regionCode?: string | null; now?: number } = {},
): Promise<PriceEstimate | null> {
  const now = opts.now ?? Date.now();
  const all = (await loadObservations(commodityId, now - MAX_AGE_DAYS * DAY)).filter((o) => o.observedAt <= now);
  const live = all.filter((o) => o.source !== 'reference');
  const pool = live.length > 0 ? live : all; // placeholders only as a last resort
  if (pool.length === 0) return null;

  const items = trimOutliers(pool.map((o) => ({ v: o.pricePerKg, w: weigh(o, now, opts.regionCode) })));
  const median = weightedQuantile(items, 0.5);
  // A fair band is never narrower than ±8% — two similar quotes are not certainty.
  const lowPerKg = Math.round(Math.min(weightedQuantile(items, 0.25), median * 0.92));
  const highPerKg = Math.round(Math.max(weightedQuantile(items, 0.75), median * 1.08));

  const basis: Partial<Record<PriceSource, number>> = {};
  for (const o of pool) basis[o.source] = (basis[o.source] ?? 0) + 1;
  const newestAt = Math.max(...pool.map((o) => o.observedAt));
  const ess = effectiveSampleSize(items);
  const freshDays = (now - newestAt) / DAY;
  const solid = (basis.deal ?? 0) + (basis.market ?? 0);

  let confidence: Confidence;
  if (live.length === 0) confidence = 'reference';
  else if (ess >= 5 && freshDays <= 14 && solid >= 2) confidence = 'high';
  else if (ess >= 2.5 && freshDays <= 45) confidence = 'medium';
  else confidence = 'low';

  const inRegion = opts.regionCode ? pool.filter((o) => o.regionCode === opts.regionCode).length : 0;
  return {
    pricePerKg: Math.round(median),
    lowPerKg,
    highPerKg,
    confidence,
    basis,
    count: pool.length,
    newestAt,
    scope: opts.regionCode && inRegion >= 3 ? 'region' : 'national',
  };
}

// ── Trend ────────────────────────────────────────────────────────────────────

export type Direction = 'rising' | 'falling' | 'steady';

export interface PriceTrend {
  windowDays: number;
  /** Pesewas per kg, now and one window earlier. */
  currentPerKg: number;
  previousPerKg: number;
  /** Fractional: 0.08 = up 8%. */
  change: number;
  direction: Direction;
}

/** A move smaller than this is noise between two sets of quotes. */
const STEADY_BAND = 0.04;

/**
 * The last window against the one before it. Null when either holds fewer than
 * two real observations: a "trend" from one quote is a rumour.
 */
export async function priceTrend(
  commodityId: string,
  opts: { regionCode?: string | null; windowDays?: number; now?: number } = {},
): Promise<PriceTrend | null> {
  const now = opts.now ?? Date.now();
  const windowDays = opts.windowDays ?? 30;
  const span = windowDays * DAY;
  const obs = (await loadObservations(commodityId, now - 2 * span)).filter(
    (o) => o.source !== 'reference' && o.observedAt <= now && (!opts.regionCode || !o.regionCode || o.regionCode === opts.regionCode),
  );
  const side = (from: number, to: number): Weighted[] =>
    obs.filter((o) => o.observedAt > from && o.observedAt <= to).map((o) => ({ v: o.pricePerKg, w: SOURCE_WEIGHT[o.source] }));
  const cur = trimOutliers(side(now - span, now));
  const prev = trimOutliers(side(now - 2 * span, now - span));
  if (cur.length < 2 || prev.length < 2) return null;
  const currentPerKg = weightedQuantile(cur, 0.5);
  const previousPerKg = weightedQuantile(prev, 0.5);
  const change = currentPerKg / previousPerKg - 1;
  return {
    windowDays,
    currentPerKg: Math.round(currentPerKg),
    previousPerKg: Math.round(previousPerKg),
    change,
    direction: change > STEADY_BAND ? 'rising' : change < -STEADY_BAND ? 'falling' : 'steady',
  };
}

// ── Series for charts ────────────────────────────────────────────────────────

export interface SeriesPoint {
  /** Start of the bucket, ms. */
  t: number;
  /** Pesewas per kg. */
  median: number;
  low: number;
  high: number;
  count: number;
}

/** Weighted-median price per bucket, oldest first; buckets with no data are skipped. */
export async function priceSeries(
  commodityId: string,
  opts: { regionCode?: string | null; days?: number; bucketDays?: number; now?: number } = {},
): Promise<SeriesPoint[]> {
  const now = opts.now ?? Date.now();
  const days = opts.days ?? 90;
  const bucket = (opts.bucketDays ?? 7) * DAY;
  const start = now - days * DAY;
  const obs = (await loadObservations(commodityId, start)).filter(
    (o) => o.source !== 'reference' && o.observedAt <= now && (!opts.regionCode || !o.regionCode || o.regionCode === opts.regionCode),
  );
  // Each period shows what was actually paid or reported when it has any; hopes (asks, offers,
  // requests) only fill a period with nothing firmer. Otherwise a quiet week made of asking prices
  // would make the line jump for reasons that have nothing to do with the market.
  const firm = new Map<number, Weighted[]>();
  const soft = new Map<number, Weighted[]>();
  for (const o of obs) {
    // Periods count back from now, so the newest is always a whole one (anchored at the window's
    // start, it could be a sliver of a day that holds only this morning's asking prices).
    const key = now - (Math.floor((now - o.observedAt) / bucket) + 1) * bucket;
    const into = o.source === 'deal' || o.source === 'market' ? firm : soft;
    const list = into.get(key) ?? [];
    list.push({ v: o.pricePerKg, w: SOURCE_WEIGHT[o.source] });
    into.set(key, list);
  }
  const keys = new Set([...firm.keys(), ...soft.keys()]);
  return [...keys]
    .sort((a, b) => a - b)
    .map((t) => {
      const items = firm.get(t) ?? soft.get(t)!;
      const kept = trimOutliers(items);
      return {
        t,
        median: Math.round(weightedQuantile(kept, 0.5)),
        low: Math.round(weightedQuantile(kept, 0.25)),
        high: Math.round(weightedQuantile(kept, 0.75)),
        count: items.length,
      };
    });
}

// ── Seasonality ──────────────────────────────────────────────────────────────

export interface SeasonalOutlook {
  /** Expected move from this month to next, and to two months on (fractional). */
  nextMonth: number;
  twoMonths: number;
  /** 1–12: the calendar month prices usually peak and bottom out. */
  peakMonth: number;
  lowMonth: number;
  /** Years of history the pattern rests on. */
  years: number;
}

// Per instance: on serverless an import on one instance cannot clear another's cache,
// so an entry also expires after SEASON_CACHE_MS (the history changes rarely).
const SEASON_CACHE_MS = 10 * 60_000;
const seasonCache = new Map<string, { epoch: number; at: number; value: SeasonalOutlook | null }>();

/**
 * What the official history says about the months ahead. Each market's monthly
 * median is divided by its own average for that year (so prices from different
 * decades, and a market that joined late, compare), then averaged by calendar
 * month. It is a hint about the usual shape of the year, not a forecast.
 */
export async function seasonalOutlook(commodityId: string, now = Date.now()): Promise<SeasonalOutlook | null> {
  const cached = seasonCache.get(commodityId);
  if (cached && cached.epoch === priceCacheEpoch && Date.now() - cached.at < SEASON_CACHE_MS) return shiftOutlook(cached.value, now);

  const rows = (await db
      .select()
      .from(priceObservations)
      .where(and(eq(priceObservations.commodityId, commodityId), eq(priceObservations.source, 'market'), eq(priceObservations.dataset, 'wfp'))));
  const value = computeSeasonality(rows);
  seasonCache.set(commodityId, { epoch: priceCacheEpoch, at: Date.now(), value });
  return shiftOutlook(value, now);
}

/** Held as a 12-month index; the outlook is read against the month it is asked in. */
interface SeasonIndex extends SeasonalOutlook {
  index: number[]; // [0..11], mean 1
}

function computeSeasonality(rows: PriceObservation[]): SeasonalOutlook | null {
  // market → year → month → prices
  const grid = new Map<string, Map<number, Map<number, number[]>>>();
  for (const r of rows) {
    const d = new Date(r.observedAt);
    const key = r.market ?? '?';
    const years = grid.get(key) ?? new Map();
    const months = years.get(d.getUTCFullYear()) ?? new Map();
    const list = months.get(d.getUTCMonth()) ?? [];
    list.push(r.pricePerKg);
    months.set(d.getUTCMonth(), list);
    years.set(d.getUTCFullYear(), months);
    grid.set(key, years);
  }
  const ratios: number[][] = Array.from({ length: 12 }, () => []);
  const yearsSeen = new Set<number>();
  for (const years of grid.values()) {
    // A year's average, for each year complete enough to show a shape.
    const medians = new Map<number, Array<readonly [number, number]>>();
    const means = new Map<number, number>();
    for (const [year, months] of years) {
      if (months.size < 9) continue; // a year with gaps hides the shape
      const ms = [...months.entries()].map(([m, list]) => [m, weightedQuantile(list.map((v) => ({ v, w: 1 })), 0.5)] as const);
      medians.set(year, ms);
      means.set(year, ms.reduce((sum, [, v]) => sum + v, 0) / ms.length);
    }
    for (const [year, ms] of medians) {
      for (const [m, v] of ms) {
        // Prices inflate within a year, and January would look cheap and December dear for no seasonal reason.
        // Judge each month against a baseline that runs between the neighbouring years' averages instead.
        ratios[m]!.push(v / trendBaseline(means, year, m));
      }
      yearsSeen.add(year);
    }
  }
  if (yearsSeen.size < 4 || ratios.some((r) => r.length === 0)) return null;
  const index = ratios.map((r) => r.reduce((s, v) => s + v, 0) / r.length);
  const peakMonth = index.indexOf(Math.max(...index)) + 1;
  const lowMonth = index.indexOf(Math.min(...index)) + 1;
  const out: SeasonIndex = { nextMonth: 0, twoMonths: 0, peakMonth, lowMonth, years: yearsSeen.size, index };
  return out;
}

/**
 * Where the year's trend sits in a given month: a straight line through the
 * average of the year before, this year and the year after (each placed at its
 * midpoint). With a neighbour missing, the year's own average.
 */
function trendBaseline(means: Map<number, number>, year: number, month: number): number {
  const here = means.get(year)!;
  const at = year + (month + 0.5) / 12; // position in years
  const mid = year + 0.5;
  const other = at < mid ? means.get(year - 1) : means.get(year + 1);
  if (other === undefined) return here;
  const otherMid = at < mid ? year - 0.5 : year + 1.5;
  return here + ((other - here) * (at - mid)) / (otherMid - mid);
}

function shiftOutlook(value: SeasonalOutlook | null, now: number): SeasonalOutlook | null {
  if (!value) return null;
  const { index } = value as SeasonIndex;
  const m = new Date(now).getUTCMonth();
  return {
    ...value,
    nextMonth: index[(m + 1) % 12]! / index[m]! - 1,
    twoMonths: index[(m + 2) % 12]! / index[m]! - 1,
  };
}

// ── Guidance: is this price sensible? ────────────────────────────────────────

export type Side = 'sell' | 'buy';
export type Verdict = 'very_low' | 'low' | 'fair' | 'high' | 'very_high' | 'unknown';

export interface PriceGuidance {
  commodityCode: string;
  side: Side;
  unit: { code: string; kgPerUnit: number } | null;
  estimate: PriceEstimate | null;
  trend: PriceTrend | null;
  verdict: Verdict;
  /** The typed price against the market median, fractional: +0.2 = 20% above. */
  deviation: number | null;
  /** Pesewas, per kg and (when a unit is known) per unit. */
  suggested: { perKg: { low: number; mid: number; high: number }; perUnit: { low: number; mid: number; high: number } | null } | null;
  /** An i18n key (`price.hint.*`) and its parameters — the same words on web, USSD and calls. */
  messageKey: string;
  params: Record<string, string | number>;
}

/** Inside the fair band ±12% is "fair"; twice outside it is almost surely a slip. */
const NEAR = 1.12;
const FAR = 2;

export interface GuidanceInput {
  commodityCode: string;
  side: Side;
  unitCode?: string | null;
  regionCode?: string | null;
  /** The price to judge: per unit when a unit is given, else per kg. Pesewas. Omit to just ask "what is it worth?". */
  price?: number | null;
  now?: number;
}

export async function priceGuidance(input: GuidanceInput): Promise<PriceGuidance> {
  const commodity = getCommodityByCode(input.commodityCode);
  const unit = input.unitCode ? getUnit(commodity.id, input.unitCode) : null;
  const unitInfo = unit ? { code: unit.code, kgPerUnit: unit.kgPerUnit } : null;
  const estimate = await estimatePrice(commodity.id, { regionCode: input.regionCode, now: input.now });
  const trend = await priceTrend(commodity.id, { regionCode: input.regionCode, now: input.now });

  const base = { commodityCode: commodity.code, side: input.side, unit: unitInfo, estimate, trend };
  if (!estimate) {
    return { ...base, verdict: 'unknown', deviation: null, suggested: null, messageKey: 'price.hint.unknown', params: {} };
  }

  const per = (kg: number) => (unit ? Math.round(kg * unit.kgPerUnit) : null);
  const suggested = {
    perKg: { low: estimate.lowPerKg, mid: estimate.pricePerKg, high: estimate.highPerKg },
    perUnit: unit ? { low: per(estimate.lowPerKg)!, mid: per(estimate.pricePerKg)!, high: per(estimate.highPerKg)! } : null,
  };
  const lowShown = unit ? suggested.perUnit!.low : suggested.perKg.low;
  const highShown = unit ? suggested.perUnit!.high : suggested.perKg.high;
  const params = { low: lowShown, high: highShown, mid: unit ? suggested.perUnit!.mid : suggested.perKg.mid };

  if (input.price === undefined || input.price === null) {
    return { ...base, verdict: 'unknown', deviation: null, suggested, messageKey: 'price.hint.range', params };
  }
  if (!Number.isFinite(input.price) || input.price <= 0) {
    throw new DomainError('Enter a price above zero', 'INVALID_PRICE');
  }

  const perKg = unit ? input.price / unit.kgPerUnit : input.price;
  const deviation = perKg / estimate.pricePerKg - 1;
  const stretch = perKg < estimate.lowPerKg ? estimate.lowPerKg / perKg : perKg > estimate.highPerKg ? perKg / estimate.highPerKg : 1;
  const above = perKg > estimate.highPerKg;
  let verdict: Verdict = 'fair';
  if (stretch >= FAR) verdict = above ? 'very_high' : 'very_low';
  else if (stretch >= NEAR) verdict = above ? 'high' : 'low';

  // Who the warning protects: a seller too high loses the sale, a buyer too low is declined;
  // a seller too low gives money away, a buyer too high overpays.
  const sellerView = input.side === 'sell';
  const key =
    verdict === 'fair'
      ? 'price.hint.fair'
      : `price.hint.${sellerView ? 'sell' : 'buy'}.${verdict}`;
  return { ...base, verdict, deviation, suggested, messageKey: key, params };
}

/** The guidance as one short sentence in the reader's language — the same words on web, USSD, SMS and calls. */
export function guidanceText(g: PriceGuidance, locale = 'en'): string {
  return t(locale, g.messageKey, guidanceParams(g));
}

/** The guidance's amounts as "GHS 4.20" strings, ready for any template. */
export function guidanceParams(g: PriceGuidance): Record<string, string> {
  return Object.fromEntries(Object.entries(g.params).map(([k, v]) => [k, typeof v === 'number' ? formatGhs(v) : String(v)]));
}

/** "Up 8% in 30 days" — empty when there is no trend to speak of. */
export function trendText(trend: PriceTrend | null, locale = 'en'): string {
  if (!trend) return '';
  return t(locale, `price.trend.${trend.direction}`, { pct: Math.round(Math.abs(trend.change) * 100), days: trend.windowDays });
}

/** The quick yes/no the sell and bid flows need: should this price make the person pause? */
export function shouldPause(g: PriceGuidance): boolean {
  return g.verdict === 'very_high' || g.verdict === 'very_low';
}

// ── The market at a glance ───────────────────────────────────────────────────

export interface CommodityOverview {
  commodityCode: string;
  estimate: PriceEstimate | null;
  trend: PriceTrend | null;
  /** Twelve weekly medians, oldest first, for a sparkline. */
  spark: number[];
  /** Open supply listed and open demand requested, kg. */
  supplyKg: number;
  demandKg: number;
  sellers: number;
  /** supply ÷ demand — under 1 means buyers are asking for more than is listed. */
  balance: number | null;
}

export async function marketOverview(opts: { regionCode?: string | null; now?: number } = {}): Promise<CommodityOverview[]> {
  const now = opts.now ?? Date.now();
  const openLots = (await db
      .select()
      .from(lots)
      .where(inArray(lots.status, ['registered', 'matched'])))
    .filter((l) => l.remainingKg > 0 && (l.expiresAt === null || l.expiresAt > now));
  const openRequests = (await db
      .select()
      .from(demands)
      .where(and(inArray(demands.status, ['open', 'partially_matched']), eq(demands.origin, 'request'))))
    .filter((d) => d.remainingKg > 0 && d.windowEnd > now);

  return await Promise.all(listCommodities().map(async (c) => {
      const estimate = await estimatePrice(c.id, { regionCode: opts.regionCode, now });
      const trend = await priceTrend(c.id, { regionCode: opts.regionCode, now });
      const mine = openLots.filter((l) => l.commodityId === c.id);
      const supplyKg = Math.round(mine.reduce((s, l) => s + l.remainingKg, 0));
      const demandKg = Math.round(openRequests.filter((d) => d.commodityId === c.id).reduce((s, d) => s + d.remainingKg, 0));
      const spark = (await priceSeries(c.id, { regionCode: opts.regionCode, days: 84, bucketDays: 7, now })).map((p) => p.median);
      return {
        commodityCode: c.code,
        estimate,
        trend,
        spark,
        supplyKg,
        demandKg,
        sellers: new Set(mine.map((l) => l.farmerId)).size,
        balance: demandKg > 0 ? supplyKg / demandKg : null,
      };
    }));
}

/** The latest observed price per market for one crop, newest first — the "where is it dearest" table. */
export async function latestByMarket(commodityId: string, now = Date.now()): Promise<Array<{ market: string; regionCode: string | null; pricePerKg: number; observedAt: number; source: PriceSource }>> {
  const rows = (await db
      .select()
      .from(priceObservations)
      .where(and(eq(priceObservations.commodityId, commodityId), eq(priceObservations.source, 'market'), gte(priceObservations.observedAt, now - MAX_AGE_DAYS * DAY)))
      .orderBy(desc(priceObservations.observedAt)));
  const seen = new Set<string>();
  const out: Awaited<ReturnType<typeof latestByMarket>> = [];
  for (const r of rows) {
    const k = r.market ?? '';
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ market: k, regionCode: r.regionCode, pricePerKg: r.pricePerKg, observedAt: r.observedAt, source: r.source });
  }
  return out;
}

export { getCommodityById };
