import {
  acceptOfferAndHold,
  contractPriceTerms,
  declineOffer,
  DomainError,
  formatGhs,
  getBuyerById,
  getCommodityById,
  getContract,
  getFarmerByPhone,
  t,
  type I18nText,
} from '@ftm/core';
import type { IvrCtx, IvrFlow, IvrResult } from '../machine';

// "Hear the offer, press 1 to accept" — the same domain calls USSD and web make.

async function offerGuard(ctx: IvrCtx): Promise<I18nText[] | null> {
  const contract = ctx.call.contractId ? await getContract(ctx.call.contractId) : null;
  if (!contract || contract.state !== 'OFFERED') return [{ key: 'voice.offer.gone' }];
  return null;
}

async function offerSay(ctx: IvrCtx): Promise<I18nText[]> {
  const contract = await getContract(ctx.call.contractId!);
  const commodity = getCommodityById(contract.commodityId);
  const buyer = await getBuyerById(contract.buyerId);
  const terms = contractPriceTerms(contract);
  return [
    {
      key: 'voice.offer.intro',
      params: {
        kg: contract.quantityKg,
        commodity: t(ctx.locale, commodity.nameKey),
        buyer: buyer?.company ?? buyer?.name ?? '',
        amount: formatGhs(contract.quantityKg * (terms.A ?? 0)),
      },
    },
    { key: 'voice.offer.menu' },
  ];
}

async function offerDigits(digits: string, ctx: IvrCtx): Promise<IvrResult> {
  const contractId = ctx.call.contractId;
  const farmer = await getFarmerByPhone(ctx.call.phone);
  if (!contractId || !farmer) return { end: [{ key: 'voice.common.goodbye' }], outcome: { result: 'no_context' } };
  const contract = await getContract(contractId);
  if (contract.state !== 'OFFERED') return { end: [{ key: 'voice.offer.gone' }], outcome: { result: 'gone' } };

  if (digits === '1') {
    try {
      const accepted = await acceptOfferAndHold(contractId, farmer.id);
      return {
        end: [{ key: 'voice.offer.accepted', params: { amount: formatGhs(accepted.holdAmount) } }],
        outcome: { result: 'accepted' },
      };
    } catch (err) {
      if (err instanceof DomainError && err.code === 'OFFER_EXPIRED') {
        return { end: [{ key: 'voice.offer.gone' }], outcome: { result: 'expired' } };
      }
      throw err;
    }
  }
  if (digits === '2') {
    await declineOffer(contractId, farmer.id);
    return { end: [{ key: 'voice.offer.declined' }], outcome: { result: 'declined' } };
  }
  return { next: 'offer_main' }; // invalid digit — repeat the menu
}

export const offerFlow: IvrFlow = {
  entry: 'offer_main',
  nodes: [{ key: 'offer_main', guard: offerGuard, say: offerSay, onDigits: offerDigits }],
};
