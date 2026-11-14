import {
  advanceFor,
  agreeGrading,
  answerClaim,
  confirmPickup,
  farmerPaid,
  listClaimsForContract,
  orderTotal,
  disputeGrading,
  DomainError,
  getJobForContract,
  suggestTransport,
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
import { DAY_MS, invalid, listLines, parseSelection } from './common';
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

/** The lot's order the farmer can act on or follow: pickup, grade, delivery, a claim, receipt (Phase 3). */
function activeContract(lotId: string): Contract | undefined {
  return listContractsForLot(lotId).find((c) => ['FUNDS_HELD', 'GRADED', 'DELIVERED', 'CLAIMED', 'RECEIVED'].includes(c.state));
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
      // Phase 2 (vision §10.2): the farmer can ask for transport by phone too —
      // the farmer-suggested delivery the buyer approves and funds (D-037).
      if (!getJobForContract(contract.id)) lines.push({ key: 'ussd.lot.askTransport' });
    } else if (contract?.state === 'GRADED' && contract.finalGrade) {
      // The grade is a number she can argue with: band, payout, and the reason.
      // Phase 3: part of the money now, the rest when the buyer receives it.
      lines.push({
        key: 'ussd.grade.line',
        params: {
          band: t(ctx.locale, `band.${contract.finalGrade}`),
          advance: formatGhs(advanceFor(contract)),
          rest: formatGhs(orderTotal(contract) - advanceFor(contract)),
        },
      });
      const grading = listGradingsForContract(contract.id)[0];
      const reasons = grading?.reasons ? (JSON.parse(grading.reasons) as Array<{ observation: string }>) : [];
      if (reasons[0]) lines.push({ key: 'ussd.grade.reason', params: { observation: reasons[0].observation } });
      lines.push({ key: 'ussd.grade.agree' }, { key: 'ussd.grade.dispute' });
    } else if (contract?.state === 'DELIVERED') {
      lines.push({ key: 'ussd.lot.delivered' });
    } else if (contract?.state === 'RECEIVED') {
      const { landed } = farmerPaid(contract.id);
      lines.push({ key: 'ussd.lot.received', params: { amount: formatGhs(Math.max(0, orderTotal(contract) - (contract.deductionAmount ?? 0) - landed)) } });
    } else if (contract?.state === 'CLAIMED') {
      const claim = listClaimsForContract(contract.id).at(-1);
      if (claim?.status === 'awaiting_farmer') {
        lines.push(
          { key: 'ussd.lot.claim', params: { reason: t(ctx.locale, `claim.reason.${claim.reason}`), amount: formatGhs(claim.proposedDeduction) } },
          { key: 'ussd.claim.accept' },
          { key: 'ussd.claim.refuse' },
        );
      } else {
        lines.push({ key: 'ussd.lot.claimReview' });
      }
    } else if (lot.askingPricePerUnit) {
      lines.push({ key: 'ussd.lot.askingUnit', params: { price: formatGhs(lot.askingPricePerUnit) } });
    } else if (lot.askingPricePerKg) {
      lines.push({ key: 'ussd.lot.asking', params: { price: formatGhs(lot.askingPricePerKg) } });
    }
    // A listing on the market can be changed, marked sold, or taken off (Phase 1).
    if (!contract && (lot.status === 'registered' || lot.status === 'matched')) {
      lines.push({ key: 'ussd.lot.withdraw' }, { key: 'ussd.lot.editPrice' }, { key: 'ussd.lot.editQty' }, { key: 'ussd.lot.sold' }, { key: 'ussd.lot.editReady' });
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
      if (input === '5') return { next: 'lot_edit_ready' };
      return invalid();
    }
    const contract = getContract(contractId);

    if (contract.state === 'FUNDS_HELD' && input === '1') {
      confirmPickup(contractId, { type: 'farmer', id: ctx.farmer.id });
      return { end: [{ key: 'ussd.pickup.done' }] };
    }
    if (contract.state === 'FUNDS_HELD' && input === '2' && !getJobForContract(contractId)) {
      try {
        suggestTransport(contractId, ctx.farmer.id);
      } catch (err) {
        if (err instanceof DomainError && err.code === 'JOB_EXISTS') return { end: [{ key: 'ussd.lot.transportExists' }] };
        throw err;
      }
      return { end: [{ key: 'ussd.lot.transportAsked' }] };
    }
    if (contract.state === 'CLAIMED') {
      const claim = listClaimsForContract(contractId).at(-1);
      if (claim?.status === 'awaiting_farmer' && (input === '1' || input === '2')) {
        const held = orderTotal(contract) - farmerPaid(contractId).landed - farmerPaid(contractId).pending;
        await answerClaim(claim.id, ctx.farmer.id, input === '1');
        return input === '1'
          ? { end: [{ key: 'ussd.claim.acceptedDone', params: { amount: formatGhs(Math.max(0, held - claim.proposedDeduction)) } }] }
          : { end: [{ key: 'ussd.claim.refusedDone', params: { amount: formatGhs(Math.max(0, held - claim.proposedDeduction)) } }] };
      }
    }
    if (contract.state === 'GRADED') {
      if (input === '1') {
        await agreeGrading(contractId, ctx.farmer.id);
        return { end: [{ key: 'ussd.grade.agreeDone', params: { amount: formatGhs(advanceFor(contract)) } }] };
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

// Phase 2 (vision §5.5): "update the availability date" — the same choices as the sell flow.
const READY_CHOICES = [
  { key: 'ussd.sell.readyNow', days: 0 },
  { key: 'ussd.sell.readyTomorrow', days: 1 },
  { key: 'ussd.sell.readyWeek', days: 7 },
  { key: 'ussd.sell.readyTwoWeeks', days: 14 },
] as const;

function readyChoices(lotId: string) {
  const forward = getCommodityById(getLot(lotId).commodityId).clock.allowsForward;
  return forward ? READY_CHOICES : READY_CHOICES.slice(0, 2); // a perishable is ready today or tomorrow
}

export const lotEditReady: UssdScreen = {
  key: 'lot_edit_ready',
  render: (ctx) => [
    { key: 'ussd.sell.ready' },
    ...listLines(readyChoices(String(ctx.data.lotId)).map((c) => t(ctx.locale, c.key)), { hasMore: false }),
  ],
  handleInput: (input, ctx) => {
    if (input === '0') return { next: 'lot_detail' };
    if (!ctx.farmer) return invalid();
    const choices = readyChoices(String(ctx.data.lotId));
    const idx = parseSelection(input, choices.length, 0);
    if (idx === null) return invalid();
    const lot = updateLot(String(ctx.data.lotId), ctx.farmer.id, { readyDate: Date.now() + choices[idx]!.days * DAY_MS });
    return updatedEnd(lot.lotCode);
  },
};
