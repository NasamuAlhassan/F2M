import {
  config,
  DomainError,
  findCommodity,
  getCommodityByCode,
  getRegion,
  listCommodities,
  listUnits,
  parseCountAnswer,
  fillGaps,
  parseListingDraft,
  parsePriceAnswer,
  queueSms,
  registerLot,
  saveVoiceListing,
  t,
  type GradeBand,
  type I18nText,
  type ListingDraft,
} from '@ftm/core';
import type { Heard, IvrCtx, IvrFlow, IvrNode, IvrResult } from '../machine';
import { cropSay, DAY_MS, farmerOf, flash, HINT_KEY, HINT_NUMBER, priceSay, takeFlash, typedCount, typedPrice, unitSay } from './common';

/**
 * Listing by voice (Phase 2, vision §5.2, docs/PHASE2.md). The farmer first
 * says it all in one go; the call keeps what it understood and asks only for
 * what is missing or unclear, one question at a time (keypad or speech), reads
 * the whole listing back, and publishes only when the farmer presses 1.
 */

interface Draft extends ListingDraft {
  /** -1 = not harvested yet. */
  harvestedDaysAgo?: number;
  placeOk?: boolean;
  community?: string | null;
  /** Fields the language-model assist supplied (D-056) — kept with the saved listing, and always read back before publishing. */
  aiFilled?: string[];
}

type State = { draft?: Draft; tries?: Record<string, number>; cropPage?: number; qIdx?: number; qYes?: number };

const st = (ctx: IvrCtx) => ctx.state as State & Record<string, unknown>;
const draftOf = (ctx: IvrCtx): Draft => (st(ctx).draft ??= {});
const tries = (ctx: IvrCtx, field: string) => (st(ctx).tries ??= {})[field] ?? 0;
const tried = (ctx: IvrCtx, field: string) => {
  const t = (st(ctx).tries ??= {});
  t[field] = (t[field] ?? 0) + 1;
};

const CROP_PAGE = 4;

/** Keep only what fits this crop's rules — a perishable can't be listed for next week. */
function merge(ctx: IvrCtx, parsed: ListingDraft): void {
  const d = draftOf(ctx);
  if (parsed.commodityCode && parsed.commodityCode !== d.commodityCode) {
    d.commodityCode = parsed.commodityCode;
    delete d.unitCode;
  }
  for (const k of ['unitCode', 'unitQty', 'pricePerUnit', 'harvestedDaysAgo', 'readyInDays', 'declaredBand'] as const) {
    if (parsed[k] !== undefined) (d as Record<string, unknown>)[k] = parsed[k];
  }
  if (d.commodityCode && d.readyInDays !== undefined) {
    const { clock } = getCommodityByCode(d.commodityCode);
    if (!clock.allowsForward && d.readyInDays > 1) delete d.readyInDays;
    else if (d.readyInDays !== undefined && d.readyInDays > 180) delete d.readyInDays;
  }
}

/** The next thing to ask, in the vision's order; the readback once nothing is missing. */
function nextStep(ctx: IvrCtx): IvrResult {
  const d = draftOf(ctx);
  if (!d.commodityCode) return { next: tries(ctx, 'crop') >= 2 ? 'list_crop_keys' : 'list_crop_say' };
  if (!d.unitCode) {
    const units = listUnits(getCommodityByCode(d.commodityCode).id);
    if (units.length === 1) d.unitCode = units[0]!.code;
    else return { next: 'list_unit' };
  }
  if (d.unitQty === undefined) return { next: 'list_qty' };
  if (d.pricePerUnit === undefined) return { next: 'list_price' };
  if (d.harvestedDaysAgo === undefined) return { next: 'list_harvest' };
  if (d.readyInDays === undefined) return { next: 'list_ready' };
  if (d.declaredBand === undefined) {
    st(ctx).qIdx = 0;
    st(ctx).qYes = 0;
    return { next: 'list_quality' };
  }
  if (d.placeOk === undefined) return { next: 'list_place' };
  return { next: 'list_review' };
}

/** A speech answer that was not understood: say sorry, and after two tries move to the keypad. */
function notUnderstood(ctx: IvrCtx, field: string, keypadNode?: string): IvrResult {
  tried(ctx, field);
  flash(ctx, 'voice.common.sorry');
  if (keypadNode && tries(ctx, field) >= 2) return { next: keypadNode };
  return nextStep(ctx);
}

function notRegistered(ctx: IvrCtx): I18nText[] | null {
  return farmerOf(ctx) ? null : [{ key: 'voice.list.notRegistered', params: { code: config.USSD_SHORTCODE } }];
}

// ── 1. tell us ───────────────────────────────────────────────────────────
const intro: IvrNode = {
  key: 'list_intro',
  input: 'speech',
  guard: notRegistered,
  say: (ctx) => [...takeFlash(ctx), { key: 'voice.listing.intro' }, { key: 'voice.listing.tellUs' }],
  onSpeech: (heard, ctx) => {
    if (heard) {
      const rules = parseListingDraft(heard.english);
      // The assist may only fill what the rules did not hear. Everything it adds is still
      // read back in the review step, and published only on the farmer's 1 (D-052, D-056).
      const { draft, aiFilled } = heard.assist ? fillGaps(rules, heard.assist.draft) : { draft: rules, aiFilled: [] as string[] };
      merge(ctx, draft);
      if (aiFilled.length > 0) draftOf(ctx).aiFilled = [...new Set([...(draftOf(ctx).aiFilled ?? []), ...aiFilled])];
    }
    return nextStep(ctx);
  },
};

// ── 2. crop ──────────────────────────────────────────────────────────────
const cropSayNode: IvrNode = {
  key: 'list_crop_say',
  input: 'speech',
  say: (ctx) => [...takeFlash(ctx), { key: 'voice.listing.askCrop' }],
  onSpeech: (heard, ctx) => {
    const found = heard ? findCommodity(heard.english) : { ambiguous: false };
    if (!found.code) return notUnderstood(ctx, 'crop', 'list_crop_keys');
    merge(ctx, { ...(heard ? parseListingDraft(heard.english, { commodityCode: found.code }) : {}), commodityCode: found.code });
    return nextStep(ctx);
  },
};

const cropKeys: IvrNode = {
  key: 'list_crop_keys',
  say: (ctx) => {
    const all = listCommodities();
    const page = st(ctx).cropPage ?? 0;
    const items = all.slice(page * CROP_PAGE, page * CROP_PAGE + CROP_PAGE);
    return [
      ...takeFlash(ctx),
      { key: 'voice.listing.pickCrop' },
      ...items.map((c, i) => ({ key: 'voice.common.option', params: { n: i + 1, label: t(ctx.locale, c.nameKey) } })),
      ...((page + 1) * CROP_PAGE < all.length ? [{ key: 'voice.listing.moreCrops' }] : []),
      HINT_KEY,
    ];
  },
  onDigits: (digits, ctx) => {
    const all = listCommodities();
    const page = st(ctx).cropPage ?? 0;
    if (digits === '8' && (page + 1) * CROP_PAGE < all.length) {
      st(ctx).cropPage = page + 1;
      return { next: 'list_crop_keys' };
    }
    if (digits === '0') {
      if (page > 0) st(ctx).cropPage = page - 1;
      return { next: page > 0 ? 'list_crop_keys' : 'list_intro' };
    }
    const pick = all[page * CROP_PAGE + Number(digits) - 1];
    if (!/^[1-4]$/.test(digits) || !pick) return { next: 'list_crop_keys' };
    st(ctx).cropPage = 0;
    merge(ctx, { commodityCode: pick.code });
    return nextStep(ctx);
  },
};

// ── 3. unit and quantity ─────────────────────────────────────────────────
const unitNode: IvrNode = {
  key: 'list_unit',
  back: 'list_crop_keys',
  say: (ctx) => {
    const units = listUnits(getCommodityByCode(draftOf(ctx).commodityCode!).id);
    return [
      ...takeFlash(ctx),
      { key: 'voice.listing.askUnit', params: { commodity: cropSay(ctx, draftOf(ctx).commodityCode!) } },
      ...units.map((u, i) => ({ key: 'voice.common.option', params: { n: i + 1, label: t(ctx.locale, u.nameKey) } })),
      HINT_KEY,
    ];
  },
  onDigits: (digits, ctx) => {
    const units = listUnits(getCommodityByCode(draftOf(ctx).commodityCode!).id);
    const pick = /^[1-8]$/.test(digits) ? units[Number(digits) - 1] : undefined;
    if (!pick) return { next: 'list_unit' };
    draftOf(ctx).unitCode = pick.code;
    return nextStep(ctx);
  },
};

const qtyNode: IvrNode = {
  key: 'list_qty',
  input: 'numberOrSpeech',
  say: (ctx) => [...takeFlash(ctx), { key: 'voice.listing.askQty', params: { unit: unitSay(ctx, draftOf(ctx).unitCode!) } }, HINT_NUMBER],
  onDigits: (digits, ctx) => {
    const n = typedCount(digits);
    if (n === null) return notUnderstood(ctx, 'qty');
    draftOf(ctx).unitQty = n;
    return nextStep(ctx);
  },
  onSpeech: (heard, ctx) => {
    const d = draftOf(ctx);
    const got = heard ? parseCountAnswer(heard.english, d.commodityCode!) : {};
    if (got.unitQty === undefined) return notUnderstood(ctx, 'qty');
    d.unitQty = got.unitQty;
    return nextStep(ctx);
  },
};

// ── 4. price ─────────────────────────────────────────────────────────────
const priceNode: IvrNode = {
  key: 'list_price',
  input: 'numberOrSpeech',
  say: (ctx) => [...takeFlash(ctx), { key: 'voice.listing.askPrice', params: { unit: unitSay(ctx, draftOf(ctx).unitCode!) } }, HINT_NUMBER],
  onDigits: (digits, ctx) => {
    const price = typedPrice(digits);
    if (price === undefined) return notUnderstood(ctx, 'price');
    draftOf(ctx).pricePerUnit = price;
    return nextStep(ctx);
  },
  onSpeech: (heard, ctx) => {
    const price = heard ? parsePriceAnswer(heard.english) : undefined;
    if (price === undefined) return notUnderstood(ctx, 'price');
    draftOf(ctx).pricePerUnit = price;
    return nextStep(ctx);
  },
};

// ── 5. harvest and ready dates ───────────────────────────────────────────
const HARVEST_DAYS: Record<string, number> = { '1': 0, '2': 1, '3': 3, '4': 10, '5': -1 };
const harvestNode: IvrNode = {
  key: 'list_harvest',
  say: (ctx) => [...takeFlash(ctx), { key: 'voice.listing.askHarvest' }, HINT_KEY],
  onDigits: (digits, ctx) => {
    if (HARVEST_DAYS[digits] === undefined) return { next: 'list_harvest' };
    draftOf(ctx).harvestedDaysAgo = HARVEST_DAYS[digits];
    return nextStep(ctx);
  },
};

const READY_DAYS: Record<string, number> = { '1': 0, '2': 1, '3': 7, '4': 14 };
const readyNode: IvrNode = {
  key: 'list_ready',
  say: (ctx) => {
    const { clock } = getCommodityByCode(draftOf(ctx).commodityCode!);
    return [...takeFlash(ctx), { key: clock.allowsForward ? 'voice.listing.askReady' : 'voice.listing.askReadyPerishable' }, HINT_KEY];
  },
  onDigits: (digits, ctx) => {
    const { clock } = getCommodityByCode(draftOf(ctx).commodityCode!);
    const days = READY_DAYS[digits];
    if (days === undefined || (!clock.allowsForward && days > 1)) return { next: 'list_ready' };
    draftOf(ctx).readyInDays = days;
    return nextStep(ctx);
  },
};

// ── 6. quality: two questions written for the crop ───────────────────────
const qualityNode: IvrNode = {
  key: 'list_quality',
  say: (ctx) => [
    ...takeFlash(ctx),
    ...((st(ctx).qIdx ?? 0) === 0 ? [{ key: 'voice.listing.qualityIntro' }] : []),
    { key: `voice.quality.${draftOf(ctx).commodityCode}.${(st(ctx).qIdx ?? 0) + 1}` },
    { key: 'voice.common.yesNo' },
  ],
  onDigits: (digits, ctx) => {
    if (digits !== '1' && digits !== '2') return { next: 'list_quality' };
    const s = st(ctx);
    s.qYes = (s.qYes ?? 0) + (digits === '1' ? 1 : 0);
    s.qIdx = (s.qIdx ?? 0) + 1;
    if (s.qIdx < 2) return { next: 'list_quality' };
    // Both yes → A, one → B, none → C. A self-assessment, like the USSD
    // grade question; the AI grade at pickup decides the payout either way.
    const bands: GradeBand[] = ['C', 'B', 'A'];
    draftOf(ctx).declaredBand = bands[s.qYes ?? 0]!;
    return nextStep(ctx);
  },
};

// ── 7. place ─────────────────────────────────────────────────────────────
function placeName(ctx: IvrCtx): string {
  const farmer = farmerOf(ctx)!;
  const region = t(ctx.locale, getRegion(farmer.regionCode).nameKey);
  return farmer.district ? `${farmer.district}, ${region}` : region;
}

const placeNode: IvrNode = {
  key: 'list_place',
  say: (ctx) => [...takeFlash(ctx), { key: 'voice.listing.askPlace', params: { place: placeName(ctx) } }, HINT_KEY],
  onDigits: (digits, ctx) => {
    if (digits === '1') {
      draftOf(ctx).placeOk = true;
      return nextStep(ctx);
    }
    if (digits === '2') return { next: 'list_community' };
    return { next: 'list_place' };
  },
};

const communityNode: IvrNode = {
  key: 'list_community',
  input: 'speech',
  say: (ctx) => [...takeFlash(ctx), { key: 'voice.listing.askCommunity' }],
  onSpeech: (heard, ctx) => {
    // A place name is a proper noun: keep it as heard in the farmer's own
    // language, not as the translation, and read it back for a yes.
    const name = heard?.transcript.replace(/[.,!?]+$/, '').trim();
    if (!name) return notUnderstood(ctx, 'community');
    draftOf(ctx).community = name.slice(0, 80);
    draftOf(ctx).placeOk = true;
    return nextStep(ctx);
  },
};

// ── 8. read back, change, publish ────────────────────────────────────────
export function reviewLines(ctx: IvrCtx): I18nText[] {
  const d = draftOf(ctx);
  const unit = unitSay(ctx, d.unitCode!);
  const lines: I18nText[] = [
    { key: 'voice.listing.reviewItem', params: { units: d.unitQty!, unit, commodity: cropSay(ctx, d.commodityCode!) } },
    d.pricePerUnit ? { key: 'voice.listing.reviewPrice', params: { unit, price: priceSay(d.pricePerUnit) } } : { key: 'voice.listing.reviewNoPrice' },
  ];
  const h = d.harvestedDaysAgo!;
  lines.push(
    h < 0
      ? { key: 'voice.listing.reviewNotHarvested' }
      : h === 0
        ? { key: 'voice.listing.reviewHarvestToday' }
        : h === 1
          ? { key: 'voice.listing.reviewHarvestYesterday' }
          : { key: 'voice.listing.reviewHarvestDays', params: { n: h } },
  );
  const r = d.readyInDays!;
  lines.push(
    r === 0 ? { key: 'voice.listing.reviewReadyNow' } : r === 1 ? { key: 'voice.listing.reviewReadyTomorrow' } : { key: 'voice.listing.reviewReadyDays', params: { n: r } },
  );
  lines.push({ key: 'voice.listing.reviewQuality', params: { band: d.declaredBand! } });
  lines.push({ key: 'voice.listing.reviewPlace', params: { place: d.community ? `${d.community}, ${placeName(ctx)}` : placeName(ctx) } });
  return lines;
}

const reviewNode: IvrNode = {
  key: 'list_review',
  say: (ctx) => [...takeFlash(ctx), ...reviewLines(ctx), { key: 'voice.listing.reviewMenu' }, HINT_KEY],
  onDigits: (digits, ctx) => {
    if (digits === '1') return publish(ctx);
    if (digits === '2') return { next: 'list_change' };
    if (digits === '3') return { end: [{ key: 'voice.listing.cancelled' }], outcome: { result: 'cancelled' } };
    return { next: 'list_review' };
  },
};

const changeNode: IvrNode = {
  key: 'list_change',
  back: 'list_review',
  say: (ctx) => [...takeFlash(ctx), { key: 'voice.listing.changeMenu' }, HINT_KEY],
  onDigits: (digits, ctx) => {
    const d = draftOf(ctx);
    switch (digits) {
      case '1':
        delete d.commodityCode;
        delete d.unitCode;
        delete d.unitQty;
        st(ctx).tries = { ...st(ctx).tries, crop: 2 }; // straight to the keypad list: speech already missed once
        break;
      case '2':
        delete d.unitQty;
        break;
      case '3':
        delete d.pricePerUnit;
        break;
      case '4':
        delete d.harvestedDaysAgo;
        delete d.readyInDays;
        break;
      case '5':
        delete d.declaredBand;
        break;
      case '6':
        delete d.placeOk;
        delete d.community;
        break;
      default:
        return { next: 'list_change' };
    }
    return nextStep(ctx);
  },
};

function publish(ctx: IvrCtx): IvrResult {
  const farmer = farmerOf(ctx)!;
  const d = draftOf(ctx);
  const heard = (ctx.state._heard as Heard[] | undefined) ?? [];
  const now = Date.now();
  try {
    const lot = registerLot({
      farmerId: farmer.id,
      commodityCode: d.commodityCode!,
      unitCode: d.unitCode!,
      unitQty: d.unitQty!,
      declaredBand: d.declaredBand!,
      readyDate: now + d.readyInDays! * DAY_MS,
      ...(d.pricePerUnit ? { askingPricePerUnit: d.pricePerUnit } : {}),
      ...(d.harvestedDaysAgo! >= 0 ? { harvestedAt: now - d.harvestedDaysAgo! * DAY_MS } : {}),
      ...(d.community ? { community: d.community } : {}),
      channel: 'ivr',
    });
    saveVoiceListing({ phone: farmer.phone, farmerId: farmer.id, locale: ctx.locale, heard, parsed: d, lotId: lot.id });
    queueSms({
      phone: farmer.phone,
      locale: farmer.locale,
      templateKey: 'sms.listingCreated',
      params: {
        kg: lot.quantityKg,
        commodity: t(farmer.locale, `commodity.${d.commodityCode}`),
        band: d.declaredBand!,
        lotCode: lot.lotCode,
        code: config.USSD_SHORTCODE,
      },
      lotId: lot.id,
    });
    if (ctx.call.flow === 'line') {
      flash(ctx, 'voice.listing.publishedShort', { lotCode: lot.lotCode });
      return { next: 'line_menu' };
    }
    return { end: [{ key: 'voice.listing.published', params: { lotCode: lot.lotCode } }], outcome: { result: 'listed', lotId: lot.id } };
  } catch (err) {
    if (!(err instanceof DomainError)) throw err;
    saveVoiceListing({ phone: farmer.phone, farmerId: farmer.id, locale: ctx.locale, heard, parsed: d, error: err.message });
    queueSms({ phone: farmer.phone, locale: farmer.locale, templateKey: 'sms.listingFailed', params: { code: config.USSD_SHORTCODE } });
    return { end: [{ key: 'voice.listing.couldNot', params: { code: config.USSD_SHORTCODE } }], outcome: { result: 'failed', error: err.code } };
  }
}

export const listingNodes: IvrNode[] = [
  intro,
  cropSayNode,
  cropKeys,
  unitNode,
  qtyNode,
  priceNode,
  harvestNode,
  readyNode,
  qualityNode,
  placeNode,
  communityNode,
  reviewNode,
  changeNode,
];

export const listingFlow: IvrFlow = { entry: 'list_intro', nodes: listingNodes };
