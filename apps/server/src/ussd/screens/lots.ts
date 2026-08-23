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
  type Contract,
  type I18nText,
} from '@ftm/core';
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
    } else if (lot.askingPricePerKg) {
      lines.push({ key: 'ussd.lot.asking', params: { price: formatGhs(lot.askingPricePerKg) } });
    }
    lines.push({ key: 'ussd.common.back' });
    return lines;
  },
  handleInput: async (input, ctx) => {
    if (input === '0') return { next: 'lots_list' };
    if (!ctx.farmer) return invalid();
    const contractId = ctx.data.lotContractId as string | null;
    if (!contractId) return invalid();
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
