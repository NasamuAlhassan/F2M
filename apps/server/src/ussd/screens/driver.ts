import {
  acceptJob,
  confirmJobPickup,
  declineJob,
  DomainError,
  formatGhs,
  getJob,
  jobSummary,
  listJobsForDriver,
  listOffersForDriver,
  listRegions,
  listVehicleClasses,
  registerDriver,
  t,
  type I18nText,
} from '@ftm/core';
import type { UssdScreen } from '../machine';
import { invalid, listLines, paginate, parseSelection } from './common';

// ---- Registration ----

export const driverRegName: UssdScreen = {
  key: 'driver_reg_name',
  render: () => [{ key: 'ussd.driver.reg.name' }],
  handleInput: (input, ctx) => {
    if (!input || input.length < 2) return invalid();
    ctx.data.drvName = input;
    ctx.data.drvRegionPage = 0;
    return { next: 'driver_reg_region' };
  },
};

export const driverRegRegion: UssdScreen = {
  key: 'driver_reg_region',
  render: (ctx) => {
    const page = (ctx.data.drvRegionPage as number) ?? 0;
    const { pageItems, hasMore } = paginate(listRegions(), page);
    return [
      { key: 'ussd.driver.reg.region' },
      ...listLines(
        pageItems.map((r) => t(ctx.locale, r.nameKey)),
        { hasMore, back: false },
      ),
    ];
  },
  handleInput: (input, ctx) => {
    const page = (ctx.data.drvRegionPage as number) ?? 0;
    const regions = listRegions();
    const { pageItems, hasMore, start } = paginate(regions, page);
    if (input === '9' && hasMore) {
      ctx.data.drvRegionPage = page + 1;
      return { next: 'driver_reg_region' };
    }
    const idx = parseSelection(input, pageItems.length, start);
    if (idx === null) return invalid();
    ctx.data.drvRegion = regions[idx]!.code;
    return { next: 'driver_reg_vehicle' };
  },
};

export const driverRegVehicle: UssdScreen = {
  key: 'driver_reg_vehicle',
  render: (ctx) => [
    { key: 'ussd.driver.reg.vehicle' },
    ...listLines(
      listVehicleClasses().map((v) => t(ctx.locale, v.nameKey)),
      { hasMore: false, back: false },
    ),
  ],
  handleInput: (input, ctx) => {
    const classes = listVehicleClasses();
    const idx = parseSelection(input, classes.length, 0);
    if (idx === null) return invalid();
    ctx.data.drvVehicle = classes[idx]!.code;
    return { next: 'driver_reg_pin' };
  },
};

export const driverRegPin: UssdScreen = {
  key: 'driver_reg_pin',
  render: () => [{ key: 'ussd.driver.reg.pin' }],
  handleInput: (input, ctx) => {
    if (!/^\d{4}$/.test(input)) return { error: { key: 'ussd.driver.reg.pinInvalid' } };
    ctx.data.drvPin = input;
    return { next: 'driver_reg_confirm' };
  },
};

export const driverRegConfirm: UssdScreen = {
  key: 'driver_reg_confirm',
  render: (ctx) => [
    {
      key: 'ussd.driver.reg.confirm',
      params: {
        name: String(ctx.data.drvName),
        vehicle: t(ctx.locale, `vehicle.${String(ctx.data.drvVehicle)}`),
        region: t(ctx.locale, `region.${String(ctx.data.drvRegion)}`),
      },
    },
    { key: 'ussd.common.confirm' },
    { key: 'ussd.common.cancel' },
  ],
  handleInput: (input, ctx) => {
    if (input === '2') return { end: [{ key: 'ussd.common.cancelled' }] };
    if (input !== '1') return invalid();
    try {
      const driver = registerDriver({
        phone: ctx.phone,
        name: String(ctx.data.drvName),
        regionCode: String(ctx.data.drvRegion),
        vehicleClassCode: String(ctx.data.drvVehicle),
        pin: String(ctx.data.drvPin),
      });
      return { end: [{ key: 'ussd.driver.reg.done', params: { name: driver.name } }] };
    } catch (err) {
      if (err instanceof DomainError && (err.code === 'DRIVER_EXISTS' || err.code === 'ROLE_TAKEN')) {
        return { end: [{ key: 'ussd.driver.reg.exists' }] };
      }
      throw err;
    }
  },
};

// ---- Home + jobs ----

export const driverHome: UssdScreen = {
  key: 'driver_home',
  render: (ctx) => {
    const offers = ctx.driver ? listOffersForDriver(ctx.driver.id).length : 0;
    const lines: I18nText[] = [
      { key: 'ussd.driver.home.title' },
      { key: 'ussd.driver.home.hello', params: { name: ctx.driver?.name ?? '' } },
      { key: 'ussd.driver.home.offers', params: { badge: offers > 0 ? ` (${offers})` : '' } },
      { key: 'ussd.driver.home.job' },
      { key: 'ussd.driver.home.payments' },
      { key: 'ussd.home.prices' },
    ];
    return lines;
  },
  handleInput: (input, ctx) => {
    switch (input) {
      case '1':
        return { next: 'driver_offers' };
      case '2':
        return { next: 'driver_active' };
      case '3':
        return { next: 'driver_payments' };
      case '5':
        ctx.data.pricesPage = 0;
        return { next: 'prices_commodity' };
      default:
        return invalid();
    }
  },
};

export const driverOffers: UssdScreen = {
  key: 'driver_offers',
  render: (ctx) => {
    if (!ctx.driver) return [{ key: 'ussd.driver.offers.none' }, { key: 'ussd.common.back' }];
    const offers = listOffersForDriver(ctx.driver.id);
    ctx.data.drvOfferJobIds = offers.map((o) => o.jobId);
    if (offers.length === 0) return [{ key: 'ussd.driver.offers.none' }, { key: 'ussd.common.back' }];
    return [
      { key: 'ussd.driver.offers.title' },
      ...listLines(
        offers.map((o) => {
          const { quantityKg } = jobSummary(o.job);
          return t(ctx.locale, 'ussd.driver.offers.item', {
            code: o.job.jobCode,
            kg: quantityKg,
            km: o.job.distanceKm,
            fee: formatGhs(o.job.quoteAmount),
          });
        }),
        { hasMore: false },
      ),
    ];
  },
  handleInput: (input, ctx) => {
    if (input === '0') return { next: 'driver_home' };
    const jobIds = (ctx.data.drvOfferJobIds as string[]) ?? [];
    const idx = parseSelection(input, jobIds.length, 0);
    if (idx === null) return invalid();
    ctx.data.drvJobId = jobIds[idx];
    return { next: 'driver_offer_detail' };
  },
};

export const driverOfferDetail: UssdScreen = {
  key: 'driver_offer_detail',
  render: (ctx) => {
    const job = getJob(String(ctx.data.drvJobId));
    const { commodityCode, quantityKg } = jobSummary(job);
    return [
      {
        key: 'ussd.driver.offer.detail',
        params: {
          code: job.jobCode,
          kg: quantityKg,
          commodity: t(ctx.locale, `commodity.${commodityCode}`),
          km: job.distanceKm,
          fee: formatGhs(job.quoteAmount),
        },
      },
      { key: 'ussd.offer.accept' },
      { key: 'ussd.offer.decline' },
      { key: 'ussd.common.back' },
    ];
  },
  handleInput: async (input, ctx) => {
    if (input === '0') return { next: 'driver_offers' };
    if (!ctx.driver) return invalid();
    const jobId = String(ctx.data.drvJobId);
    if (input === '1') {
      try {
        const job = await acceptJob(jobId, ctx.driver.id);
        return { end: [{ key: 'ussd.driver.offer.accepted', params: { code: job.jobCode, fee: formatGhs(job.quoteAmount) } }] };
      } catch (err) {
        if (err instanceof DomainError && err.code === 'OFFER_EXPIRED') {
          return { end: [{ key: 'ussd.offer.expired' }] };
        }
        throw err;
      }
    }
    if (input === '2') {
      declineJob(jobId, ctx.driver.id);
      return { end: [{ key: 'ussd.driver.offer.declined' }] };
    }
    return invalid();
  },
};

export const driverActive: UssdScreen = {
  key: 'driver_active',
  render: (ctx) => {
    if (!ctx.driver) return [{ key: 'ussd.driver.job.none' }, { key: 'ussd.common.back' }];
    const active = listJobsForDriver(ctx.driver.id).find((j) =>
      ['ASSIGNED', 'FUNDING_FAILED', 'FUNDS_HELD', 'PICKED_UP', 'DELIVERED'].includes(j.state),
    );
    ctx.data.drvActiveJobId = active?.id ?? null;
    if (!active) return [{ key: 'ussd.driver.job.none' }, { key: 'ussd.common.back' }];

    const lines: I18nText[] = [
      {
        key: 'ussd.driver.job.detail',
        params: {
          code: active.jobCode,
          status: t(ctx.locale, `ussd.jobstatus.${active.state}`),
          fee: formatGhs(active.quoteAmount),
        },
      },
    ];
    if (active.state === 'FUNDS_HELD') lines.push({ key: 'ussd.driver.job.pickup' });
    if (active.state === 'PICKED_UP') lines.push({ key: 'ussd.driver.job.awaitDelivery' });
    lines.push({ key: 'ussd.common.back' });
    return lines;
  },
  handleInput: (input, ctx) => {
    if (input === '0') return { next: 'driver_home' };
    if (!ctx.driver) return invalid();
    const jobId = ctx.data.drvActiveJobId as string | null;
    if (!jobId) return invalid();
    const job = getJob(jobId);
    if (job.state === 'FUNDS_HELD' && input === '1') {
      confirmJobPickup(jobId, ctx.driver.id);
      return { end: [{ key: 'ussd.driver.job.pickupDone', params: { code: job.jobCode } }] };
    }
    return invalid();
  },
};

export const driverPayments: UssdScreen = {
  key: 'driver_payments',
  render: (ctx) => {
    if (!ctx.driver) return [{ key: 'ussd.pay.none' }, { key: 'ussd.common.back' }];
    const paid = listJobsForDriver(ctx.driver.id)
      .filter((j) => j.state === 'PAID')
      .slice(0, 3);
    if (paid.length === 0) return [{ key: 'ussd.pay.none' }, { key: 'ussd.common.back' }];
    return [
      { key: 'ussd.pay.title' },
      ...listLines(
        paid.map((j) => t(ctx.locale, 'ussd.driver.pay.item', { code: j.jobCode, amount: formatGhs(j.quoteAmount) })),
        { hasMore: false },
      ),
    ];
  },
  handleInput: () => ({ next: 'driver_home' }),
};
