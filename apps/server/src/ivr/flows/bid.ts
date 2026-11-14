import {
  acceptOfferThread,
  config,
  describeOffer,
  DomainError,
  formatGhs,
  getFarmerByPhone,
  getOffer,
  rejectOffer,
  t,
  type I18nText,
} from '@ftm/core';
import type { IvrCtx, IvrFlow, IvrResult } from '../machine';

/**
 * Hearing an offer (Phase 1): the call reads the buyer's current proposal —
 * units, price per unit, total — and takes 1 to accept, 2 to reject. A spoken
 * counter-offer is Phase 2; until then the call says how to counter by USSD.
 * Same core moves as USSD and the web.
 */

function bidGuard(ctx: IvrCtx): I18nText[] | null {
  if (!ctx.call.offerId) return [{ key: 'voice.offer.gone' }];
  const offer = getOffer(ctx.call.offerId);
  if (offer.status !== 'open' || offer.turn !== 'farmer') return [{ key: 'voice.offer.gone' }];
  return null;
}

function bidSay(ctx: IvrCtx): I18nText[] {
  const v = describeOffer(getOffer(ctx.call.offerId!));
  return [
    {
      key: 'voice.bid.intro',
      params: {
        buyer: v.buyer.company ?? v.buyer.name,
        units: v.current.units,
        unit: t(ctx.locale, `unit.${v.lot.unitCode}`),
        commodity: t(ctx.locale, `commodity.${v.lot.commodityCode}`),
        price: formatGhs(v.current.pricePerUnit),
        total: formatGhs(v.current.total),
      },
    },
    { key: 'voice.bid.menu', params: { code: config.USSD_SHORTCODE } },
  ];
}

async function bidDigits(digits: string, ctx: IvrCtx): Promise<IvrResult> {
  const offerId = ctx.call.offerId;
  const farmer = getFarmerByPhone(ctx.call.phone);
  if (!offerId || !farmer) return { end: [{ key: 'voice.common.goodbye' }], outcome: { result: 'no_context' } };
  try {
    if (digits === '1') {
      const { offer } = await acceptOfferThread(offerId, 'farmer', farmer.id, 'ivr');
      const v = describeOffer(offer);
      return { end: [{ key: 'voice.bid.accepted', params: { total: formatGhs(v.current.total) } }], outcome: { result: 'accepted' } };
    }
    if (digits === '2') {
      rejectOffer(offerId, 'farmer', farmer.id, 'ivr');
      return { end: [{ key: 'voice.bid.rejected' }], outcome: { result: 'rejected' } };
    }
  } catch (err) {
    if (err instanceof DomainError && ['OFFER_CLOSED', 'OFFER_EXPIRED', 'NOT_YOUR_TURN', 'LOT_CLOSED', 'NOT_ENOUGH_LEFT'].includes(err.code)) {
      return { end: [{ key: 'voice.offer.gone' }], outcome: { result: 'gone' } };
    }
    throw err;
  }
  return { next: 'bid_main' }; // any other key — say it again
}

export const bidFlow: IvrFlow = {
  entry: 'bid_main',
  nodes: [{ key: 'bid_main', guard: bidGuard, say: bidSay, onDigits: bidDigits }],
};
