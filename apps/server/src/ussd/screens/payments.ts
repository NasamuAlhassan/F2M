import { formatGhs, listPaymentsForFarmer, t } from '@ftm/core';
import type { UssdScreen } from '../machine';
import { listLines } from './common';

export const paymentsScreen: UssdScreen = {
  key: 'payments',
  render: (ctx) => {
    if (!ctx.farmer) return [{ key: 'ussd.pay.none' }, { key: 'ussd.common.back' }];
    const recent = listPaymentsForFarmer(ctx.farmer.id, 3);
    if (recent.length === 0) return [{ key: 'ussd.pay.none' }, { key: 'ussd.common.back' }];
    return [
      { key: 'ussd.pay.title' },
      ...listLines(
        recent.map((p) =>
          t(ctx.locale, 'ussd.pay.item', {
            amount: formatGhs(p.amount),
            status: t(ctx.locale, `ussd.paystatus.${p.status}`),
          }),
        ),
        { hasMore: false },
      ),
    ];
  },
  handleInput: (input) => (input === '0' ? { next: 'home' } : { next: 'home' }),
};
