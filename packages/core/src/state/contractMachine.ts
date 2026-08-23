import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import {
  contracts,
  demands,
  lots,
  matches,
  type Contract,
  type ContractState,
  type LotEventType,
} from '../db/schema';
import { DomainError, notFound } from '../domain/errors';
import { appendLotEvent, type DbLike } from '../domain/trace';

export interface Actor {
  type: 'farmer' | 'buyer' | 'system';
  id?: string;
}

/** Allowed transitions and who may drive them. */
const TRANSITIONS: Record<string, { actors: Array<Actor['type']> }> = {
  'OFFERED>ACCEPTED': { actors: ['farmer'] },
  'OFFERED>DECLINED': { actors: ['farmer'] },
  'OFFERED>EXPIRED': { actors: ['system'] },
  'ACCEPTED>FUNDS_HELD': { actors: ['system'] },
  'ACCEPTED>FUNDING_FAILED': { actors: ['system'] },
  'FUNDING_FAILED>ACCEPTED': { actors: ['system'] }, // retry with a fresh reference
  'FUNDING_FAILED>CANCELLED': { actors: ['system'] },
  'FUNDS_HELD>PICKUP_CONFIRMED': { actors: ['farmer', 'buyer', 'system'] }, // system = driver pickup via logistics (D-025)
  'FUNDS_HELD>CANCELLED_REFUNDED': { actors: ['system'] }, // pickup window missed
  'PICKUP_CONFIRMED>GRADED': { actors: ['system'] },
  'GRADED>DISPUTED': { actors: ['farmer'] },
  'DISPUTED>GRADED': { actors: ['system'] }, // re-grade, final
  'DISPUTED>CANCELLED_REFUNDED': { actors: ['system'] },
  'GRADED>CANCELLED_REFUNDED': { actors: ['system'] }, // grade REJECT
  'GRADED>SETTLED': { actors: ['system'] },
};

const EVENT_FOR_STATE: Record<ContractState, LotEventType | null> = {
  OFFERED: 'CONTRACT_OFFERED',
  ACCEPTED: 'CONTRACT_ACCEPTED',
  DECLINED: 'CONTRACT_DECLINED',
  EXPIRED: 'OFFER_EXPIRED',
  FUNDING_FAILED: 'FUNDING_FAILED',
  CANCELLED: 'CANCELLED',
  FUNDS_HELD: 'FUNDS_HELD',
  PICKUP_CONFIRMED: 'PICKUP_CONFIRMED',
  GRADED: 'GRADED',
  DISPUTED: 'DISPUTE_OPENED',
  CANCELLED_REFUNDED: 'REFUNDED',
  SETTLED: 'SETTLED',
};

const TERMINAL_RELEASING_STATES: ContractState[] = ['DECLINED', 'EXPIRED', 'CANCELLED', 'CANCELLED_REFUNDED'];

export interface TransitionExtra {
  finalGrade?: string;
  finalAmount?: number;
  declineReasonKey?: string;
  disputeNote?: string;
  payload?: Record<string, unknown>;
  /** Extra work (e.g. ledger postings) that must commit atomically with the transition. */
  also?: (tx: DbLike, contract: Contract) => void;
}

/**
 * Apply a guarded contract state transition. The contract update, lot/demand
 * side effects, and the trace event all commit in ONE transaction.
 */
export function transitionContract(
  contractId: string,
  to: ContractState,
  actor: Actor,
  extra: TransitionExtra = {},
): Contract {
  return db.transaction((tx) => {
    const contract = tx.select().from(contracts).where(eq(contracts.id, contractId)).get();
    if (!contract) throw notFound('contract');

    const rule = TRANSITIONS[`${contract.state}>${to}`];
    if (!rule) {
      throw new DomainError(`Cannot move contract from ${contract.state} to ${to}`, 'INVALID_TRANSITION', 409);
    }
    if (!rule.actors.includes(actor.type)) {
      throw new DomainError(`${actor.type} may not perform this action`, 'FORBIDDEN_ACTOR', 403);
    }
    // A farmer/buyer may only act on their own contract.
    if (actor.type === 'farmer' && actor.id !== contract.farmerId) {
      throw new DomainError('Not your contract', 'FORBIDDEN_ACTOR', 403);
    }
    if (actor.type === 'buyer' && actor.id !== contract.buyerId) {
      throw new DomainError('Not your contract', 'FORBIDDEN_ACTOR', 403);
    }

    const now = Date.now();
    const updates: Partial<typeof contracts.$inferInsert> = { state: to };
    if (to === 'ACCEPTED' && !contract.acceptedAt) updates.acceptedAt = now;
    if (to === 'FUNDS_HELD') updates.fundedAt = now;
    if (to === 'PICKUP_CONFIRMED') updates.pickupConfirmedAt = now;
    if (to === 'GRADED') {
      updates.gradedAt = now;
      if (extra.finalGrade !== undefined) updates.finalGrade = extra.finalGrade;
      if (extra.finalAmount !== undefined) updates.finalAmount = extra.finalAmount;
    }
    if (to === 'SETTLED') {
      updates.settledAt = now;
      updates.closedAt = now;
    }
    if (TERMINAL_RELEASING_STATES.includes(to)) updates.closedAt = now;
    if (extra.declineReasonKey) updates.declineReasonKey = extra.declineReasonKey;
    if (extra.disputeNote) updates.disputeNote = extra.disputeNote;

    const updated = tx.update(contracts).set(updates).where(eq(contracts.id, contractId)).returning().get()!;

    applySideEffects(tx, updated, to);
    extra.also?.(tx, updated);

    const eventType = EVENT_FOR_STATE[to];
    if (eventType) {
      appendLotEvent(tx, {
        lotId: contract.lotId,
        type: eventType,
        actorType: actor.type,
        actorId: actor.id ?? null,
        payload: {
          contractId,
          ...(extra.finalGrade ? { grade: extra.finalGrade } : {}),
          ...(extra.finalAmount !== undefined ? { finalAmount: extra.finalAmount } : {}),
          ...(extra.payload ?? {}),
        },
      });
    }
    return updated;
  });
}

/** Lot/demand/match bookkeeping that must ride in the same transaction. */
function applySideEffects(tx: DbLike, contract: Contract, to: ContractState): void {
  const setMatch = (status: 'accepted' | 'declined' | 'expired') =>
    tx.update(matches).set({ status }).where(eq(matches.id, contract.matchId)).run();

  if (to === 'ACCEPTED') {
    setMatch('accepted');
    tx.update(lots).set({ status: 'contracted' }).where(eq(lots.id, contract.lotId)).run();
  }

  if (to === 'DECLINED' || to === 'EXPIRED' || to === 'CANCELLED' || to === 'CANCELLED_REFUNDED') {
    // Release the reservation taken at offer time, on both sides — the produce
    // still exists (declined/expired/rejected) and the buyer still needs the kg.
    setMatch(to === 'DECLINED' ? 'declined' : 'expired');
    const lot = tx.select().from(lots).where(eq(lots.id, contract.lotId)).get();
    if (lot) {
      const remaining = Math.min(lot.quantityKg, lot.remainingKg + contract.quantityKg);
      tx.update(lots)
        .set({ remainingKg: remaining, status: remaining > 0 ? 'registered' : lot.status })
        .where(eq(lots.id, lot.id))
        .run();
    }
    const demand = tx.select().from(demands).where(eq(demands.id, contract.demandId)).get();
    if (demand && demand.status !== 'expired' && demand.status !== 'cancelled') {
      const remaining = Math.min(demand.quantityKg, demand.remainingKg + contract.quantityKg);
      tx.update(demands)
        .set({ remainingKg: remaining, status: remaining >= demand.quantityKg ? 'open' : 'partially_matched' })
        .where(eq(demands.id, demand.id))
        .run();
    }
  }

  if (to === 'GRADED') {
    tx.update(lots).set({ status: 'graded' }).where(eq(lots.id, contract.lotId)).run();
  }
  if (to === 'SETTLED') {
    tx.update(lots).set({ status: 'settled' }).where(eq(lots.id, contract.lotId)).run();
    const demand = tx.select().from(demands).where(eq(demands.id, contract.demandId)).get();
    if (demand && demand.remainingKg <= 0) {
      tx.update(demands).set({ status: 'fulfilled' }).where(eq(demands.id, demand.id)).run();
    }
  }
}
