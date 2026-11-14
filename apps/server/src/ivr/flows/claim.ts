import {
  answerClaim,
  config,
  DomainError,
  formatGhs,
  getBuyerById,
  getCommodityById,
  getContract,
  openClaimFor,
  stillHeld,
  t,
  type I18nText,
} from '@ftm/core';
import type { IvrCtx, IvrFlow, IvrResult } from '../machine';
import { farmerOf } from './common';

/**
 * A buyer's claim, read to the farmer (Phase 3, vision §20): what the buyer
 * says is wrong and the deduction they ask for. 1 accepts it (the order
 * settles), 2 refuses it (the undisputed part is paid now and F2M reviews
 * the rest), 4 or 9 hears it again. Same moves as USSD My lots.
 */

function claimOf(ctx: IvrCtx) {
  return ctx.call.contractId ? openClaimFor(ctx.call.contractId) : undefined;
}

function guard(ctx: IvrCtx): I18nText[] | null {
  return claimOf(ctx) ? null : [{ key: 'voice.claim.gone' }];
}

function say(ctx: IvrCtx): I18nText[] {
  const claim = claimOf(ctx)!;
  const contract = getContract(claim.contractId);
  const buyer = getBuyerById(contract.buyerId);
  return [
    {
      key: 'voice.claim.intro',
      params: {
        buyer: buyer?.company ?? buyer?.name ?? '',
        commodity: t(ctx.locale, getCommodityById(contract.commodityId).nameKey),
        reason: t(ctx.locale, `claim.reason.${claim.reason}`),
        amount: formatGhs(claim.proposedDeduction),
        rest: formatGhs(stillHeld(contract)),
      },
    },
    { key: 'voice.claim.menu', params: { hours: config.CLAIM_ANSWER_HOURS } },
  ];
}

async function onDigits(digits: string, ctx: IvrCtx): Promise<IvrResult> {
  const claim = claimOf(ctx);
  const farmer = farmerOf(ctx);
  if (!claim || !farmer) return { end: [{ key: 'voice.claim.gone' }], outcome: { result: 'gone' } };
  if (digits !== '1' && digits !== '2') return { next: 'claim_main' }; // 4, or any other key: again
  const contract = getContract(claim.contractId);
  const paidNow = formatGhs(Math.max(0, stillHeld(contract) - claim.proposedDeduction));
  try {
    await answerClaim(claim.id, farmer.id, digits === '1');
  } catch (err) {
    if (err instanceof DomainError && err.code === 'CLAIM_ANSWERED') return { end: [{ key: 'voice.claim.gone' }], outcome: { result: 'gone' } };
    throw err;
  }
  return digits === '1'
    ? { end: [{ key: 'voice.claim.accepted', params: { amount: paidNow } }], outcome: { result: 'accepted' } }
    : { end: [{ key: 'voice.claim.refused', params: { amount: paidNow } }], outcome: { result: 'refused' } };
}

export const claimFlow: IvrFlow = { entry: 'claim_main', nodes: [{ key: 'claim_main', guard, say, onDigits }] };
