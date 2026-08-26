import { eq } from 'drizzle-orm';
import { config } from '../config';
import { db } from '../db/client';
import { voiceListings, type VoiceListing } from '../db/schema';
import { t } from '../i18n';
import { getAsrProvider } from '../providers/asr/index';
import { getMtProvider } from '../providers/mt/index';
import { getFarmerByPhone, normalizePhone } from './farmers';
import { registerLot } from './lots';
import { queueSms } from './notifications';
import { listCommodities, listUnits } from './registries';
import type { GradeBand } from './types';

/**
 * The open-ended voice listing (D-038): the farmer says everything in one
 * breath — "I have ten bags of maize, good quality" — and the pipeline
 * (ASR → MT → parse) turns it into a live marketplace lot. No menus.
 */

export interface ParsedListing {
  commodityCode: string;
  unitCode: string;
  unitQty: number;
  declaredBand: GradeBand;
}

const COMMODITY_SYNONYMS: Record<string, string> = {
  corn: 'MAIZE',
  peanut: 'GROUNDNUT',
  peanuts: 'GROUNDNUT',
  chilli: 'PEPPER',
  chili: 'PEPPER',
  // Never map crops we don't carry (cassava etc.) — a wrong listing is worse
  // than the "we couldn't understand" SMS.
};

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};

// ASR splits or glues the unit at random: "50 kg", "50kg", "fifty kilos".
const KG_WORD = /^(kgs?|kilos?|kilograms?)$/;
const GLUED_KG = /^(\d+)(kgs?|kilos?|kilograms?)$/;

/** The ceiling the USSD quantity screen enforces — one path must not list what the other refuses. */
const MAX_UNIT_QTY = 100000;

/** A number heard in the sentence, with the tokens it occupies. */
interface NumberMention {
  value: number;
  start: number;
  /** Last token of the number itself; `spanEnd` also covers a trailing "kg". */
  end: number;
  spanEnd: number;
  /** "50 kg" is the SIZE of a bag, never a count of them — the gap is 100x. */
  isWeight: boolean;
}

const words = (phrase: string): string[] =>
  phrase.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

/**
 * Whole-word match with plural tolerance ("crates" is a crate, "tomatoes" a
 * tomato). Substring matching let "maizena" pass for maize and the letters of
 * "cabbage" pass for "bag".
 */
const sameWord = (token: string, word: string): boolean => {
  const stem = word.replace(/s$/, '');
  return token === stem || token === `${stem}s` || token === `${stem}es`;
};

/** Where a phrase is first spoken, as a token position; -1 if it never is. */
function phraseAt(tokens: string[], phrase: string[]): number {
  if (phrase.length === 0) return -1;
  for (let i = 0; i + phrase.length <= tokens.length; i += 1) {
    if (phrase.every((w, k) => sameWord(tokens[i + k]!, w))) return i;
  }
  return -1;
}

function scanNumbers(tokens: string[]): NumberMention[] {
  const found: NumberMention[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const glued = GLUED_KG.exec(tokens[i]!);
    if (glued) {
      found.push({ value: Number(glued[1]), start: i, end: i, spanEnd: i, isWeight: true });
      continue;
    }
    let value: number | null = null;
    let end = i;
    if (/^\d+$/.test(tokens[i]!)) {
      value = Number(tokens[i]);
    } else if (NUMBER_WORDS[tokens[i]!] !== undefined) {
      // Compose the whole run — "twenty five" is 25 and "two hundred" is 200.
      // Stopping at the first word listed a 200-bag harvest as 2.
      let running = 0;
      for (let j = i; j < tokens.length; j += 1) {
        const part = NUMBER_WORDS[tokens[j]!];
        if (part === undefined) {
          // "two hundred and fifty" — 'and' joins only when a number follows.
          if (tokens[j] === 'and' && NUMBER_WORDS[tokens[j + 1] ?? ''] !== undefined) continue;
          break;
        }
        running = part === 100 ? (running || 1) * 100 : running + part;
        end = j;
      }
      value = running;
    }
    if (value === null) continue;
    const isWeight = KG_WORD.test(tokens[end + 1] ?? '');
    found.push({ value, start: i, end, spanEnd: isWeight ? end + 1 : end, isWeight });
    i = isWeight ? end + 1 : end;
  }
  return found;
}

/**
 * How many containers — never how big one is. "100 kg bag of maize" is a single
 * 100kg bag, not 100 bags (10,000kg), and ASR says "50 kg" as often as "50kg".
 * Anything that stays ambiguous returns null: the farmer gets the "we could not
 * understand" SMS rather than a lot a hundred times her harvest.
 */
function readQuantity(tokens: string[], numbers: NumberMention[], unitNames: string[], unitKg: number): number | null {
  const isUnitWord = (i: number) => unitNames.some((w) => sameWord(tokens[i] ?? '', w));
  // "ten 50 kg bags" — the size sits between the count and its container.
  const pastWeights = (i: number): number => {
    const spanned = numbers.find((n) => n.isWeight && i >= n.start && i <= n.spanEnd);
    return spanned ? pastWeights(spanned.spanEnd + 1) : i;
  };

  const counts = numbers.filter((n) => !n.isWeight);
  const adjacent = counts.filter((n) => isUnitWord(pastWeights(n.spanEnd + 1)));
  let qty: number | null = null;
  if (adjacent.length === 1) qty = adjacent[0]!.value;
  else if (adjacent.length === 0 && counts.length === 1) qty = counts[0]!.value;
  // A size and nothing else: "a 100 kg bag of maize" is one of them. A weight
  // matching no container ("two hundred kilos of tomato") we refuse — inventing
  // the container would invent the number that moves escrow.
  else if (counts.length === 0 && numbers.length === 1 && numbers[0]!.value === unitKg) qty = 1;
  if (qty === null || qty <= 0) return null;
  return qty > MAX_UNIT_QTY ? null : qty;
}

/** Registry-driven extraction — no hardcoded crops; new commodities parse for free. */
export function parseListingText(text: string): ParsedListing | null {
  const tokens = words(text);
  if (tokens.length === 0) return null;
  const lower = ` ${tokens.join(' ')} `;

  // Commodity: every mention, in the order spoken. Registry order used to
  // decide it, so "no maize today but ten baskets of tomato" listed maize.
  const commodities = listCommodities();
  const mentions = commodities
    .map((c) => ({ code: c.code, at: phraseAt(tokens, words(t('en', c.nameKey))) }))
    .concat(Object.entries(COMMODITY_SYNONYMS).map(([word, code]) => ({ code, at: phraseAt(tokens, [word]) })))
    .filter((m) => m.at >= 0)
    .sort((a, b) => a.at - b.at);
  // The earliest mention names the lot — but two different crops in one breath
  // is a coin flip, and calling it wrong ships someone else's harvest.
  if (mentions.length === 0 || mentions.some((m) => m.code !== mentions[0]!.code)) return null;
  const commodity = commodities.find((c) => c.code === mentions[0]!.code);
  if (!commodity) return null;

  const numbers = scanNumbers(tokens);
  const weights = numbers.filter((n) => n.isWeight).map((n) => n.value);

  // Unit: the commodity's unit whose name shares a word with the text
  // ("bags" → "50kg bag"); a spoken kg size disambiguates same-word units.
  const units = listUnits(commodity.id).map((u) => ({
    unit: u,
    names: words(t('en', u.nameKey)).filter((w) => w.length > 2 && !/^\d/.test(w)),
  }));
  const scored = units
    .map(({ unit, names }) => {
      const wordHit = names.some((w) => tokens.some((tk) => sameWord(tk, w)));
      return { unit, score: (wordHit ? 2 : 0) + (weights.includes(unit.kgPerUnit) ? 1 : 0) };
    })
    // Tie ("bags" with no size): take the SMALLER unit — understating a
    // harvest is recoverable; overstating one breaks matches.
    .sort((a, b) => b.score - a.score || a.unit.kgPerUnit - b.unit.kgPerUnit);
  // No unit named at all: the same rule, so the smallest. listUnits orders by
  // code, which puts maize's 100kg bag first — "ten maize" listed 1,000kg when
  // ten olonka is 25kg.
  const smallest = units.map((u) => u.unit).sort((a, b) => a.kgPerUnit - b.kgPerUnit)[0];
  const unit = scored[0] && scored[0].score > 0 ? scored[0].unit : smallest;
  if (!unit) return null;

  const unitQty = readQuantity(tokens, numbers, units.flatMap((u) => u.names), unit.kgPerUnit);
  if (unitQty === null) return null;

  // Declared band from quality words — conservative default B, like any
  // self-assessment; the AI grade at pickup decides the payout anyway.
  const declaredBand: GradeBand = /excellent|premium|best|top |grade a/.test(lower)
    ? 'A'
    : /fair|poor|small|grade c/.test(lower)
      ? 'C'
      : 'B';

  return { commodityCode: commodity.code, unitCode: unit.code, unitQty, declaredBand };
}

export interface ProcessVoiceListingInput {
  phone: string;
  audioRef?: string | null;
  /** Mock-mode transcript (the tester's textarea). Real calls carry audioRef. */
  transcriptHint?: string | null;
}

export async function processVoiceListing(input: ProcessVoiceListingInput): Promise<VoiceListing> {
  const phone = normalizePhone(input.phone);
  const farmer = getFarmerByPhone(phone);
  const locale = farmer?.locale ?? 'en';

  const insert = (fields: Partial<typeof voiceListings.$inferInsert>): VoiceListing =>
    db
      .insert(voiceListings)
      .values({ phone, farmerId: farmer?.id ?? null, audioRef: input.audioRef ?? null, locale, ...fields })
      .returning()
      .get();

  if (!farmer) {
    // Honest dead-end: we can't list produce for a phone we don't know.
    queueSms({ phone, locale, templateKey: 'sms.listingFailed', params: { code: config.USSD_SHORTCODE } });
    return insert({ status: 'failed', error: 'not_registered' });
  }

  let transcript = '';
  let translated = '';
  try {
    transcript = await getAsrProvider().transcribe({ audioRef: input.audioRef, hint: input.transcriptHint, locale });
    translated = await getMtProvider().translate({ text: transcript, from: locale, to: 'en' });
  } catch (err) {
    queueSms({ phone, locale, templateKey: 'sms.listingFailed', params: { code: config.USSD_SHORTCODE } });
    return insert({ status: 'failed', transcript, error: `pipeline: ${(err as Error).message}` });
  }

  const parsed = parseListingText(translated);
  if (!parsed) {
    queueSms({ phone, locale, templateKey: 'sms.listingFailed', params: { code: config.USSD_SHORTCODE } });
    return insert({ status: 'failed', transcript, translatedText: translated, error: 'unparseable' });
  }

  try {
    const lot = registerLot({ farmerId: farmer.id, ...parsed, channel: 'ivr' });
    // The SMS receipt is the farmer's only written record — read back exactly
    // what went live (D-019's archive-what-was-promised rule).
    queueSms({
      phone,
      locale,
      templateKey: 'sms.listingCreated',
      params: { kg: lot.quantityKg, commodity: t(locale, `commodity.${parsed.commodityCode}`), band: parsed.declaredBand, lotCode: lot.lotCode, code: config.USSD_SHORTCODE },
      lotId: lot.id,
    });
    return insert({ status: 'listed', transcript, translatedText: translated, parsed: JSON.stringify(parsed), lotId: lot.id });
  } catch (err) {
    queueSms({ phone, locale, templateKey: 'sms.listingFailed', params: { code: config.USSD_SHORTCODE } });
    return insert({
      status: 'failed',
      transcript,
      translatedText: translated,
      parsed: JSON.stringify(parsed),
      error: `register: ${(err as Error).message}`,
    });
  }
}

export function getVoiceListing(id: string): VoiceListing | undefined {
  return db.select().from(voiceListings).where(eq(voiceListings.id, id)).get();
}
