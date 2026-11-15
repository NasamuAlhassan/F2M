import {
  acceptOfferThread,
  counterOffer,
  DomainError,
  describeOffer,
  formatGhs,
  getOffer,
  listOffersForFarmer,
  rejectOffer,
  t,
  withdrawOffer,
  type I18nText,
  type Offer,
} from '@ftm/core';
import type { UssdCtx, UssdScreen } from '../machine';
import { invalid, listLines, parseSelection } from './common';

/**
 * My offers (Phase 1): every negotiation the farmer is in, the ones waiting on
 * them first. On their turn they accept, counter (price per unit typed on the
 * keypad, optionally a new quantity) or reject; while waiting on the buyer they
 * can withdraw their own proposal. The same core moves the web and voice use.
 */

const MAX_LISTED = 5;

async function sortedOpen(farmerId: string): Promise<Offer[]> {
  return (await listOffersForFarmer(farmerId, 'open')).sort((a, b) => Number(b.turn === 'farmer') - Number(a.turn === 'farmer'));
}

/** Pesewas from what a farmer types: "2000", "2000.50", "2,000". */
export function parseGhs(input: string): number | null {
  const cleaned = input.replace(/,/g, '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const pesewas = Math.round(Number(cleaned) * 100);
  return pesewas > 0 ? pesewas : null;
}

function expiresLabel(ctx: UssdCtx, expiresAt: number | null): I18nText[] {
  if (expiresAt === null) return [];
  const left = Math.max(0, expiresAt - Date.now());
  const when =
    left >= 90 * 60 * 1000
      ? t(ctx.locale, 'ussd.offer.expiresHours', { n: Math.round(left / 3_600_000) })
      : t(ctx.locale, 'ussd.offer.expiresMins', { n: Math.max(1, Math.round(left / 60_000)) });
  return [{ key: 'ussd.offer.expires', params: { when } }];
}

/** "{units} {unit}" in the farmer's language — the listing's own unit. */
async function view(ctx: UssdCtx, offer: Offer) {
  const v = await describeOffer(offer);
  return {
    v,
    unit: t(ctx.locale, `unit.${v.lot.unitCode}`),
    commodity: t(ctx.locale, `commodity.${v.lot.commodityCode}`),
    buyer: v.buyer.company ?? v.buyer.name,
  };
}

/** A move that raced the other side (they answered, the offer lapsed…) ends politely. */
function gone(err: unknown): { end: I18nText[] } | null {
  if (err instanceof DomainError && ['OFFER_CLOSED', 'OFFER_EXPIRED', 'NOT_YOUR_TURN', 'LOT_CLOSED'].includes(err.code)) {
    return { end: [{ key: 'ussd.offer.gone' }] };
  }
  if (err instanceof DomainError && err.code === 'NOT_ENOUGH_LEFT') {
    return { end: [{ key: 'ussd.offer.notEnough', params: { message: err.message } }] };
  }
  return null;
}

export const offersList: UssdScreen = {
  key: 'offers_list',
  render: async (ctx) => {
    if (!ctx.farmer) return [{ key: 'ussd.offers.none' }, { key: 'ussd.common.back' }];
    const open = (await sortedOpen(ctx.farmer.id)).slice(0, MAX_LISTED);
    ctx.data.offerIds = open.map((o) => o.id);
    if (open.length === 0) return [{ key: 'ussd.offers.none' }, { key: 'ussd.common.back' }];
    return [
      { key: 'ussd.offers.title' },
      ...listLines(
        await Promise.all(open.map(async (o) => {
                    const { v, unit, commodity } = await view(ctx, o);
                    return t(ctx.locale, o.turn === 'farmer' ? 'ussd.offers.itemYourTurn' : 'ussd.offers.itemWaiting', {
                      units: v.current.units,
                      unit,
                      commodity,
                      price: formatGhs(v.current.pricePerUnit),
                    });
                  })),
        { hasMore: false },
      ),
    ];
  },
  handleInput: (input, ctx) => {
    if (input === '0') return { next: 'home' };
    const offerIds = (ctx.data.offerIds as string[]) ?? [];
    const idx = parseSelection(input, offerIds.length, 0);
    if (idx === null) return invalid();
    ctx.data.offerId = offerIds[idx];
    return { next: 'offer_detail' };
  },
};

export const offerDetail: UssdScreen = {
  key: 'offer_detail',
  render: async (ctx) => {
    const offer = await getOffer(String(ctx.data.offerId));
    const { v, unit, commodity, buyer } = await view(ctx, offer);
    if (offer.status !== 'open') return [{ key: 'ussd.offer.gone' }, { key: 'ussd.common.back' }];
    const params = {
      buyer,
      units: v.current.units,
      unit,
      commodity,
      price: formatGhs(v.current.pricePerUnit),
      total: formatGhs(v.current.total),
    };
    if (offer.turn === 'farmer') {
      return [
        { key: 'ussd.offer.theirProposal', params },
        ...(v.lot.askingPricePerUnit ? [{ key: 'ussd.offer.youAsked', params: { price: formatGhs(v.lot.askingPricePerUnit) } }] : []),
        ...expiresLabel(ctx, v.expiresAt),
        { key: 'ussd.offer.accept' },
        { key: 'ussd.offer.counter' },
        { key: 'ussd.offer.reject' },
        { key: 'ussd.common.back' },
      ];
    }
    return [
      { key: 'ussd.offer.yourProposal', params },
      ...expiresLabel(ctx, v.expiresAt),
      { key: 'ussd.offer.withdraw' },
      { key: 'ussd.common.back' },
    ];
  },
  handleInput: async (input, ctx) => {
    if (input === '0') return { next: 'offers_list' };
    if (!ctx.farmer) return invalid();
    const offerId = String(ctx.data.offerId);
    const offer = await getOffer(offerId);
    try {
      if (offer.turn === 'farmer') {
        if (input === '1') {
          const { offer: done } = await acceptOfferThread(offerId, 'farmer', ctx.farmer.id, 'ussd');
          const { v, unit, commodity } = await view(ctx, done);
          return { end: [{ key: 'ussd.offer.agreed', params: { units: v.current.units, unit, commodity, total: formatGhs(v.current.total) } }] };
        }
        if (input === '2') return { next: 'offer_counter_price' };
        if (input === '3') {
          await rejectOffer(offerId, 'farmer', ctx.farmer.id, 'ussd');
          return { end: [{ key: 'ussd.offer.rejected' }] };
        }
      } else if (input === '1') {
        await withdrawOffer(offerId, 'farmer', ctx.farmer.id, 'ussd');
        return { end: [{ key: 'ussd.offer.withdrawn' }] };
      }
    } catch (err) {
      const polite = gone(err);
      if (polite) return polite;
      throw err;
    }
    return invalid();
  },
};

export const offerCounterPrice: UssdScreen = {
  key: 'offer_counter_price',
  render: async (ctx) => {
    const { v, unit } = await view(ctx, await getOffer(String(ctx.data.offerId)));
    return [{ key: 'ussd.offer.counterPrice', params: { unit, price: formatGhs(v.current.pricePerUnit) } }];
  },
  handleInput: (input, ctx) => {
    const pesewas = parseGhs(input);
    if (pesewas === null) return { error: { key: 'ussd.offer.priceInvalid' } };
    ctx.data.counterPrice = pesewas;
    return { next: 'offer_counter_units' };
  },
};

export const offerCounterUnits: UssdScreen = {
  key: 'offer_counter_units',
  render: async (ctx) => {
    const { v, unit } = await view(ctx, await getOffer(String(ctx.data.offerId)));
    return [{ key: 'ussd.offer.counterUnits', params: { unit, units: v.current.units } }];
  },
  handleInput: async (input, ctx) => {
    const offer = await getOffer(String(ctx.data.offerId));
    const n = Number(input.trim());
    if (!Number.isInteger(n) || n < 0) return { error: { key: 'ussd.sell.qtyInvalid' } };
    ctx.data.counterUnits = n === 0 ? offer.units : n;
    return { next: 'offer_counter_confirm' };
  },
};

export const offerCounterConfirm: UssdScreen = {
  key: 'offer_counter_confirm',
  render: async (ctx) => {
    const { unit, commodity } = await view(ctx, await getOffer(String(ctx.data.offerId)));
    const units = Number(ctx.data.counterUnits);
    const price = Number(ctx.data.counterPrice);
    return [
      { key: 'ussd.offer.counterConfirm', params: { units, unit, commodity, price: formatGhs(price), total: formatGhs(units * price) } },
      { key: 'ussd.common.confirm' },
      { key: 'ussd.common.cancel' },
    ];
  },
  handleInput: async (input, ctx) => {
    if (input === '2') return { next: 'offer_detail' };
    if (input !== '1' || !ctx.farmer) return invalid();
    try {
      const sent = await counterOffer(
              String(ctx.data.offerId),
              'farmer',
              ctx.farmer.id,
              { units: Number(ctx.data.counterUnits), pricePerUnit: Number(ctx.data.counterPrice) },
              'ussd',
            );
      return { end: [{ key: 'ussd.offer.counterSent', params: { buyer: (await view(ctx, sent)).buyer } }] };
    } catch (err) {
      const polite = gone(err);
      if (polite) return polite;
      throw err;
    }
  },
};
