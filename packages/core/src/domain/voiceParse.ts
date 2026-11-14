import { t } from '../i18n';
import { listCommodities, listUnits } from './registries';
import type { GradeBand } from './types';
import {
  COMMODITY_SYNONYMS,
  MAX_UNIT_QTY,
  phraseAt,
  readQuantity,
  sameWord,
  scanNumbers,
  words,
  type NumberMention,
} from './voiceListings';

/**
 * Reading what a farmer said into listing fields, one field at a time
 * (Phase 2, docs/PHASE2.md). Unlike the one-breath parser (parseListingText),
 * which lists or refuses, these return only what was clearly said, so the call
 * can ask for whatever is missing or unclear instead of guessing (vision §5.3:
 * "must not blindly publish information it does not understand").
 *
 * All input is English: the recording has already been through ASR and MT.
 */

export interface ListingDraft {
  commodityCode?: string;
  unitCode?: string;
  unitQty?: number;
  /** Pesewas per unit. `null` = the farmer said to let buyers make offers. */
  pricePerUnit?: number | null;
  harvestedDaysAgo?: number;
  readyInDays?: number;
  declaredBand?: GradeBand;
}

const MONEY_AFTER = /^(cedi|cedis|ghc|ghs|gh|ghana)$/;
const MONEY_BEFORE = /^(ghc|ghs|gh)$/;
const TOTAL_WORDS = /\b(for all|altogether|in total|total|for everything|all of it)\b/;
const NO_PRICE = /\b(no price|let (the )?buyers|any price|make (me )?an offer|buyers (can )?offer|negotiable)\b/;
const MAX_PRICE_GHS = 1_000_000;

/** Which crop the sentence names. Two different crops in one breath is not a guess we make. */
export function findCommodity(text: string): { code?: string; ambiguous: boolean } {
  const tokens = words(text);
  const mentions = listCommodities()
    .map((c) => ({ code: c.code, at: phraseAt(tokens, words(t('en', c.nameKey))) }))
    .concat(Object.entries(COMMODITY_SYNONYMS).map(([word, code]) => ({ code, at: phraseAt(tokens, [word]) })))
    .filter((m) => m.at >= 0);
  const codes = [...new Set(mentions.map((m) => m.code))];
  if (codes.length === 1) return { code: codes[0], ambiguous: false };
  return { ambiguous: codes.length > 1 };
}

/** Numbers that are money: "2,000 cedis", "GHS 2000", "two thousand Ghana cedis". */
function moneyMentions(tokens: string[], numbers: NumberMention[]): NumberMention[] {
  return numbers.filter((n) => !n.isWeight && (MONEY_AFTER.test(tokens[n.end + 1] ?? '') || MONEY_BEFORE.test(tokens[n.start - 1] ?? '')));
}

/** Numbers that are a time: "three days ago", "in two weeks". */
function timeMentions(tokens: string[], numbers: NumberMention[]): NumberMention[] {
  return numbers.filter((n) => /^(day|days|week|weeks|month|months)$/.test(tokens[n.end + 1] ?? ''));
}

/** Price per unit in pesewas, from a sentence that may also hold a quantity. */
function readPrice(text: string, tokens: string[], numbers: NumberMention[], qty: number | undefined, loneNumberIsPrice: boolean): number | null | undefined {
  const lower = ` ${tokens.join(' ')} `;
  if (NO_PRICE.test(lower) || /\b(zero|nothing|free)\b/.test(lower)) return null;
  const money = moneyMentions(tokens, numbers);
  let ghs: number | undefined;
  if (money.length === 1) ghs = money[0]!.value;
  else if (money.length === 0 && loneNumberIsPrice) {
    const plain = numbers.filter((n) => !n.isWeight);
    if (plain.length === 1) ghs = plain[0]!.value;
  }
  if (ghs === undefined || ghs <= 0 || ghs > MAX_PRICE_GHS) return undefined;
  if (TOTAL_WORDS.test(lower)) {
    // "2,000 cedis for all of it": a total, so per unit needs the quantity.
    if (!qty) return undefined;
    return Math.round((ghs * 100) / qty);
  }
  return Math.round(ghs * 100);
}

const PAST_WORD = /^(ago|before|back)$/;

/** Days since harvest, if the sentence says. */
function readHarvest(tokens: string[], numbers: NumberMention[]): number | undefined {
  const lower = ` ${tokens.join(' ')} `;
  for (const n of timeMentions(tokens, numbers)) {
    if (PAST_WORD.test(tokens[n.end + 2] ?? '')) return n.value * unitDays(tokens[n.end + 1]!);
  }
  if (/ day before yesterday /.test(lower)) return 2;
  if (/ yesterday /.test(lower)) return 1;
  if (/ (last week|a week ago|one week ago) /.test(lower)) return 7;
  if (/ (last month|a month ago) /.test(lower)) return 30;
  if (/ (harvest\w*|picked|uprooted|dug|lifted|cut) (it |them |this |the \w+ )?(today|this morning)/.test(lower)) return 0;
  return undefined;
}

/** Days until the produce is ready, if the sentence says. */
function readReady(tokens: string[], numbers: NumberMention[]): number | undefined {
  const lower = ` ${tokens.join(' ')} `;
  for (const n of timeMentions(tokens, numbers)) {
    if (tokens[n.start - 1] === 'in' || tokens[n.end + 2] === 'time') return n.value * unitDays(tokens[n.end + 1]!);
  }
  if (/ day after tomorrow /.test(lower)) return 2;
  if (/ tomorrow /.test(lower)) return 1;
  if (/ next week /.test(lower)) return 7;
  if (/ (ready|available|there) (now|today|already)|already (ready|bagged)| right now /.test(lower)) return 0;
  return undefined;
}

const unitDays = (word: string) => (word.startsWith('week') ? 7 : word.startsWith('month') ? 30 : 1);

/** Quality words, only when said — otherwise the call asks its quality questions. */
function readBand(tokens: string[]): GradeBand | undefined {
  const lower = ` ${tokens.join(' ')} `;
  if (/ (excellent|premium|best|top quality|very good|grade a) /.test(lower)) return 'A';
  if (/ (fair|poor|not so good|grade c) /.test(lower)) return 'C';
  // Not a bare "good": "good morning" is a greeting, not a grade.
  if (/ (good quality|good condition|grade b) /.test(lower)) return 'B';
  return undefined;
}

/** The unit named in the sentence for this crop, if any (the smaller on a tie, as the one-breath parser does). */
function readUnit(commodityId: string, tokens: string[], numbers: NumberMention[]): { code?: string; names: string[]; kg?: number } {
  const units = listUnits(commodityId).map((u) => ({
    unit: u,
    names: words(t('en', u.nameKey)).filter((w) => w.length > 2 && !/^\d/.test(w)),
  }));
  const weights = numbers.filter((n) => n.isWeight).map((n) => n.value);
  const scored = units
    .map(({ unit, names }) => ({
      unit,
      score: (names.some((w) => tokens.some((tk) => sameWord(tk, w))) ? 2 : 0) + (weights.includes(unit.kgPerUnit) ? 1 : 0),
    }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.unit.kgPerUnit - b.unit.kgPerUnit);
  // "bags" of rice could be the 50kg or the 25kg bag: a tie is a question for
  // the farmer, not a guess (the one-breath parser takes the smaller instead).
  const tied = scored.length > 1 && scored[0]!.score === scored[1]!.score;
  const best = tied ? undefined : scored[0]?.unit;
  return { code: best?.code, kg: best?.kgPerUnit, names: units.flatMap((u) => u.names) };
}

/**
 * Everything one sentence gives: "I have 99 bags of rice, and I am selling each
 * bag for 2,000 Ghana cedis. I harvested them yesterday, and they will be ready
 * tomorrow." → rice, 99 × 50kg bag, GHS 2,000 a bag, harvested 1 day ago,
 * ready in 1 day. Fields it cannot read are left out.
 */
export function parseListingDraft(text: string, known: { commodityCode?: string } = {}): ListingDraft {
  const tokens = words(text);
  if (tokens.length === 0) return {};
  const draft: ListingDraft = {};
  const found = findCommodity(text);
  const commodityCode = found.code ?? known.commodityCode;
  if (found.code) draft.commodityCode = found.code;

  const numbers = scanNumbers(tokens);
  const money = new Set(moneyMentions(tokens, numbers));
  const times = new Set(timeMentions(tokens, numbers));
  const counts = numbers.filter((n) => !money.has(n) && !times.has(n));

  if (commodityCode) {
    const commodity = listCommodities().find((c) => c.code === commodityCode);
    if (commodity) {
      const unit = readUnit(commodity.id, tokens, counts);
      if (unit.code) draft.unitCode = unit.code;
      const qty = readQuantity(tokens, counts, unit.names, unit.kg ?? 0);
      if (qty !== null) draft.unitQty = qty;
    }
  }
  const price = readPrice(text, tokens, numbers, draft.unitQty, false);
  if (price !== undefined) draft.pricePerUnit = price;
  const harvested = readHarvest(tokens, numbers);
  if (harvested !== undefined) draft.harvestedDaysAgo = harvested;
  const ready = readReady(tokens, numbers);
  if (ready !== undefined) draft.readyInDays = ready;
  const band = readBand(tokens);
  if (band) draft.declaredBand = band;
  return draft;
}

/** An answer to "how many?": a whole count, and the unit if one was named. */
export function parseCountAnswer(text: string, commodityCode: string): { unitQty?: number; unitCode?: string } {
  const tokens = words(text);
  const numbers = scanNumbers(tokens);
  const commodity = listCommodities().find((c) => c.code === commodityCode);
  if (!commodity) return {};
  const unit = readUnit(commodity.id, tokens, numbers);
  const counts = numbers.filter((n) => !n.isWeight);
  const qty =
    readQuantity(tokens, numbers, unit.names, unit.kg ?? 0) ?? (counts.length === 1 && counts[0]!.value > 0 ? counts[0]!.value : null);
  return { ...(qty !== null && qty <= MAX_UNIT_QTY ? { unitQty: qty } : {}), ...(unit.code ? { unitCode: unit.code } : {}) };
}

/** An answer to "how much per bag?": pesewas, `null` for "let buyers offer", undefined if unclear. */
export function parsePriceAnswer(text: string): number | null | undefined {
  const tokens = words(text);
  return readPrice(text, tokens, scanNumbers(tokens), undefined, true);
}

/**
 * A spoken counter-offer (vision §8): "I can sell the 10 bags, but I want
 * 2,100 cedis per bag" → 10 units at GHS 2,100. Either part may be missing;
 * the call keeps the current value for it.
 */
export function parseCounterAnswer(text: string, commodityCode: string): { units?: number; pricePerUnit?: number } {
  const tokens = words(text);
  const numbers = scanNumbers(tokens);
  const money = moneyMentions(tokens, numbers);
  const out: { units?: number; pricePerUnit?: number } = {};
  const price = readPrice(text, tokens, numbers, undefined, money.length === 0 && numbers.length === 1);
  if (typeof price === 'number') out.pricePerUnit = price;
  const commodity = listCommodities().find((c) => c.code === commodityCode);
  if (commodity && money.length > 0) {
    const counts = numbers.filter((n) => !money.includes(n) && !n.isWeight);
    const unit = readUnit(commodity.id, tokens, counts);
    const units = readQuantity(tokens, counts, unit.names, unit.kg ?? 0);
    if (units !== null) out.units = units;
  }
  return out;
}
