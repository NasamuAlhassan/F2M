import { getCommodityById, listContractsForFarmer, t } from '@ftm/core';
import type { UssdScreen } from '../machine';
import { invalid, listLines, parseSelection } from './common';

// M2: list open offers (empty until matching lands in M3, which also adds
// offer_detail with the price-per-grade table and accept/decline).
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
