import {
  acceptOfferAndHold,
  contractPriceTerms,
  declineOffer,
  DomainError,
  formatGhs,
  getBuyerById,
  getCommodityById,
  getContract,
  getDemand,
  getMatch,
  listContractsForFarmer,
  t,
  type I18nText,
} from '@ftm/core';
import type { UssdScreen } from '../machine';
import { invalid, listLines, parseSelection } from './common';

export const offersList: UssdScreen = {
  key: 'offers_list',
  render: (ctx) => {
    if (!ctx.farmer) return [{ key: 'ussd.offers.none' }, { key: 'ussd.common.back' }];
    const offers = listContractsForFarmer(ctx.farmer.id, ['OFFERED']);
    ctx.data.offerIds = offers.map((o) => o.id);
    if (offers.length === 0) return [{ key: 'ussd.offers.none' }, { key: 'ussd.common.back' }];
    return [
      { key: 'ussd.offers.title' },
      ...listLines(
        offers.slice(0, 5).map((o) => {
          const commodity = getCommodityById(o.commodityId);
          return t(ctx.locale, 'ussd.offers.item', {
            kg: o.quantityKg,
            commodity: t(ctx.locale, commodity.nameKey),
          });
        }),
        { hasMore: false },
      ),
    ];
  },
  handleInput: (input, ctx) => {
    if (input === '0') return { next: 'home' };
    const offerIds = (ctx.data.offerIds as string[]) ?? [];
    const idx = parseSelection(input, Math.min(offerIds.length, 5), 0);
    if (idx === null) return invalid();
    ctx.data.offerId = offerIds[idx];
    return { next: 'offer_detail' };
  },
};

function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/**
 * The offer the farmer accepts is a full price-per-grade schedule, not a single
 * number grading can silently undercut (D-015).
 */
export const offerDetail: UssdScreen = {
  key: 'offer_detail',
  render: (ctx) => {
    const contract = getContract(String(ctx.data.offerId));
    const commodity = getCommodityById(contract.commodityId);
    const buyer = getBuyerById(contract.buyerId);
    const demand = getDemand(contract.demandId);
    const terms = contractPriceTerms(contract);
    const match = getMatch(contract.matchId);
    const expiresIn = match.expiresAt ? Math.max(0, match.expiresAt - Date.now()) : null;
    const expiresLabel =
      expiresIn === null
        ? ''
        : expiresIn >= 90 * 60 * 1000
          ? t(ctx.locale, 'ussd.offer.expiresHours', { n: Math.round(expiresIn / 3_600_000) })
          : t(ctx.locale, 'ussd.offer.expiresMins', { n: Math.max(1, Math.round(expiresIn / 60_000)) });
    const lines: I18nText[] = [
      {
        key: 'ussd.offer.detail',
        params: {
          kg: contract.quantityKg,
          commodity: t(ctx.locale, commodity.nameKey),
          buyer: buyer?.company ?? buyer?.name ?? '',
        },
      },
      {
        key: 'ussd.offer.prices',
        params: {
          a: formatGhs(terms.A ?? 0),
          b: formatGhs(terms.B ?? 0),
          c: formatGhs(terms.C ?? 0),
        },
      },
      { key: 'ussd.offer.window', params: { start: shortDate(demand.windowStart), end: shortDate(demand.windowEnd) } },
      ...(expiresLabel ? [{ key: 'ussd.offer.expires', params: { when: expiresLabel } }] : []),
      { key: 'ussd.offer.accept' },
      { key: 'ussd.offer.decline' },
      { key: 'ussd.common.back' },
    ];
    return lines;
  },
  handleInput: async (input, ctx) => {
    if (input === '0') return { next: 'offers_list' };
    if (!ctx.farmer) return invalid();
    const contractId = String(ctx.data.offerId);
    if (input === '1') {
      try {
        // Accept + start the buyer-side hold — the same call any surface makes.
        const contract = await acceptOfferAndHold(contractId, ctx.farmer.id);
        return {
          end: [{ key: 'ussd.offer.accepted', params: { amount: formatGhs(contract.holdAmount) } }],
        };
      } catch (err) {
        if (err instanceof DomainError && err.code === 'OFFER_EXPIRED') {
          return { end: [{ key: 'ussd.offer.expired' }] };
        }
        throw err;
      }
    }
    if (input === '2') {
      declineOffer(contractId, ctx.farmer.id);
      return { end: [{ key: 'ussd.offer.declined' }] };
    }
    return invalid();
  },
};
