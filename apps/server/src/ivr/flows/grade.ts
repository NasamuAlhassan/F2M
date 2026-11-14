import {
  advanceFor,
  agreeGrading,
  orderTotal,
  disputeGrading,
  formatGhs,
  getCommodityById,
  getContract,
  getFarmerByPhone,
  listGradingsForContract,
  t,
  type I18nText,
} from '@ftm/core';
import type { IvrCtx, IvrFlow, IvrResult } from '../machine';

function gradeGuard(ctx: IvrCtx): I18nText[] | null {
  const contract = ctx.call.contractId ? getContract(ctx.call.contractId) : null;
  // Phase 3: an order with no transport job is already DELIVERED once graded; the grade is still hers to hear.
  if (!contract || !['GRADED', 'DELIVERED'].includes(contract.state) || !contract.finalGrade) return [{ key: 'voice.common.gone' }];
  return null;
}

function gradeSay(ctx: IvrCtx): I18nText[] {
  const contract = getContract(ctx.call.contractId!);
  const commodity = getCommodityById(contract.commodityId);
  const grading = listGradingsForContract(contract.id)[0];
  const reasons = grading?.reasons ? (JSON.parse(grading.reasons) as Array<{ observation: string }>) : [];
  return [
    {
      key: 'voice.grade.intro',
      params: {
        commodity: t(ctx.locale, commodity.nameKey),
        band: t(ctx.locale, `band.${contract.finalGrade}`),
        advance: formatGhs(advanceFor(contract)),
        rest: formatGhs(orderTotal(contract) - advanceFor(contract)),
        reason: reasons[0]?.observation ?? '',
      },
    },
    { key: contract.state === 'GRADED' ? 'voice.grade.menu' : 'voice.grade.menuNoDispute' },
  ];
}

async function gradeDigits(digits: string, ctx: IvrCtx): Promise<IvrResult> {
  const contractId = ctx.call.contractId;
  const farmer = getFarmerByPhone(ctx.call.phone);
  if (!contractId || !farmer) return { end: [{ key: 'voice.common.goodbye' }], outcome: { result: 'no_context' } };
  const contract = getContract(contractId);
  if (!['GRADED', 'DELIVERED'].includes(contract.state)) return { end: [{ key: 'voice.common.gone' }], outcome: { result: 'gone' } };

  if (digits === '1') {
    await agreeGrading(contractId, farmer.id);
    return {
      end: [{ key: 'voice.grade.agreed', params: { amount: formatGhs(advanceFor(contract)) } }],
      outcome: { result: 'agreed' },
    };
  }
  if (digits === '2' && contract.state === 'GRADED') {
    disputeGrading(contractId, farmer.id);
    return { end: [{ key: 'voice.grade.disputed' }], outcome: { result: 'disputed' } };
  }
  return { next: 'grade_main' };
}

export const gradeFlow: IvrFlow = {
  entry: 'grade_main',
  nodes: [{ key: 'grade_main', guard: gradeGuard, say: gradeSay, onDigits: gradeDigits }],
};
