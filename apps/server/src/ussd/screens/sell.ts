import { getCommodityByCode, listCommodities, listUnits, registerLot, t, type GradeBand } from '@ftm/core';
import type { UssdCtx, UssdScreen } from '../machine';
import { DAY_MS, invalid, listLines, paginate, parseSelection } from './common';

export const sellCommodity: UssdScreen = {
  key: 'sell_commodity',
  render: (ctx) => {
    const page = (ctx.data.sellPage as number) ?? 0;
    const { pageItems, hasMore } = paginate(listCommodities(), page);
    return [
      { key: 'ussd.sell.commodity' },
      ...listLines(
        pageItems.map((c) => t(ctx.locale, c.nameKey)),
        { hasMore },
      ),
    ];
  },
  handleInput: (input, ctx) => {
    if (input === '0') return { next: 'home' };
    const page = (ctx.data.sellPage as number) ?? 0;
    const all = listCommodities();
    const { pageItems, hasMore, start } = paginate(all, page);
    if (input === '9' && hasMore) {
      ctx.data.sellPage = page + 1;
      return { next: 'sell_commodity' };
    }
    const idx = parseSelection(input, pageItems.length, start);
    if (idx === null) return invalid();
    ctx.data.sellCommodity = all[idx]!.code;
    return { next: 'sell_unit' };
  },
};

function sellUnits(ctx: UssdCtx) {
  const commodity = getCommodityByCode(String(ctx.data.sellCommodity));
  return { commodity, units: listUnits(commodity.id) };
}

export const sellUnit: UssdScreen = {
  key: 'sell_unit',
  render: (ctx) => {
    const { units } = sellUnits(ctx);
    return [
      { key: 'ussd.sell.unit' },
      ...listLines(
        units.map((u) => t(ctx.locale, u.nameKey)),
        { hasMore: false },
      ),
    ];
  },
  handleInput: (input, ctx) => {
    if (input === '0') return { next: 'home' };
    const { units } = sellUnits(ctx);
    const idx = parseSelection(input, units.length, 0);
    if (idx === null) return invalid();
    ctx.data.sellUnit = units[idx]!.code;
    return { next: 'sell_qty' };
  },
};

export const sellQty: UssdScreen = {
  key: 'sell_qty',
  render: (ctx) => [
    { key: 'ussd.sell.qty', params: { unit: t(ctx.locale, `unit.${String(ctx.data.sellUnit)}`) } },
  ],
  handleInput: (input, ctx) => {
    const qty = Number(input);
    if (!Number.isFinite(qty) || qty <= 0 || qty > 100000) {
      return { error: { key: 'ussd.sell.qtyInvalid' } };
    }
    ctx.data.sellQty = qty;
    return { next: 'sell_band' };
  },
};

export const sellBand: UssdScreen = {
  key: 'sell_band',
  render: () => [
    { key: 'ussd.sell.band' },
    { key: 'ussd.sell.bandA' },
    { key: 'ussd.sell.bandB' },
    { key: 'ussd.sell.bandC' },
  ],
  handleInput: (input, ctx) => {
    const band = ({ '1': 'A', '2': 'B', '3': 'C' } as Record<string, GradeBand>)[input];
    if (!band) return invalid();
    ctx.data.sellBand = band;
    return { next: 'sell_ready' };
  },
};

// Choice → days-from-now, gated by the commodity clock (D: perishables get today/tomorrow only).
const STORABLE_CHOICES: Array<{ key: string; days: number }> = [
  { key: 'ussd.sell.readyNow', days: 0 },
  { key: 'ussd.sell.readyWeek', days: 7 },
  { key: 'ussd.sell.readyTwoWeeks', days: 14 },
  { key: 'ussd.sell.readyMonth', days: 30 },
];
const PERISHABLE_CHOICES: Array<{ key: string; days: number }> = [
  { key: 'ussd.sell.readyToday', days: 0 },
  { key: 'ussd.sell.readyTomorrow', days: 1 },
];

function readyChoices(ctx: UssdCtx) {
  const commodity = getCommodityByCode(String(ctx.data.sellCommodity));
  return commodity.clock.allowsForward ? STORABLE_CHOICES : PERISHABLE_CHOICES;
}

export const sellReady: UssdScreen = {
  key: 'sell_ready',
  render: (ctx) => [
    { key: 'ussd.sell.ready' },
    ...readyChoices(ctx).map((c, i) => ({
      key: 'ussd.listItem',
      params: { n: i + 1, label: t(ctx.locale, c.key) },
    })),
  ],
  handleInput: (input, ctx) => {
    const choices = readyChoices(ctx);
    const idx = parseSelection(input, choices.length, 0);
    if (idx === null) return invalid();
    ctx.data.sellReadyDays = choices[idx]!.days;
    return { next: 'sell_confirm' };
  },
};

export const sellConfirm: UssdScreen = {
  key: 'sell_confirm',
  render: (ctx) => [
    {
      key: 'ussd.sell.confirm',
      params: {
        qty: Number(ctx.data.sellQty),
        unit: t(ctx.locale, `unit.${String(ctx.data.sellUnit)}`),
        commodity: t(ctx.locale, `commodity.${String(ctx.data.sellCommodity)}`),
        band: t(ctx.locale, `band.${String(ctx.data.sellBand)}`),
      },
    },
    { key: 'ussd.common.confirm' },
    { key: 'ussd.common.cancel' },
  ],
  handleInput: (input, ctx) => {
    if (input === '2') return { end: [{ key: 'ussd.common.cancelled' }] };
    if (input !== '1') return invalid();
    if (!ctx.farmer) return { end: [{ key: 'ussd.common.error', params: { message: 'not registered' } }] };
    const lot = registerLot({
      farmerId: ctx.farmer.id,
      commodityCode: String(ctx.data.sellCommodity),
      unitCode: String(ctx.data.sellUnit),
      unitQty: Number(ctx.data.sellQty),
      declaredBand: ctx.data.sellBand as GradeBand,
      readyDate: Date.now() + Number(ctx.data.sellReadyDays) * DAY_MS,
      channel: 'ussd', // basic-phone listing — buyers see the phone, not photos (D-036)
    });
    return {
      end: [
        {
          key: 'ussd.sell.done',
          params: {
            lotCode: lot.lotCode,
            qty: Number(ctx.data.sellQty),
            unit: t(ctx.locale, `unit.${String(ctx.data.sellUnit)}`),
            commodity: t(ctx.locale, `commodity.${String(ctx.data.sellCommodity)}`),
          },
        },
      ],
    };
  },
};
