import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client';
import { lots, offers, units } from '../db/schema';
import { t } from '../i18n';
import { askLlm, llmEnabled } from '../providers/llm/index';
import { notFound } from './errors';
import { listListingPhotos, photoAsGradingImage } from './photos';
import { guidanceParams, priceGuidance } from './priceIntel';
import { getCommodityByCode, getCommodityById, listCommodities, listRegions, listUnits } from './registries';
import { findCommodity, type ListingDraft } from './voiceParse';
import { MAX_UNIT_QTY, sameWord, scanNumbers, words } from './voiceListings';

/**
 * What a language model is allowed to do here (D-056): read a sentence a person
 * wrote or said and propose fields — never decide. Every value it returns is
 * checked twice before anyone sees it: against the platform's own registries
 * (a crop, unit or region that exists) and against the person's own words (a
 * number the model returns must be a number they actually said). Anything that
 * fails either check is dropped, and the rules and the human confirmation step
 * carry on as if it had never answered.
 */

const DAY_WORDS: Record<string, number> = { today: 0, now: 0, tomorrow: 1, yesterday: 1 };

/**
 * The numbers present in this text. `numbers` are counts and prices (anything not said as a weight);
 * `weights` are the ones said as "50 kg". Keeping them apart stops "fifty kilos each" being read as a price.
 * `withTonnes` adds "5 tonnes" as 5,000.
 */
function spokenNumbers(text: string): { numbers: Set<number>; weights: Set<number>; withTonnes: Set<number> } {
  const tokens = words(text);
  const mentions = scanNumbers(tokens);
  const numbers = new Set(mentions.filter((n) => !n.isWeight).map((n) => n.value));
  const weights = new Set(mentions.filter((n) => n.isWeight).map((n) => n.value));
  const withTonnes = new Set<number>();
  if (tokens.some((tk) => /^(tonne|tonnes|ton|tons|mt)$/.test(tk))) for (const n of mentions) withTonnes.add(n.value * 1000);
  return { numbers, weights, withTonnes };
}

/**
 * The day counts a sentence's words stand for. "Tomorrow" can only be a ready date and
 * "yesterday" only a harvest; "today" and "now" are either. A sentence can hold several.
 */
const spokenDays = (text: string, field: 'ready' | 'harvest'): Set<number> => {
  const tokens = words(text);
  const found = new Set<number>();
  for (const [word, value] of Object.entries(DAY_WORDS)) {
    if (!tokens.includes(word)) continue;
    if ((word === 'yesterday' && field === 'ready') || (word === 'tomorrow' && field === 'harvest')) continue;
    found.add(value);
  }
  return found;
};

// ── 1. A farmer's listing sentence ───────────────────────────────────────────

const listingSchema = z.object({
  unit: z.string().nullable(),
  quantity: z.number().nullable(),
  priceCedisPerUnit: z.number().nullable(),
  readyInDays: z.number().nullable(),
  harvestedDaysAgo: z.number().nullable(),
});

export interface ListingAssist {
  /** Only fields that passed both checks. */
  draft: ListingDraft;
  fields: string[];
}

/**
 * Help read the one-breath listing sentence ("ten of the fifty-kilo bags, I want
 * four hundred cedis each, ready in three days"). The crop must already be
 * known from the rules — a language model naming a crop for a farmer is exactly
 * the "wrong listing" the parser is built to refuse — and quality is never taken
 * from it. Returns null when there is nothing safe to add.
 */
export async function assistListingDraft(english: string): Promise<ListingAssist | null> {
  if (!llmEnabled() || !english.trim()) return null;
  const crop = findCommodity(english);
  if (!crop.code) return null; // unknown or two crops in one breath: leave it to the call to ask
  const commodity = getCommodityByCode(crop.code);
  const cropUnits = listUnits(commodity.id);

  const answer = await askLlm({
    system: [
      'You read one sentence a Ghanaian farmer said about produce she wants to sell. It was spoken in a local language and machine-translated to English, so it may be garbled.',
      `The crop is ${t('en', commodity.nameKey)}. Units this crop is sold in: ${cropUnits.map((u) => `${u.code} (${t('en', u.nameKey)}, ${u.kgPerUnit} kg)`).join('; ')}.`,
      'Return only what she clearly said. If a value is not clearly stated, return null for it. Never guess, calculate, or convert.',
      '"quantity" is how many units she has (for example 10 bags), never the weight of one bag. "priceCedisPerUnit" is the price in cedis she named for one unit.',
      '"readyInDays" is how many days until it is ready to collect (0 if now); "harvestedDaysAgo" is how many days ago it was harvested.',
    ].join('\n'),
    user: english,
    schema: listingSchema,
  });
  if (!answer) return null;

  const { numbers, weights } = spokenNumbers(english);
  const tokens = words(english);
  const draft: ListingDraft = {};
  // A unit counts only if her own words single it out: she said its weight ("fifty kilo") or its name
  // ("olonka") and no other unit of this crop fits the same words. "Bags" alone, for a crop sold in two
  // bag sizes, stays unanswered so the call asks — a model must not guess the size (D-052).
  const unitWords = (u: (typeof cropUnits)[number]) => words(t('en', u.nameKey)).filter((w) => w.length > 2 && !/^d/.test(w));
  const said = (u: (typeof cropUnits)[number]) =>
    weights.has(u.kgPerUnit) || unitWords(u).some((w) => tokens.some((tk) => sameWord(tk, w)));
  const chosen = cropUnits.find((u) => u.code === answer.unit);
  if (chosen && said(chosen)) {
    const rivals = cropUnits.filter((u) => u.code !== chosen.code && said(u));
    const byWeight = weights.has(chosen.kgPerUnit);
    if (rivals.length === 0 || (byWeight && !rivals.some((u) => weights.has(u.kgPerUnit)))) draft.unitCode = chosen.code;
  }
  if (answer.quantity !== null && numbers.has(answer.quantity) && answer.quantity > 0 && answer.quantity <= MAX_UNIT_QTY) draft.unitQty = answer.quantity;
  if (answer.priceCedisPerUnit !== null && numbers.has(answer.priceCedisPerUnit) && answer.priceCedisPerUnit > 0 && answer.priceCedisPerUnit <= 1_000_000) {
    draft.pricePerUnit = Math.round(answer.priceCedisPerUnit * 100);
  }
  if (answer.readyInDays !== null && Number.isInteger(answer.readyInDays) && answer.readyInDays >= 0 && answer.readyInDays <= 180) {
    if (numbers.has(answer.readyInDays) || spokenDays(english, 'ready').has(answer.readyInDays)) draft.readyInDays = answer.readyInDays;
  }
  if (answer.harvestedDaysAgo !== null && Number.isInteger(answer.harvestedDaysAgo) && answer.harvestedDaysAgo >= 0 && answer.harvestedDaysAgo <= 365) {
    if (numbers.has(answer.harvestedDaysAgo) || spokenDays(english, 'harvest').has(answer.harvestedDaysAgo)) draft.harvestedDaysAgo = answer.harvestedDaysAgo;
  }
  const fields = Object.keys(draft);
  return fields.length > 0 ? { draft, fields } : null;
}

/** Fill only what the rules left empty — rules that heard something always win. Reports which fields the model supplied. */
export function fillGaps(ruleDraft: ListingDraft, assist: ListingDraft): { draft: ListingDraft; aiFilled: string[] } {
  const draft: ListingDraft = { ...ruleDraft };
  const aiFilled: string[] = [];
  for (const [key, value] of Object.entries(assist) as Array<[keyof ListingDraft, unknown]>) {
    if (value === undefined || draft[key] !== undefined) continue;
    (draft as Record<string, unknown>)[key] = value;
    aiFilled.push(key);
  }
  return { draft, aiFilled };
}

// ── 2. A buyer's request, typed in plain words ───────────────────────────────

const requestSchema = z.object({
  commodity: z.string().nullable(),
  quantity: z.number().nullable(),
  quantityIsKg: z.boolean().nullable(),
  unit: z.string().nullable(),
  priceCedisPerKg: z.number().nullable(),
  grade: z.string().nullable(),
  region: z.string().nullable(),
  neededWithinDays: z.number().nullable(),
});

export interface RequestFields {
  commodityCode?: string;
  unitCode?: string;
  unitQty?: number;
  quantityKg?: number;
  pricePerKgGhs?: number;
  minBand?: 'A' | 'B' | 'C';
  regionCode?: string;
  windowDays?: number;
}

/**
 * "I need 5 tonnes of tomatoes in Kumasi by Friday, up to GHS 6 a kilo" → the
 * fields of the request form. The buyer reviews the filled form and submits it
 * themselves, so a crop can be suggested here; numbers still have to be ones
 * they typed.
 */
export async function understandRequest(text: string): Promise<RequestFields | null> {
  if (!llmEnabled() || !text.trim()) return null;
  const crops = listCommodities();
  const regions = listRegions();
  const answer = await askLlm({
    system: [
      'You read a buyer\'s request for farm produce in Ghana, typed in plain English, and fill in a form. Return only what they clearly said; use null for anything not stated. Never guess or calculate.',
      `Crops (use the code): ${crops.map((c) => `${c.code}=${t('en', c.nameKey)}`).join(', ')}.`,
      `Units by crop: ${crops.map((c) => `${c.code}: ${c.units.map((u) => u.code).join('/')}`).join('; ')}.`,
      `Regions (use the code): ${regions.map((r) => `${r.code}=${t('en', r.nameKey)}`).join(', ')}.`,
      '"quantity" is the number they gave; set "quantityIsKg" true when it is in kilograms or tonnes (give tonnes as written, e.g. 5), false when it counts units like bags. "priceCedisPerKg" is a price per kilogram in cedis. "grade" is A, B or C only if they named a grade. "neededWithinDays" is how many days from now they need it.',
    ].join('\n'),
    user: text,
    schema: requestSchema,
  });
  if (!answer) return null;

  const { numbers, weights, withTonnes } = spokenNumbers(text);
  const out: RequestFields = {};
  const crop = answer.commodity ? crops.find((c) => c.code === answer.commodity) : undefined;
  if (crop) out.commodityCode = crop.code;
  if (crop && answer.unit && crop.units.some((u) => u.code === answer.unit)) out.unitCode = answer.unit;
  if (answer.quantity !== null && answer.quantity > 0) {
    const tonnes = /\b(tonnes?|tons?|mt)\b/i.test(text);
    if (answer.quantityIsKg) {
      const kg = tonnes && numbers.has(answer.quantity) ? answer.quantity * 1000 : answer.quantity;
      // "500 kg" is a weight mention, "5 tonnes" a plain number: either is something the buyer said.
      if ((numbers.has(answer.quantity) || weights.has(answer.quantity) || withTonnes.has(kg)) && kg <= 10_000_000) out.quantityKg = kg;
    } else if (numbers.has(answer.quantity) && answer.quantity <= MAX_UNIT_QTY) {
      out.unitQty = answer.quantity;
    }
  }
  if (answer.priceCedisPerKg !== null && numbers.has(answer.priceCedisPerKg) && answer.priceCedisPerKg > 0 && answer.priceCedisPerKg <= 1000) {
    out.pricePerKgGhs = answer.priceCedisPerKg;
  }
  const letter = /\b(?:grade|class)\s*([abc])\b/i.exec(text)?.[1]?.toUpperCase();
  if (letter && answer.grade?.toUpperCase() === letter) out.minBand = letter as 'A' | 'B' | 'C';
  if (answer.region && regions.some((r) => r.code === answer.region)) out.regionCode = answer.region;
  if (answer.neededWithinDays !== null && Number.isInteger(answer.neededWithinDays) && answer.neededWithinDays > 0 && answer.neededWithinDays <= 60) {
    if (numbers.has(answer.neededWithinDays) || withTonnes.has(answer.neededWithinDays)) out.windowDays = answer.neededWithinDays;
  }
  return Object.keys(out).length > 0 ? out : null;
}

// ── 3. Advice on an offer: arithmetic, not a model ───────────────────────────

export interface OfferAdvice {
  action: 'accept' | 'counter' | 'none';
  verdict: string;
  suggestedPricePerUnit: number | null;
  message: string;
}

/**
 * Should this proposal be accepted, countered, or is there too little data to
 * say? Pure price arithmetic against the market range — the number suggested is
 * the market's middle, never invented — so it works with the assist off.
 */
export async function adviseOffer(offerId: string, party: 'buyer' | 'farmer', locale = 'en'): Promise<OfferAdvice> {
  const offer = (await db.select().from(offers).where(eq(offers.id, offerId)))[0];
  if (!offer) throw notFound('offer');
  const lot = (await db.select().from(lots).where(eq(lots.id, offer.lotId)))[0];
  const unit = lot ? (await db.select().from(units).where(eq(units.id, lot.unitId)))[0] : undefined;
  if (!lot || !unit) throw notFound('lot');
  const commodity = getCommodityById(lot.commodityId);

  const g = await priceGuidance({
      commodityCode: commodity.code,
      unitCode: unit.code,
      regionCode: lot.regionCode,
      price: offer.pricePerUnit,
      side: party === 'farmer' ? 'sell' : 'buy',
    });
  const solid = g.estimate && g.estimate.confidence !== 'reference' && g.estimate.confidence !== 'low';
  if (!solid || !g.suggested?.perUnit) {
    return { action: 'none', verdict: g.verdict, suggestedPricePerUnit: null, message: t(locale, 'advice.none') };
  }
  const params = { ...guidanceParams(g), suggested: guidanceParams({ ...g, params: { mid: g.suggested.perUnit.mid } }).mid! };
  // From the farmer's side a price at or above the range is good news; from the buyer's, at or below.
  const favourable = party === 'farmer' ? g.verdict === 'fair' || g.verdict === 'high' || g.verdict === 'very_high' : g.verdict === 'fair' || g.verdict === 'low' || g.verdict === 'very_low';
  if (favourable) {
    return { action: 'accept', verdict: g.verdict, suggestedPricePerUnit: null, message: t(locale, 'advice.accept', params) };
  }
  return { action: 'counter', verdict: g.verdict, suggestedPricePerUnit: g.suggested.perUnit.mid, message: t(locale, 'advice.counter', params) };
}

// ── 4. A look at a listing photo ─────────────────────────────────────────────

const photoSchema = z.object({
  showsProduce: z.boolean(),
  produceSeen: z.string(),
  matchesDeclaredCrop: z.boolean(),
  concerns: z.array(z.string()),
});

export interface PhotoCheck {
  advisory: true;
  showsProduce: boolean;
  produceSeen: string;
  matchesDeclaredCrop: boolean;
  concerns: string[];
}

/**
 * Does the photo show the crop the listing names? Advisory only — it tells the
 * farmer ("this looks like tomatoes, not onions") and never blocks or grades
 * anything. Null when the assist is off or there is no photo.
 */
export async function checkListingPhoto(lotId: string): Promise<PhotoCheck | null> {
  if (!llmEnabled()) return null;
  const lot = (await db.select().from(lots).where(eq(lots.id, lotId)))[0];
  if (!lot) throw notFound('lot');
  const photo = (await listListingPhotos(lotId))[0];
  if (!photo) return null;
  const commodity = getCommodityById(lot.commodityId);
  const image = await photoAsGradingImage(photo);

  const answer = await askLlm({
    system: [
      'You look at one photo from a produce listing on a Ghanaian farm marketplace and report what you see, plainly and briefly.',
      '"produceSeen" names the produce you see in a few words (empty if none). "concerns" lists up to three visible problems a buyer would care about (mould, damage, mixed produce, a stock photo or a photo of a screen); empty if none.',
    ].join('\n'),
    user: `The listing says this is ${t('en', commodity.nameKey)}. Does the photo show it?`,
    schema: photoSchema,
    images: [{ mime: image.mime, base64: image.base64 }],
    maxTokens: 600,
  });
  if (!answer) return null;
  return { advisory: true, ...answer, concerns: answer.concerns.slice(0, 3) };
}

/** Used by routes to know whether to offer the assist at all. */
export function aiAssistEnabled(): boolean {
  return llmEnabled();
}

