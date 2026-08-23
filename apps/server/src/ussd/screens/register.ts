import { DomainError, listRegions, registerFarmer, t } from '@ftm/core';
import type { UssdScreen } from '../machine';
import { invalid, listLines, paginate, parseSelection } from './common';

export const welcome: UssdScreen = {
  key: 'welcome',
  render: () => [{ key: 'ussd.welcome.title' }, { key: 'ussd.welcome.register' }],
  handleInput: (input) => (input === '1' ? { next: 'reg_name' } : invalid()),
};

export const regName: UssdScreen = {
  key: 'reg_name',
  render: () => [{ key: 'ussd.reg.name' }],
  handleInput: (input, ctx) => {
    if (!input || input.length < 2) return invalid();
    ctx.data.regName = input;
    ctx.data.regPage = 0;
    return { next: 'reg_region' };
  },
};

export const regRegion: UssdScreen = {
  key: 'reg_region',
  render: (ctx) => {
    const page = (ctx.data.regPage as number) ?? 0;
    const { pageItems, hasMore } = paginate(listRegions(), page);
    return [
      { key: 'ussd.reg.region' },
      ...listLines(
        pageItems.map((r) => t(ctx.locale, r.nameKey)),
        { hasMore, back: false },
      ),
    ];
  },
  handleInput: (input, ctx) => {
    const page = (ctx.data.regPage as number) ?? 0;
    const regions = listRegions();
    const { pageItems, hasMore, start } = paginate(regions, page);
    if (input === '9' && hasMore) {
      ctx.data.regPage = page + 1;
      return { next: 'reg_region' };
    }
    const idx = parseSelection(input, pageItems.length, start);
    if (idx === null) return invalid();
    ctx.data.regRegion = regions[idx]!.code;
    return { next: 'reg_district' };
  },
};

export const regDistrict: UssdScreen = {
  key: 'reg_district',
  render: () => [{ key: 'ussd.reg.district' }],
  handleInput: (input, ctx) => {
    ctx.data.regDistrict = input === '0' ? null : input;
    return { next: 'reg_confirm' };
  },
};

export const regConfirm: UssdScreen = {
  key: 'reg_confirm',
  render: (ctx) => [
    {
      key: 'ussd.reg.confirm',
      params: {
        name: String(ctx.data.regName),
        region: t(ctx.locale, `region.${String(ctx.data.regRegion)}`),
      },
    },
    { key: 'ussd.common.confirm' },
    { key: 'ussd.common.cancel' },
  ],
  handleInput: (input, ctx) => {
    if (input === '2') return { end: [{ key: 'ussd.common.cancelled' }] };
    if (input !== '1') return invalid();
    try {
      const farmer = registerFarmer({
        phone: ctx.phone,
        name: String(ctx.data.regName),
        regionCode: String(ctx.data.regRegion),
        district: (ctx.data.regDistrict as string | null) ?? undefined,
      });
      return { end: [{ key: 'ussd.reg.done', params: { name: farmer.name } }] };
    } catch (err) {
      if (err instanceof DomainError && err.code === 'FARMER_EXISTS') {
        return { end: [{ key: 'ussd.reg.exists' }] };
      }
      throw err;
    }
  },
};
