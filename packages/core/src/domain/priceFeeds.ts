import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../config';
import { db } from '../db/client';
import { commodities, priceObservations, regions } from '../db/schema';
import { clearPriceCaches } from './priceIntel';

/**
 * Where outside prices come in (D-053).
 *
 * Honest state of the world, checked 2026-11-14: WFP's Ghana series on HDX
 * (from MoFA, via FAO) stops at July 2023, and neither MoFA nor FAO FPMA offers
 * a public API we could verify. So the official history seeds trends and
 * seasonality, and "latest" is the platform's own deals and asks. Anything
 * current — a partner's file, a price collector's app — plugs into the feed
 * below without code changes.
 */

// ── WFP / HDX ────────────────────────────────────────────────────────────────

const HDX_PACKAGE = 'https://data.humdata.org/api/3/action/package_show?id=wfp-food-prices-for-ghana';

/** WFP's names for what we trade. Anything not listed (fish, imported rice, gari…) is not ours. */
const WFP_CROPS: Record<string, string> = {
  Maize: 'MAIZE',
  'Maize (yellow)': 'MAIZE',
  'Rice (local)': 'RICE',
  Cassava: 'CASSAVA',
  Millet: 'MILLET',
  Sorghum: 'SORGHUM',
  Soybeans: 'SOYBEAN',
  Cowpeas: 'COWPEA',
  'Cowpeas (white)': 'COWPEA',
  Yam: 'YAM',
  'Yam (puna)': 'YAM',
  'Plantains (apem)': 'PLANTAIN',
  'Plantains (apentu)': 'PLANTAIN',
  'Tomatoes (local)': 'TOMATO',
  'Tomatoes (navrongo)': 'TOMATO',
  Onions: 'ONION',
  'Peppers (fresh)': 'PEPPER',
};

/** A named non-kilo unit and what it weighs in F2M's own registry (a bunch of plantain, a hundred yams). */
const WFP_UNIT_KG: Record<string, number> = { Bunch: 12, '100 Tubers': 250 };

/** WFP uses the pre-2019 regions; most markets map straight, Brong Ahafo splits in two. */
const WFP_REGION: Record<string, string> = {
  ASHANTI: 'ASHANTI',
  'GREATER ACCRA': 'GREATER_ACCRA',
  NORTHERN: 'NORTHERN',
  'UPPER EAST': 'UPPER_EAST',
  'UPPER WEST': 'UPPER_WEST',
  CENTRAL: 'CENTRAL',
  EASTERN: 'EASTERN',
  VOLTA: 'VOLTA',
  WESTERN: 'WESTERN',
  'BRONG AHAFO': 'BONO_EAST',
};
const WFP_MARKET_REGION: Record<string, string> = {
  Sunyani: 'BONO',
  Techiman: 'BONO_EAST',
  Kintampo: 'BONO_EAST',
  Yeji: 'BONO_EAST',
  Kajeji: 'BONO_EAST',
  Badu: 'BONO',
  Bunkprugu: 'NORTH_EAST',
  Nalerigu: 'NORTH_EAST',
  Yunyoo: 'NORTH_EAST',
  Kete_Krachi: 'OTI',
  'Kete Krachi': 'OTI',
  Dambai: 'OTI',
  Kadjebi: 'OTI',
  Nkwanta: 'OTI',
  Kpassa: 'OTI',
};

/** One CSV record, honouring quoted fields ("fish and eggs", with commas inside). */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export interface ImportResult {
  read: number;
  imported: number;
  skipped: number;
  newest: string | null;
}

/**
 * Load a WFP food-price CSV. Only wholesale prices of crops we trade, in cedis,
 * in a unit we can turn into kilos; each becomes one `market` observation.
 * Running it again changes nothing that is already there.
 */
export function importWfpCsv(csv: string): ImportResult {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = parseCsvLine(lines[0] ?? '');
  const col = (name: string) => header.indexOf(name);
  const idx = {
    date: col('date'),
    admin1: col('admin1'),
    market: col('market'),
    commodity: col('commodity'),
    unit: col('unit'),
    pricetype: col('pricetype'),
    currency: col('currency'),
    price: col('price'),
  };
  if (Object.values(idx).some((i) => i < 0)) throw new Error('This does not look like a WFP food-price file');

  const cropIds = new Map(db.select().from(commodities).all().map((c) => [c.code, c.id]));
  const regionCodes = new Set(db.select().from(regions).all().map((r) => r.code));

  const rows: Array<typeof priceObservations.$inferInsert> = [];
  let read = 0;
  let newest: string | null = null;
  for (const line of lines.slice(1)) {
    const f = parseCsvLine(line);
    const date = f[idx.date] ?? '';
    if (!/^\d{4}-\d{2}-\d{2}/.test(date)) continue; // HXL tag rows and blanks
    read += 1;
    const code = WFP_CROPS[f[idx.commodity] ?? ''];
    if (!code || f[idx.pricetype] !== 'Wholesale' || f[idx.currency] !== 'GHS') continue;
    const unit = f[idx.unit] ?? '';
    const kg = /^(\d+(?:\.\d+)?)\s*KG$/i.exec(unit)?.[1] ? Number(/^(\d+(?:\.\d+)?)\s*KG$/i.exec(unit)![1]) : WFP_UNIT_KG[unit];
    const price = Number(f[idx.price]);
    const commodityId = cropIds.get(code);
    if (!kg || !commodityId || !Number.isFinite(price) || price <= 0) continue;
    const perKg = Math.round((price * 100) / kg);
    if (perKg <= 0) continue;
    const market = f[idx.market] ?? '';
    const region = WFP_MARKET_REGION[market] ?? WFP_REGION[(f[idx.admin1] ?? '').toUpperCase()] ?? null;
    const observedAt = Date.parse(`${date.slice(0, 10)}T12:00:00Z`);
    if (!Number.isFinite(observedAt)) continue;
    if (!newest || date > newest) newest = date.slice(0, 10);
    rows.push({
      commodityId,
      regionCode: region && regionCodes.has(region) ? region : null,
      market,
      pricePerKg: perKg,
      source: 'market',
      dataset: 'wfp',
      refId: `wfp:${market}:${f[idx.commodity]}:${unit}:${date.slice(0, 10)}`,
      observedAt,
    });
  }

  db.transaction((tx) => {
    for (let i = 0; i < rows.length; i += 200) {
      tx.insert(priceObservations)
        .values(rows.slice(i, i + 200))
        .onConflictDoUpdate({
          target: [priceObservations.source, priceObservations.refId],
          set: { pricePerKg: sql`excluded.price_per_kg`, observedAt: sql`excluded.observed_at` },
        })
        .run();
    }
  });
  clearPriceCaches();
  return { read, imported: rows.length, skipped: read - rows.length, newest };
}

/** Download WFP's Ghana file from HDX (CC BY-IGO) and import it. */
export async function fetchAndImportWfp(): Promise<ImportResult> {
  const headers = { 'User-Agent': 'F2M-price-import' };
  const meta = (await (await fetch(HDX_PACKAGE, { headers })).json()) as {
    result?: { resources?: Array<{ format?: string; url?: string; name?: string }> };
  };
  const resource = meta.result?.resources?.find((r) => /csv/i.test(r.format ?? '') && /food prices/i.test(r.name ?? ''));
  if (!resource?.url) throw new Error('HDX has no Ghana food-price CSV listed');
  const res = await fetch(resource.url, { headers });
  if (!res.ok) throw new Error(`HDX download failed: ${res.status}`);
  return importWfpCsv(await res.text());
}

// ── A generic feed: any current source ───────────────────────────────────────

const feedRowSchema = z
  .object({
    commodity: z.string().min(1), // F2M crop code, e.g. MAIZE
    market: z.string().min(1).optional(),
    regionCode: z.string().optional(),
    /** Cedis per kg, or cedis per unit with the unit's weight. */
    ghsPerKg: z.number().positive().optional(),
    ghsPerUnit: z.number().positive().optional(),
    unitKg: z.number().positive().optional(),
    /** ISO date or epoch ms; defaults to now. */
    observedAt: z.union([z.string(), z.number()]).optional(),
  })
  .refine((r) => r.ghsPerKg !== undefined || (r.ghsPerUnit !== undefined && r.unitKg !== undefined), {
    message: 'give ghsPerKg, or ghsPerUnit with unitKg',
  });

export const priceFeedSchema = z.object({
  /** Who is reporting, e.g. "esoko", "mofa-weekly", "collector-app". Part of each row's identity. */
  dataset: z.string().min(1).max(40).regex(/^[a-z0-9._-]+$/i),
  observations: z.array(feedRowSchema).min(1).max(5000),
});

export interface FeedResult {
  accepted: number;
  rejected: Array<{ index: number; reason: string }>;
}

export function ingestFeed(raw: unknown): FeedResult {
  const feed = priceFeedSchema.parse(raw);
  const cropIds = new Map(db.select().from(commodities).all().map((c) => [c.code, c.id]));
  const regionCodes = new Set(db.select().from(regions).all().map((r) => r.code));
  const rejected: FeedResult['rejected'] = [];
  const rows: Array<typeof priceObservations.$inferInsert> = [];

  feed.observations.forEach((o, index) => {
    const commodityId = cropIds.get(o.commodity.toUpperCase());
    if (!commodityId) return void rejected.push({ index, reason: `unknown crop ${o.commodity}` });
    if (o.regionCode && !regionCodes.has(o.regionCode)) return void rejected.push({ index, reason: `unknown region ${o.regionCode}` });
    const perKg = Math.round(((o.ghsPerKg ?? o.ghsPerUnit! / o.unitKg!) as number) * 100);
    if (perKg <= 0 || perKg > 100_000) return void rejected.push({ index, reason: 'price outside what we record' });
    const observedAt = o.observedAt === undefined ? Date.now() : typeof o.observedAt === 'number' ? o.observedAt : Date.parse(o.observedAt);
    if (!Number.isFinite(observedAt) || observedAt > Date.now() + 24 * 60 * 60 * 1000) {
      return void rejected.push({ index, reason: 'date is missing, unreadable or in the future' });
    }
    const day = new Date(observedAt).toISOString().slice(0, 10);
    rows.push({
      commodityId,
      regionCode: o.regionCode ?? null,
      market: o.market ?? null,
      pricePerKg: perKg,
      source: 'market',
      dataset: feed.dataset,
      refId: `${feed.dataset}:${o.commodity.toUpperCase()}:${o.market ?? o.regionCode ?? '-'}:${day}`,
      observedAt,
    });
  });

  db.transaction((tx) => {
    for (let i = 0; i < rows.length; i += 200) {
      tx.insert(priceObservations)
        .values(rows.slice(i, i + 200))
        .onConflictDoUpdate({
          target: [priceObservations.source, priceObservations.refId],
          set: { pricePerKg: sql`excluded.price_per_kg`, observedAt: sql`excluded.observed_at` },
        })
        .run();
    }
  });
  clearPriceCaches();
  return { accepted: rows.length, rejected };
}

// ── Keeping it current ───────────────────────────────────────────────────────

let lastFeedPull = 0;
let hdxTried = false;

/**
 * Called by the sweep: pull the configured feed URL on its interval, and — only
 * if `PRICE_FEED_HDX` is on — fetch WFP's history once when the database has none.
 * A source being down never breaks the sweep; it is reported and tried again.
 */
export async function refreshPriceFeeds(now = Date.now()): Promise<{ feedAccepted: number; wfpImported: number; error?: string }> {
  let feedAccepted = 0;
  let wfpImported = 0;
  try {
    if (config.PRICE_FEED_URL && now - lastFeedPull >= config.PRICE_FEED_INTERVAL_MINUTES * 60_000) {
      lastFeedPull = now;
      const res = await fetch(config.PRICE_FEED_URL, {
        headers: config.PRICE_FEED_TOKEN ? { Authorization: `Bearer ${config.PRICE_FEED_TOKEN}` } : {},
      });
      if (!res.ok) throw new Error(`price feed answered ${res.status}`);
      feedAccepted = ingestFeed(await res.json()).accepted;
    }
    if (config.PRICE_FEED_HDX === 'true' && !hdxTried) {
      hdxTried = true;
      const have = db.select({ n: sql<number>`count(*)` }).from(priceObservations).where(eq(priceObservations.dataset, 'wfp')).get();
      if (!have || have.n === 0) wfpImported = (await fetchAndImportWfp()).imported;
    }
  } catch (err) {
    return { feedAccepted, wfpImported, error: String(err) };
  }
  return { feedAccepted, wfpImported };
}
