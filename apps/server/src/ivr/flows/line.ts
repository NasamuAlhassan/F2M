import {
  config,
  DomainError,
  getCommodityById,
  getLot,
  listLotsByFarmer,
  listOffersForFarmer,
  markLotSold,
  parsePriceAnswer,
  unitsAvailable,
  updateLot,
  withdrawLot,
  db,
  schema,
  type I18nText,
  type Lot,
} from '@ftm/core';
import { eq } from 'drizzle-orm';
import type { IvrCtx, IvrFlow, IvrNode, IvrResult } from '../machine';
import { cropSay, DAY_MS, farmerOf, flash, HINT_KEY, HINT_NUMBER, priceSay, takeFlash, typedCount, typedPrice, unitSay } from './common';

/**
 * The listing line (Phase 2, vision §5.5): a registered farmer who calls hears
 * 1 sell, 2 my listings, 3 offers waiting. Listings can be heard one by one
 * and changed — quantity, price, ready date, sold elsewhere, removed — the
 * same moves as the USSD "My lots" screen.
 */

const openLots = (ctx: IvrCtx): Lot[] =>
  listLotsByFarmer(farmerOf(ctx)!.id).filter((l) => (l.status === 'registered' || l.status === 'matched') && l.remainingKg > 0);

const waitingOffers = (ctx: IvrCtx) => listOffersForFarmer(farmerOf(ctx)!.id, 'open').filter((o) => o.turn === 'farmer');

function currentLot(ctx: IvrCtx): Lot | undefined {
  const id = ctx.state.lotId as string | undefined;
  if (!id) return undefined;
  const lot = getLot(id);
  return lot.status === 'registered' || lot.status === 'matched' ? lot : undefined;
}

const unitCodeOf = (lot: Lot) => db.select().from(schema.units).where(eq(schema.units.id, lot.unitId)).get()!.code;

// ── the menu ─────────────────────────────────────────────────────────────
const menu: IvrNode = {
  key: 'line_menu',
  guard: (ctx) => (farmerOf(ctx) ? null : [{ key: 'voice.list.notRegistered', params: { code: config.USSD_SHORTCODE } }]),
  say: (ctx) => {
    const waiting = waitingOffers(ctx).length;
    return [
      ...takeFlash(ctx),
      { key: 'voice.line.welcome', params: { name: farmerOf(ctx)!.name } },
      { key: 'voice.line.menu' },
      ...(waiting > 0 ? [{ key: 'voice.line.offersWaiting', params: { n: waiting } }] : []),
      { key: 'voice.common.hintAgain' },
    ];
  },
  onDigits: (digits, ctx) => {
    if (digits === '1') {
      delete ctx.state.draft;
      delete ctx.state.tries;
      return { next: 'list_intro' };
    }
    if (digits === '2') {
      ctx.state.lotIndex = 0;
      return { next: 'line_lots' };
    }
    if (digits === '3') return { next: 'line_offers' };
    return { next: 'line_menu' };
  },
};

// ── my listings ──────────────────────────────────────────────────────────
function lotLine(ctx: IvrCtx, lot: Lot, n: number, count: number): I18nText {
  const unit = unitSay(ctx, unitCodeOf(lot));
  return {
    key: lot.askingPricePerUnit ? 'voice.line.lotPriced' : 'voice.line.lotOpen',
    params: {
      n,
      count,
      units: unitsAvailable(lot),
      unit,
      commodity: cropSay(ctx, getCommodityById(lot.commodityId).code),
      price: lot.askingPricePerUnit ? priceSay(lot.askingPricePerUnit) : '',
    },
  };
}

const lots: IvrNode = {
  key: 'line_lots',
  back: 'line_menu',
  say: (ctx) => {
    const all = openLots(ctx);
    if (all.length === 0) return [...takeFlash(ctx), { key: 'voice.line.noLots' }, HINT_KEY];
    const i = Math.min((ctx.state.lotIndex as number | undefined) ?? 0, all.length - 1);
    ctx.state.lotIndex = i;
    ctx.state.lotId = all[i]!.id;
    return [...takeFlash(ctx), lotLine(ctx, all[i]!, i + 1, all.length), { key: 'voice.line.lotMenu' }, HINT_KEY];
  },
  onDigits: (digits, ctx) => {
    const all = openLots(ctx);
    if (all.length === 0) return digits === '1' ? { next: 'list_intro' } : { next: 'line_menu' };
    switch (digits) {
      case '1':
        return { next: 'line_lot_qty' };
      case '2':
        return { next: 'line_lot_price' };
      case '3':
        return { next: 'line_lot_ready' };
      case '4':
        return { next: 'line_lot_sold' };
      case '5':
        return { next: 'line_lot_remove' };
      case '6': {
        const i = ((ctx.state.lotIndex as number | undefined) ?? 0) + 1;
        if (i >= all.length) flash(ctx, 'voice.line.lastLot');
        ctx.state.lotIndex = i % all.length;
        return { next: 'line_lots' };
      }
      default:
        return { next: 'line_lots' };
    }
  },
};

/** Run one listing change and come back to the listing, saying what happened. */
function change(ctx: IvrCtx, fn: (lot: Lot, farmerId: string) => void, doneKey = 'voice.line.changed'): IvrResult {
  const lot = currentLot(ctx);
  if (!lot) {
    flash(ctx, 'voice.line.lotGone');
    return { next: 'line_lots' };
  }
  try {
    fn(lot, farmerOf(ctx)!.id);
    flash(ctx, doneKey);
  } catch (err) {
    if (!(err instanceof DomainError)) throw err;
    flash(ctx, err.code === 'BELOW_SOLD' ? 'voice.line.belowSold' : 'voice.line.couldNotChange');
  }
  return { next: 'line_lots' };
}

const lotQty: IvrNode = {
  key: 'line_lot_qty',
  input: 'number',
  say: (ctx) => [...takeFlash(ctx), { key: 'voice.line.askQty', params: { unit: unitSay(ctx, unitCodeOf(currentLot(ctx) ?? getLot(ctx.state.lotId as string))) } }, HINT_NUMBER],
  onDigits: (digits, ctx) => {
    const n = typedCount(digits);
    if (n === null) {
      flash(ctx, 'voice.common.sorry');
      return { next: 'line_lot_qty' };
    }
    // The farmer says how many are left to sell; the listing's total also counts what is already in orders.
    return change(ctx, (lot, farmerId) => {
      const unitKg = lot.quantityKg / lot.unitQty;
      const inOrders = Math.round((lot.quantityKg - lot.remainingKg) / unitKg);
      updateLot(lot.id, farmerId, { units: n + inOrders });
    });
  },
};

const lotPrice: IvrNode = {
  key: 'line_lot_price',
  input: 'numberOrSpeech',
  say: (ctx) => [...takeFlash(ctx), { key: 'voice.listing.askPrice', params: { unit: unitSay(ctx, unitCodeOf(getLot(ctx.state.lotId as string))) } }, HINT_NUMBER],
  onDigits: (digits, ctx) => {
    const price = typedPrice(digits);
    if (price === undefined) {
      flash(ctx, 'voice.common.sorry');
      return { next: 'line_lot_price' };
    }
    return change(ctx, (lot, farmerId) => updateLot(lot.id, farmerId, { askingPricePerUnit: price }));
  },
  onSpeech: (heard, ctx) => {
    const price = heard ? parsePriceAnswer(heard.english) : undefined;
    if (price === undefined) {
      flash(ctx, 'voice.common.sorry');
      return { next: 'line_lot_price' };
    }
    return change(ctx, (lot, farmerId) => updateLot(lot.id, farmerId, { askingPricePerUnit: price }));
  },
};

const READY_DAYS: Record<string, number> = { '1': 0, '2': 1, '3': 7, '4': 14 };
const lotReady: IvrNode = {
  key: 'line_lot_ready',
  back: 'line_lots',
  say: (ctx) => {
    const lot = getLot(ctx.state.lotId as string);
    const forward = getCommodityById(lot.commodityId).clock.allowsForward;
    return [...takeFlash(ctx), { key: forward ? 'voice.listing.askReady' : 'voice.listing.askReadyPerishable' }, HINT_KEY];
  },
  onDigits: (digits, ctx) => {
    const lot = getLot(ctx.state.lotId as string);
    const forward = getCommodityById(lot.commodityId).clock.allowsForward;
    const days = READY_DAYS[digits];
    if (days === undefined || (!forward && days > 1)) return { next: 'line_lot_ready' };
    return change(ctx, (l, farmerId) => updateLot(l.id, farmerId, { readyDate: Date.now() + days * DAY_MS }));
  },
};

const lotSold: IvrNode = {
  key: 'line_lot_sold',
  back: 'line_lots',
  say: (ctx) => [...takeFlash(ctx), { key: 'voice.line.confirmSold' }, HINT_KEY],
  onDigits: (digits, ctx) => {
    if (digits !== '1') return { next: 'line_lots' };
    return change(ctx, (lot, farmerId) => markLotSold(lot.id, farmerId), 'voice.line.markedSold');
  },
};

const lotRemove: IvrNode = {
  key: 'line_lot_remove',
  back: 'line_lots',
  say: (ctx) => [...takeFlash(ctx), { key: 'voice.line.confirmRemove' }, HINT_KEY],
  onDigits: (digits, ctx) => {
    if (digits !== '1') return { next: 'line_lots' };
    return change(ctx, (lot, farmerId) => withdrawLot(lot.id, farmerId), 'voice.line.removed');
  },
};

// ── offers waiting ───────────────────────────────────────────────────────
const offersNode: IvrNode = {
  key: 'line_offers',
  back: 'line_menu',
  say: (ctx) => {
    const waiting = waitingOffers(ctx);
    if (waiting.length === 0) return [...takeFlash(ctx), { key: 'voice.line.noOffers' }, HINT_KEY];
    return [...takeFlash(ctx), { key: 'voice.line.offersCount', params: { n: waiting.length } }, HINT_KEY];
  },
  onDigits: (digits, ctx) => {
    const waiting = waitingOffers(ctx);
    if (digits !== '1' || waiting.length === 0) return { next: 'line_menu' };
    ctx.state.offerId = waiting[0]!.id; // newest first: each answer brings the next one up
    return { next: 'bid_main' };
  },
};

export const lineNodes: IvrNode[] = [menu, lots, lotQty, lotPrice, lotReady, lotSold, lotRemove, offersNode];
export const lineFlow: IvrFlow = { entry: 'line_menu', nodes: lineNodes };
