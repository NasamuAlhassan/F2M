import {
  db,
  formatGhs,
  getBuyerById,
  getCommodityById,
  getDemand,
  getLot,
  listLotsByFarmer,
  listOpenRequests,
  offerOnRequest,
  priceTermsSchema,
  schema,
  t,
  unitsAvailable,
  type GradeBand,
  type Lot,
} from '@ftm/core';
import { eq } from 'drizzle-orm';
import type { UssdCtx, UssdScreen } from '../machine';
import { invalid, listLines, parseSelection } from './common';
import { parseGhs } from './offers';

/**
 * Buyer requests (Phase 1): what buyers want right now, public to every
 * farmer. Pick one, pick which of your listings to offer from, then quantity
 * and price per unit — the same offerOnRequest the web calls.
 */

const MAX_LISTED = 5;

async function unitOf(lot: Lot) {
  return (await db.select().from(schema.units).where(eq(schema.units.id, lot.unitId)))[0]!;
}

function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** The most this farmer can offer from this listing on this request, in whole units. */
async function maxUnits(ctx: UssdCtx): Promise<number> {
  const lot = await getLot(String(ctx.data.requestLotId));
  const demand = await getDemand(String(ctx.data.requestId));
  return Math.min(await unitsAvailable(lot), Math.floor(demand.remainingKg / (await unitOf(lot)).kgPerUnit + 1e-9));
}

export const requestsList: UssdScreen = {
  key: 'requests_list',
  render: async (ctx) => {
    const open = (await listOpenRequests()).slice(0, MAX_LISTED);
    ctx.data.requestIds = open.map((d) => d.id);
    if (open.length === 0) return [{ key: 'ussd.requests.none' }, { key: 'ussd.common.back' }];
    return [
      { key: 'ussd.requests.title' },
      ...listLines(
        await Promise.all(open.map(async (d) => {
                    const buyer = await getBuyerById(d.buyerId);
                    return t(ctx.locale, 'ussd.requests.item', {
                      kg: Math.round(d.remainingKg),
                      commodity: t(ctx.locale, getCommodityById(d.commodityId).nameKey),
                      buyer: buyer?.company ?? buyer?.name ?? '',
                    });
                  })),
        { hasMore: false },
      ),
    ];
  },
  handleInput: (input, ctx) => {
    if (input === '0') return { next: 'home' };
    const ids = (ctx.data.requestIds as string[]) ?? [];
    const idx = parseSelection(input, ids.length, 0);
    if (idx === null) return invalid();
    ctx.data.requestId = ids[idx];
    return { next: 'request_detail' };
  },
};

export const requestDetail: UssdScreen = {
  key: 'request_detail',
  render: async (ctx) => {
    const d = await getDemand(String(ctx.data.requestId));
    const buyer = await getBuyerById(d.buyerId);
    const terms = priceTermsSchema.parse(JSON.parse(d.priceTerms));
    return [
      {
        key: 'ussd.requests.detail',
        params: {
          buyer: buyer?.company ?? buyer?.name ?? '',
          kg: Math.round(d.remainingKg),
          commodity: t(ctx.locale, getCommodityById(d.commodityId).nameKey),
          band: t(ctx.locale, `band.${d.minBand}`),
          price: formatGhs(terms[d.minBand as GradeBand] ?? 0),
          end: shortDate(d.windowEnd),
        },
      },
      { key: 'ussd.requests.offer' },
      { key: 'ussd.common.back' },
    ];
  },
  handleInput: async (input, ctx) => {
    if (input === '0') return { next: 'requests_list' };
    if (input !== '1' || !ctx.farmer) return invalid();
    const d = await getDemand(String(ctx.data.requestId));
    const mine = (await listLotsByFarmer(ctx.farmer.id)).filter(
      (l) => l.commodityId === d.commodityId && (l.status === 'registered' || l.status === 'matched') && unitsAvailable(l) > 0,
    );
    if (mine.length === 0) {
      return { end: [{ key: 'ussd.requests.noLot', params: { commodity: t(ctx.locale, getCommodityById(d.commodityId).nameKey) } }] };
    }
    ctx.data.requestLotIds = mine.slice(0, MAX_LISTED).map((l) => l.id);
    return { next: 'request_pick_lot' };
  },
};

export const requestPickLot: UssdScreen = {
  key: 'request_pick_lot',
  render: async (ctx) => {
    const ids = (ctx.data.requestLotIds as string[]) ?? [];
    return [
      { key: 'ussd.requests.pickLot' },
      ...listLines(
        await Promise.all(ids.map(async (id) => {
                    const lot = await getLot(id);
                    return t(ctx.locale, 'ussd.requests.lotItem', {
                      code: lot.lotCode,
                      units: await unitsAvailable(lot),
                      unit: t(ctx.locale, (await unitOf(lot)).nameKey),
                    });
                  })),
        { hasMore: false },
      ),
    ];
  },
  handleInput: (input, ctx) => {
    if (input === '0') return { next: 'request_detail' };
    const ids = (ctx.data.requestLotIds as string[]) ?? [];
    const idx = parseSelection(input, ids.length, 0);
    if (idx === null) return invalid();
    ctx.data.requestLotId = ids[idx];
    return { next: 'request_units' };
  },
};

export const requestUnits: UssdScreen = {
  key: 'request_units',
  render: async (ctx) => {
    const lot = await getLot(String(ctx.data.requestLotId));
    return [{ key: 'ussd.requests.units', params: { unit: t(ctx.locale, (await unitOf(lot)).nameKey), max: await maxUnits(ctx) } }];
  },
  handleInput: async (input, ctx) => {
    const n = Number(input.trim());
    if (!Number.isInteger(n) || n < 1 || n > await maxUnits(ctx)) return { error: { key: 'ussd.sell.qtyInvalid' } };
    ctx.data.requestUnits = n;
    return { next: 'request_price' };
  },
};

export const requestPrice: UssdScreen = {
  key: 'request_price',
  render: async (ctx) => {
    const lot = await getLot(String(ctx.data.requestLotId));
    return [{ key: 'ussd.requests.price', params: { unit: t(ctx.locale, (await unitOf(lot)).nameKey) } }];
  },
  handleInput: (input, ctx) => {
    const pesewas = parseGhs(input);
    if (pesewas === null) return { error: { key: 'ussd.offer.priceInvalid' } };
    ctx.data.requestPrice = pesewas;
    return { next: 'request_confirm' };
  },
};

export const requestConfirm: UssdScreen = {
  key: 'request_confirm',
  render: async (ctx) => {
    const lot = await getLot(String(ctx.data.requestLotId));
    const d = await getDemand(String(ctx.data.requestId));
    const buyer = await getBuyerById(d.buyerId);
    const units = Number(ctx.data.requestUnits);
    const price = Number(ctx.data.requestPrice);
    return [
      {
        key: 'ussd.requests.confirm',
        params: {
          units,
          unit: t(ctx.locale, (await unitOf(lot)).nameKey),
          commodity: t(ctx.locale, getCommodityById(lot.commodityId).nameKey),
          buyer: buyer?.company ?? buyer?.name ?? '',
          price: formatGhs(price),
          total: formatGhs(units * price),
        },
      },
      { key: 'ussd.common.confirm' },
      { key: 'ussd.common.cancel' },
    ];
  },
  handleInput: async (input, ctx) => {
    if (input === '2') return { end: [{ key: 'ussd.common.cancelled' }] };
    if (input !== '1' || !ctx.farmer) return invalid();
    const offer = await offerOnRequest({
          farmerId: ctx.farmer.id,
          demandId: String(ctx.data.requestId),
          lotId: String(ctx.data.requestLotId),
          units: Number(ctx.data.requestUnits),
          pricePerUnit: Number(ctx.data.requestPrice),
          channel: 'ussd',
        });
    const buyer = await getBuyerById(offer.buyerId);
    return { end: [{ key: 'ussd.offer.counterSent', params: { buyer: buyer?.company ?? buyer?.name ?? '' } }] };
  },
};
