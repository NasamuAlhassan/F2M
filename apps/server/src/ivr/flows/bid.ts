import {
  acceptOfferThread,
  counterOffer,
  describeOffer,
  DomainError,
  formatGhs,
  getOffer,
  parseCounterAnswer,
  rejectOffer,
  unitsAvailable,
  getLot,
  type I18nText,
} from '@ftm/core';
import type { IvrCtx, IvrFlow, IvrNode, IvrResult } from '../machine';
import { cropSay, farmerOf, flash, HINT_KEY, HINT_NUMBER, takeFlash, typedCount, typedPrice, unitSay } from './common';

/**
 * Hearing an offer (Phase 1, voice negotiation Phase 2 — vision §8): the call
 * reads the buyer's current proposal and takes 1 accept, 2 reject, 3 counter,
 * 4 (or 9) hear it again. A counter is a price per unit, typed or said ("I can
 * sell the 10 bags but I want 2,100 cedis a bag"), then the quantity, then a
 * readback before it is sent. Same core moves as USSD and the web.
 *
 * Reached two ways: F2M rings the farmer about one offer (`call.offerId`), or
 * the farmer hears their waiting offers from the listing line
 * (`state.offerId`), in which case each answer returns to that list.
 */

const offerIdOf = (ctx: IvrCtx) => ctx.call.offerId ?? (ctx.state.offerId as string | undefined);
const fromLine = (ctx: IvrCtx) => ctx.call.flow === 'line';

type Counter = { pricePerUnit?: number; units?: number };
const counterOf = (ctx: IvrCtx): Counter => (ctx.state.counter ??= {}) as Counter;

const GONE_CODES = ['OFFER_CLOSED', 'OFFER_EXPIRED', 'NOT_YOUR_TURN', 'LOT_CLOSED', 'NOT_ENOUGH_LEFT', 'FORBIDDEN'];

function bidGuard(ctx: IvrCtx): I18nText[] | null {
  const id = offerIdOf(ctx);
  if (!id) return [{ key: 'voice.offer.gone' }];
  const offer = getOffer(id);
  if (offer.status !== 'open' || offer.turn !== 'farmer') return [{ key: 'voice.offer.gone' }];
  return null;
}

function view(ctx: IvrCtx) {
  return describeOffer(getOffer(offerIdOf(ctx)!));
}

/** Done with this offer: on the listing line go back to the list, on an offer call say goodbye. */
function finish(ctx: IvrCtx, key: string, params: Record<string, string | number>, outcome: Record<string, unknown>): IvrResult {
  delete ctx.state.counter;
  if (fromLine(ctx)) {
    flash(ctx, key, params);
    return { next: 'line_offers' };
  }
  return { end: [{ key, params }, { key: 'voice.common.bye' }], outcome };
}

function gone(ctx: IvrCtx): IvrResult {
  if (fromLine(ctx)) return finish(ctx, 'voice.line.offerGone', {}, { result: 'gone' });
  return { end: [{ key: 'voice.offer.gone' }], outcome: { result: 'gone' } };
}

const main: IvrNode = {
  key: 'bid_main',
  guard: (ctx) => (fromLine(ctx) ? null : bidGuard(ctx)),
  say: (ctx) => {
    if (bidGuard(ctx)) return [{ key: 'voice.offer.gone' }, { key: 'voice.bid.backToList' }];
    const v = view(ctx);
    return [
      ...takeFlash(ctx),
      {
        key: 'voice.bid.intro',
        params: {
          buyer: v.buyer.company ?? v.buyer.name,
          units: v.current.units,
          unit: unitSay(ctx, v.lot.unitCode),
          commodity: cropSay(ctx, v.lot.commodityCode),
          price: formatGhs(v.current.pricePerUnit),
          total: formatGhs(v.current.total),
        },
      },
      { key: 'voice.bid.menu2' },
    ];
  },
  onDigits: async (digits, ctx) => {
    if (bidGuard(ctx)) return fromLine(ctx) ? { next: 'line_offers' } : gone(ctx);
    const farmer = farmerOf(ctx);
    const offerId = offerIdOf(ctx)!;
    if (!farmer) return { end: [{ key: 'voice.common.goodbye' }], outcome: { result: 'no_context' } };
    try {
      if (digits === '1') {
        const { offer } = await acceptOfferThread(offerId, 'farmer', farmer.id, 'ivr');
        return finish(ctx, 'voice.bid.accepted', { total: formatGhs(describeOffer(offer).current.total) }, { result: 'accepted' });
      }
      if (digits === '2') {
        rejectOffer(offerId, 'farmer', farmer.id, 'ivr');
        return finish(ctx, 'voice.bid.rejected', {}, { result: 'rejected' });
      }
    } catch (err) {
      if (err instanceof DomainError && GONE_CODES.includes(err.code)) return gone(ctx);
      throw err;
    }
    if (digits === '3') {
      ctx.state.counter = {};
      return { next: 'bid_counter_price' };
    }
    if (digits === '0' && fromLine(ctx)) return { next: 'line_offers' };
    return { next: 'bid_main' }; // 4, or any other key — say it again
  },
};

const counterPrice: IvrNode = {
  key: 'bid_counter_price',
  input: 'numberOrSpeech',
  guard: bidGuard,
  say: (ctx) => [...takeFlash(ctx), { key: 'voice.bid.askPrice', params: { unit: unitSay(ctx, view(ctx).lot.unitCode) } }, HINT_NUMBER],
  onDigits: (digits, ctx) => {
    const price = typedPrice(digits);
    if (!price) {
      flash(ctx, 'voice.common.sorry');
      return { next: 'bid_counter_price' };
    }
    counterOf(ctx).pricePerUnit = price;
    return { next: 'bid_counter_units' };
  },
  onSpeech: (heard, ctx) => {
    const got = heard ? parseCounterAnswer(heard.english, view(ctx).lot.commodityCode) : {};
    if (!got.pricePerUnit) {
      flash(ctx, 'voice.common.sorry');
      return { next: 'bid_counter_price' };
    }
    Object.assign(counterOf(ctx), got);
    // "the 10 bags at 2,100" already says how many: straight to the readback.
    return { next: got.units ? 'bid_counter_confirm' : 'bid_counter_units' };
  },
};

const counterUnits: IvrNode = {
  key: 'bid_counter_units',
  input: 'number',
  guard: bidGuard,
  say: (ctx) => {
    const v = view(ctx);
    return [...takeFlash(ctx), { key: 'voice.bid.askUnits', params: { units: v.current.units, unit: unitSay(ctx, v.lot.unitCode) } }, HINT_NUMBER];
  },
  onDigits: (digits, ctx) => {
    if (digits === '0') return { next: 'bid_counter_confirm' }; // keep the quantity
    const n = typedCount(digits);
    if (n === null) {
      flash(ctx, 'voice.common.sorry');
      return { next: 'bid_counter_units' };
    }
    counterOf(ctx).units = n;
    return { next: 'bid_counter_confirm' };
  },
};

const counterConfirm: IvrNode = {
  key: 'bid_counter_confirm',
  guard: bidGuard,
  back: 'bid_counter_price',
  say: (ctx) => {
    const v = view(ctx);
    const c = counterOf(ctx);
    const units = c.units ?? v.current.units;
    return [
      ...takeFlash(ctx),
      {
        key: 'voice.bid.confirmCounter',
        params: {
          units,
          unit: unitSay(ctx, v.lot.unitCode),
          price: formatGhs(c.pricePerUnit!),
          total: formatGhs(Math.round(units * c.pricePerUnit!)),
        },
      },
      HINT_KEY,
    ];
  },
  onDigits: (digits, ctx) => {
    if (digits === '2') {
      ctx.state.counter = {};
      return { next: 'bid_counter_price' };
    }
    if (digits !== '1') return { next: 'bid_counter_confirm' };
    const farmer = farmerOf(ctx)!;
    const offerId = offerIdOf(ctx)!;
    const c = counterOf(ctx);
    try {
      const sent = counterOffer(offerId, 'farmer', farmer.id, { units: c.units, pricePerUnit: c.pricePerUnit! }, 'ivr');
      const v = describeOffer(sent);
      return finish(ctx, 'voice.bid.counterSent', { buyer: v.buyer.company ?? v.buyer.name }, { result: 'countered' });
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      if (err.code === 'NOT_ENOUGH_LEFT') {
        const lot = getLot(view(ctx).lot.id);
        flash(ctx, 'voice.bid.onlyLeft', { n: unitsAvailable(lot), unit: unitSay(ctx, view(ctx).lot.unitCode) });
        delete counterOf(ctx).units;
        return { next: 'bid_counter_units' };
      }
      if (err.code === 'MORE_THAN_NEEDED') {
        flash(ctx, 'voice.bid.requestLimit', { units: view(ctx).current.units });
        delete counterOf(ctx).units;
        return { next: 'bid_counter_units' };
      }
      if (GONE_CODES.includes(err.code)) return gone(ctx);
      throw err;
    }
  },
};

export const bidNodes: IvrNode[] = [main, counterPrice, counterUnits, counterConfirm];
export const bidFlow: IvrFlow = { entry: 'bid_main', nodes: bidNodes };
