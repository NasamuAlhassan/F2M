import { listContractsForFarmer, type I18nText } from '@ftm/core';
import type { UssdScreen } from '../machine';
import { invalid } from './common';

export const home: UssdScreen = {
  key: 'home',
  render: (ctx) => {
    const openOffers = ctx.farmer ? listContractsForFarmer(ctx.farmer.id, ['OFFERED']).length : 0;
    const lines: I18nText[] = [
      { key: 'ussd.home.title' },
      { key: 'ussd.home.hello', params: { name: ctx.farmer?.name ?? '' } },
      { key: 'ussd.home.sell' },
      { key: 'ussd.home.offers', params: { badge: openOffers > 0 ? ` (${openOffers})` : '' } },
      { key: 'ussd.home.lots' },
      { key: 'ussd.home.payments' },
      { key: 'ussd.home.prices' },
      { key: 'ussd.home.help' },
      { key: 'ussd.home.language' },
    ];
    return lines;
  },
  handleInput: (input, ctx) => {
    switch (input) {
      case '1':
        ctx.data.sellPage = 0;
        return { next: 'sell_commodity' };
      case '2':
        return { next: 'offers_list' };
      case '3':
        return { next: 'lots_list' };
      case '4':
        return { next: 'payments' };
      case '5':
        ctx.data.pricesPage = 0;
        return { next: 'prices_commodity' };
      case '6':
        return { end: [{ key: 'ussd.help' }] };
      case '7':
        return { next: 'lang_settings' };
      default:
        return invalid();
    }
  },
};
