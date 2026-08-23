import { formatGhs, getCommodityByCode, listCommodities, listMarketPrices, t } from '@ftm/core';
import type { UssdScreen } from '../machine';
import { invalid, listLines, paginate, parseSelection } from './common';

// Market prices work WITHOUT registration — a farmer should know what her
// onions fetch in Techiman before she gives anyone her name.

export const pricesCommodity: UssdScreen = {
  key: 'prices_commodity',
  render: (ctx) => {
    const page = (ctx.data.pricesPage as number) ?? 0;
    const { pageItems, hasMore } = paginate(listCommodities(), page);
    return [
      { key: 'ussd.prices.commodity' },
      ...listLines(
        pageItems.map((c) => t(ctx.locale, c.nameKey)),
        { hasMore },
      ),
    ];
  },
  handleInput: (input, ctx) => {
    if (input === '0') return { next: ctx.farmer ? 'home' : 'welcome' };
    const page = (ctx.data.pricesPage as number) ?? 0;
    const all = listCommodities();
    const { pageItems, hasMore, start } = paginate(all, page);
    if (input === '9' && hasMore) {
      ctx.data.pricesPage = page + 1;
      return { next: 'prices_commodity' };
    }
    const idx = parseSelection(input, pageItems.length, start);
    if (idx === null) return invalid();
    ctx.data.pricesCommodity = all[idx]!.code;
    return { next: 'prices_show' };
  },
};

export const pricesShow: UssdScreen = {
  key: 'prices_show',
  render: (ctx) => {
    const commodity = getCommodityByCode(String(ctx.data.pricesCommodity));
    const prices = listMarketPrices(commodity.id);
    if (prices.length === 0) {
      return [
        { key: 'ussd.prices.none', params: { commodity: t(ctx.locale, commodity.nameKey) } },
        { key: 'ussd.common.back' },
      ];
    }
    return [
      { key: 'ussd.prices.title', params: { commodity: t(ctx.locale, commodity.nameKey) } },
      ...prices.map((p) => ({
        key: 'ussd.prices.item',
        params: { market: p.market, price: formatGhs(p.pricePerKg) },
      })),
      { key: 'ussd.common.back' },
    ];
  },
  handleInput: (input, ctx) => {
    if (input === '0') {
      ctx.data.pricesPage = 0;
      return { next: 'prices_commodity' };
    }
    return invalid();
  },
};
