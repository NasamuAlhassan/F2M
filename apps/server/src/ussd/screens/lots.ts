import { formatGhs, getCommodityById, getLot, listLotsByFarmer, t, type I18nText } from '@ftm/core';
import type { UssdScreen } from '../machine';
import { invalid, listLines, parseSelection } from './common';

const MAX_LOTS = 5;

export const lotsList: UssdScreen = {
  key: 'lots_list',
  render: (ctx) => {
    if (!ctx.farmer) return [{ key: 'ussd.lots.none' }];
    const lots = listLotsByFarmer(ctx.farmer.id).slice(0, MAX_LOTS);
    ctx.data.lotIds = lots.map((l) => l.id);
    if (lots.length === 0) return [{ key: 'ussd.lots.none' }, { key: 'ussd.common.back' }];
    return [
      { key: 'ussd.lots.title' },
      ...listLines(
        lots.map((l) => {
          const commodity = getCommodityById(l.commodityId);
          return t(ctx.locale, 'ussd.lots.item', {
            code: l.lotCode,
            kg: l.quantityKg,
            commodity: t(ctx.locale, commodity.nameKey),
            status: t(ctx.locale, `ussd.lotstatus.${l.status}`),
          });
        }),
        { hasMore: false },
      ),
    ];
  },
  handleInput: (input, ctx) => {
    if (input === '0') return { next: 'home' };
    const lotIds = (ctx.data.lotIds as string[]) ?? [];
    const idx = parseSelection(input, lotIds.length, 0);
    if (idx === null) return invalid();
    ctx.data.lotId = lotIds[idx];
    return { next: 'lot_detail' };
  },
};

export const lotDetail: UssdScreen = {
  key: 'lot_detail',
  render: (ctx) => {
    const lot = getLot(String(ctx.data.lotId));
    const commodity = getCommodityById(lot.commodityId);
    const lines: I18nText[] = [
      {
        key: 'ussd.lot.detail',
        params: {
          code: lot.lotCode,
          kg: lot.quantityKg,
          commodity: t(ctx.locale, commodity.nameKey),
          band: t(ctx.locale, `band.${lot.declaredBand}`),
          status: t(ctx.locale, `ussd.lotstatus.${lot.status}`),
        },
      },
    ];
    if (lot.askingPricePerKg) {
      lines.push({ key: 'ussd.lot.asking', params: { price: formatGhs(lot.askingPricePerKg) } });
    }
    lines.push({ key: 'ussd.common.back' });
    return lines;
  },
  handleInput: (input) => (input === '0' ? { next: 'lots_list' } : invalid()),
};
