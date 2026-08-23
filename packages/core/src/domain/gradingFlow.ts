import { desc, eq } from 'drizzle-orm';
import { config } from '../config';
import { db } from '../db/client';
import { gradings, type Contract, type Grading } from '../db/schema';
import { gradeWithFallback } from '../providers/grading/index';
import { transitionContract } from '../state/contractMachine';
import { contractPriceTerms, getContract } from './contracts';
import { DomainError } from './errors';
import { initiateRelease, refundHold } from './paymentFlow';
import { listPhotosForContract, photoAsGradingImage } from './photos';
import { getActiveRubric, getCommodityById, getRubricById } from './registries';
import { appendLotEvent } from './trace';
import { rubricDocSchema, type GradeBand } from './types';

const MAX_GRADING_ATTEMPTS = 2; // initial + one re-grade after a dispute — the re-grade is final

export function confirmPickup(contractId: string, actor: { type: 'farmer' | 'buyer'; id: string }): Contract {
  return transitionContract(contractId, 'PICKUP_CONFIRMED', actor);
}

export function listGradingsForContract(contractId: string): Grading[] {
  return db.select().from(gradings).where(eq(gradings.contractId, contractId)).orderBy(desc(gradings.attempt)).all();
}

/**
 * Photograph-and-grade: reads the contract's pickup photos, grades them
 * against the commodity's PINNED rubric version, freezes grade + final amount
 * onto the contract, and refunds outright on REJECT.
 */
export async function runGrading(contractId: string): Promise<Grading> {
  const contract = getContract(contractId);
  if (contract.state !== 'PICKUP_CONFIRMED' && contract.state !== 'DISPUTED') {
    throw new DomainError(`Cannot grade a contract in ${contract.state}`, 'INVALID_STATE', 409);
  }
  const photos = listPhotosForContract(contractId);
  if (photos.length === 0) {
    throw new DomainError('Grading requires at least one pickup photo', 'NO_PHOTOS', 409);
  }

  const previous = listGradingsForContract(contractId);
  const attempt = previous.length + 1;
  if (attempt > MAX_GRADING_ATTEMPTS) {
    throw new DomainError('Re-grade already performed — the second grade is final', 'GRADING_EXHAUSTED', 409);
  }

  // Disputes re-grade under the SAME rubric version the lot was first graded with.
  const commodity = getCommodityById(contract.commodityId);
  const { rubric, doc } =
    previous.length > 0 ? getRubricById(previous[previous.length - 1]!.rubricId) : getActiveRubric(commodity.id);
  rubricDocSchema.parse(doc); // belt and braces — the rubric drives money

  const pending = db
    .insert(gradings)
    .values({
      contractId,
      lotId: contract.lotId,
      rubricId: rubric.id,
      attempt,
      provider: 'mock', // overwritten with the provider that actually answered
      status: 'pending',
    })
    .returning()
    .get();

  let result;
  try {
    result = await gradeWithFallback({
      commodityCode: commodity.code,
      rubric: doc,
      images: photos.map(photoAsGradingImage),
    });
  } catch (err) {
    db.update(gradings).set({ status: 'failed', rawResponse: String(err) }).where(eq(gradings.id, pending.id)).run();
    throw err;
  }

  const terms = contractPriceTerms(contract);
  const finalAmount =
    result.gradeBand === 'REJECT' ? 0 : Math.round(contract.quantityKg * (terms[result.gradeBand as GradeBand] ?? 0));

  const completed = db
    .update(gradings)
    .set({
      status: 'completed',
      provider: result.provider,
      model: result.model ?? null,
      gradeBand: result.gradeBand,
      confidence: result.confidence,
      reasons: JSON.stringify(result.reasons),
      rawResponse: typeof result.raw === 'string' ? result.raw : JSON.stringify(result.raw ?? null),
    })
    .where(eq(gradings.id, pending.id))
    .returning()
    .get()!;

  transitionContract(contract.id, 'GRADED', { type: 'system' }, {
    finalGrade: result.gradeBand,
    finalAmount,
    payload: {
      attempt,
      confidence: result.confidence,
      provider: result.provider,
      topReason: result.reasons[0]?.observation ?? null,
    },
  });

  if (previous.length > 0) {
    // The disputed first attempt is now resolved by this final re-grade.
    db.update(gradings).set({ status: 'resolved' }).where(eq(gradings.id, previous[previous.length - 1]!.id)).run();
    appendLotEvent(db, {
      lotId: contract.lotId,
      type: 'DISPUTE_RESOLVED',
      actorType: 'system',
      payload: { attempt, finalGrade: result.gradeBand },
    });
  }

  if (result.gradeBand === 'REJECT') {
    refundHold(contractId, { reason: 'grade_reject', attempt });
  }
  return completed;
}

/** Farmer contests the grade within the dispute window. The re-grade is final. */
export function disputeGrading(contractId: string, farmerId: string, note?: string): Contract {
  const contract = getContract(contractId);
  if (contract.state !== 'GRADED') {
    throw new DomainError(`Cannot dispute a contract in ${contract.state}`, 'INVALID_STATE', 409);
  }
  const windowMs = config.DISPUTE_WINDOW_MINUTES * 60 * 1000;
  if (contract.gradedAt && Date.now() - contract.gradedAt > windowMs) {
    throw new DomainError('The dispute window has closed', 'DISPUTE_WINDOW_CLOSED', 409);
  }
  if (listGradingsForContract(contractId).length >= MAX_GRADING_ATTEMPTS) {
    throw new DomainError('The re-grade is final and cannot be disputed again', 'GRADING_EXHAUSTED', 409);
  }
  const updated = transitionContract(contractId, 'DISPUTED', { type: 'farmer', id: farmerId }, { disputeNote: note });
  const latest = listGradingsForContract(contractId)[0];
  if (latest) db.update(gradings).set({ status: 'disputed' }).where(eq(gradings.id, latest.id)).run();
  return updated;
}

/** Farmer agrees with the grade — release the payout now instead of waiting out the window. */
export async function agreeGrading(contractId: string, farmerId: string): Promise<void> {
  const contract = getContract(contractId);
  if (contract.farmerId !== farmerId) {
    throw new DomainError('Not your contract', 'FORBIDDEN_ACTOR', 403);
  }
  await initiateRelease(contractId);
}
