import {
  agreeGrading,
  confirmPickup,
  disputeGrading,
  formatGhs,
  getCommodityById,
  getContract,
  getLot,
  listContractsForLot,
  listGradingsForContract,
  listLotsByFarmer,
  t,
  withdrawLot,
  config,
  db,
  markLotSold,
  schema,
  updateLot,
  type Contract,
  type I18nText,
} from '@ftm/core';
import type { UssdScreen } from '../machine';
import { eq } from 'drizzle-orm';
import { invalid, listLines, parseSelection } from './common';
import { parseGhs } from './offers';

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

/** The lot's action-relevant contract: awaiting pickup confirmation or graded. */
function activeContract(lotId: string): Contract | undefined {
  return listContractsForLot(lotId).find((c) => c.state === 'FUNDS_HELD' || c.state === 'GRADED');
}

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

    const contract = activeContract(lot.id);
    ctx.data.lotContractId = contract?.id ?? null;
    if (contract?.state === 'FUNDS_HELD') {
      lines.push({ key: 'ussd.lot.pickup' });
    } else if (contract?.state === 'GRADED' && contract.finalGrade) {
      // The grade is a number she can argue with: band, payout, and the reason.
      lines.push({
        key: 'ussd.grade.line',
        params: {
          band: t(ctx.locale, `band.${contract.finalGrade}`),
          amount: formatGhs(contract.finalAmount ?? 0),
        },
      });
      const grading = listGradingsForContract(contract.id)[0];
      const reasons = grading?.reasons ? (JSON.parse(grading.reasons) as Array<{ observation: string }>) : [];
      if (reasons[0]) lines.push({ key: 'ussd.grade.reason', params: { observation: reasons[0].observation } });
      lines.push({ key: 'ussd.grade.agree' }, { key: 'ussd.grade.dispute' });
    } else if (lot.askingPricePerUnit) {
      lines.push({ key: 'ussd.lot.askingUnit', params: { price: formatGhs(lot.askingPricePerUnit) } });
    } else if (lot.askingPricePerKg) {
      lines.push({ key: 'ussd.lot.asking', params: { price: formatGhs(lot.askingPricePerKg) } });
    }
    // A listing on the market can be changed, marked sold, or taken off (Phase 1).
    if (!contract && (lot.status === 'registered' || lot.status === 'matched')) {
      lines.push({ key: 'ussd.lot.withdraw' }, { key: 'ussd.lot.editPrice' }, { key: 'ussd.lot.editQty' }, { key: 'ussd.lot.sold' });
    }
    lines.push({ key: 'ussd.common.back' });
    return lines;
  },
  handleInput: async (input, ctx) => {
    if (input === '0') return { next: 'lots_list' };
    if (!ctx.farmer) return invalid();
    const contractId = ctx.data.lotContractId as string | null;
    if (!contractId) {
      const lot = getLot(String(ctx.data.lotId));
      if (lot.status !== 'registered' && lot.status !== 'matched') return invalid();
      if (input === '1') return { next: 'lot_withdraw_confirm' };
      if (input === '2') return { next: 'lot_edit_price' };
      if (input === '3') return { next: 'lot_edit_qty' };
      if (input === '4') return { next: 'lot_sold_confirm' };
      return invalid();
    }
    const contract = getContract(contractId);

    if (contract.state === 'FUNDS_HELD' && input === '1') {
      confirmPickup(contractId, { type: 'farmer', id: ctx.farmer.id });
      return { end: [{ key: 'ussd.pickup.done' }] };
    }
    if (contract.state === 'GRADED') {
      if (input === '1') {
        await agreeGrading(contractId, ctx.farmer.id);
        return { end: [{ key: 'ussd.grade.agreeDone', params: { amount: formatGhs(contract.finalAmount ?? 0) } }] };
      }
      if (input === '2') {
        disputeGrading(contractId, ctx.farmer.id);
        return { end: [{ key: 'ussd.grade.disputeDone' }] };
      }
    }
    return invalid();
  },
};

export const lotWithdrawConfirm: UssdScreen = {
  key: 'lot_withdraw_confirm',
  render: (ctx) => {
    const lot = getLot(String(ctx.data.lotId));
    return [
      {
        key: 'ussd.lot.withdrawConfirm',
        params: { code: lot.lotCode, kg: lot.remainingKg, commodity: t(ctx.locale, getCommodityById(lot.commodityId).nameKey) },
      },
      { key: 'ussd.common.confirm' },
      { key: 'ussd.common.cancel' },
    ];
  },
  handleInput: (input, ctx) => {
    if (input === '2') return { next: 'lot_detail' };
    if (input !== '1' || !ctx.farmer) return invalid();
    const lot = withdrawLot(String(ctx.data.lotId), ctx.farmer.id);
    return { end: [{ key: 'ussd.lot.withdrawDone', params: { code: lot.lotCode } }] };
  },
};

function unitName(ctx: Parameters<UssdScreen['render']>[0], lotId: string): string {
  const lot = getLot(lotId);
  const unit = db.select().from(schema.units).where(eq(schema.units.id, lot.unitId)).get();
  return unit ? t(ctx.locale, unit.nameKey) : '';
}

const updatedEnd = (code: string) => ({ end: [{ key: 'ussd.lot.updated', params: { code, days: config.LISTING_TTL_DAYS } }] });

export const lotEditPrice: UssdScreen = {
  key: 'lot_edit_price',
  render: (ctx) => [{ key: 'ussd.lot.pricePrompt', params: { unit: unitName(ctx, String(ctx.data.lotId)) } }],
  handleInput: (input, ctx) => {
    if (!ctx.farmer) return invalid();
    const cleared = input.trim() === '0';
    const pesewas = cleared ? null : parseGhs(input);
    if (!cleared && pesewas === null) return { error: { key: 'ussd.offer.priceInvalid' } };
    const lot = updateLot(String(ctx.data.lotId), ctx.farmer.id, { askingPricePerUnit: pesewas });
    return updatedEnd(lot.lotCode);
  },
};

export const lotEditQty: UssdScreen = {
  key: 'lot_edit_qty',
  render: (ctx) => [{ key: 'ussd.lot.qtyPrompt', params: { unit: unitName(ctx, String(ctx.data.lotId)) } }],
  handleInput: (input, ctx) => {
    if (!ctx.farmer) return invalid();
    const n = Number(input.trim());
    if (!Number.isFinite(n) || n <= 0 || n > 100000) return { error: { key: 'ussd.sell.qtyInvalid' } };
    const lot = updateLot(String(ctx.data.lotId), ctx.farmer.id, { units: n });
    return updatedEnd(lot.lotCode);
  },
};

export const lotSoldConfirm: UssdScreen = {
  key: 'lot_sold_confirm',
  render: (ctx) => [
    { key: 'ussd.lot.soldConfirm', params: { code: getLot(String(ctx.data.lotId)).lotCode } },
    { key: 'ussd.common.confirm' },
    { key: 'ussd.common.cancel' },
  ],
  handleInput: (input, ctx) => {
    if (input === '2') return { next: 'lot_detail' };
    if (input !== '1' || !ctx.farmer) return invalid();
    const lot = markLotSold(String(ctx.data.lotId), ctx.farmer.id);
    return { end: [{ key: 'ussd.lot.soldDone', params: { code: lot.lotCode } }] };
  },
};
