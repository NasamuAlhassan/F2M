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
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};

/** Registry-driven extraction — no hardcoded crops; new commodities parse for free. */
export function parseListingText(text: string): ParsedListing | null {
  const lower = ` ${text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ')} `;

  // Commodity: registry name (or a synonym) appearing in the text.
  const commodities = listCommodities();
  let commodity = commodities.find((c) => lower.includes(` ${t('en', c.nameKey).toLowerCase()}`));
  if (!commodity) {
    for (const [word, code] of Object.entries(COMMODITY_SYNONYMS)) {
      if (lower.includes(` ${word} `)) {
        commodity = commodities.find((c) => c.code === code);
        if (commodity) break;
      }
    }
  }
  if (!commodity) return null;

  // Quantity: first digit run or number word.
  let unitQty: number | null = null;
  for (const token of lower.split(/\s+/)) {
    if (/^\d+$/.test(token)) {
      unitQty = Number(token);
      break;
    }
    if (NUMBER_WORDS[token] !== undefined) {
      unitQty = NUMBER_WORDS[token];
      break;
    }
  }
  if (!unitQty || unitQty <= 0) return null;

  // Unit: the commodity's unit whose name shares a word with the text
  // ("bags" → "50kg bag"); a spoken kg size disambiguates same-word units.
  const units = listUnits(commodity.id);
  const scored = units
    .map((u) => {
      const name = t('en', u.nameKey).toLowerCase();
      const words = name.split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !/^\d/.test(w));
      const wordHit = words.some((w) => lower.includes(w.replace(/s$/, '')));
      const kgHit = new RegExp(`\\b${u.kgPerUnit}\\s*(kg|kilo)`).test(lower) || lower.includes(` ${name.split(' ')[0]} `);
      return { unit: u, score: (wordHit ? 2 : 0) + (kgHit ? 1 : 0) };
    })
    // Tie ("bags" with no size): take the SMALLER unit — understating a
    // harvest is recoverable; overstating one breaks matches.
    .sort((a, b) => b.score - a.score || a.unit.kgPerUnit - b.unit.kgPerUnit);
  const unit = scored[0] && scored[0].score > 0 ? scored[0].unit : units[0];
  if (!unit) return null;

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
