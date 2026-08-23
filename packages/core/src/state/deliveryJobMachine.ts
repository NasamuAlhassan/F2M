import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { deliveryJobs, type DeliveryJob, type DeliveryJobState, type LotEventType } from '../db/schema';
import { DomainError, notFound } from '../domain/errors';
import { appendLotEvent, type DbLike } from '../domain/trace';

export interface JobActor {
  type: 'driver' | 'buyer' | 'system';
  id?: string;
}

/** Allowed transitions and who may drive them. */
const TRANSITIONS: Record<string, { actors: Array<JobActor['type']> }> = {
  'REQUESTED>ASSIGNED': { actors: ['driver'] }, // accept a live dispatch offer
  'REQUESTED>NO_DRIVER': { actors: ['system'] }, // candidates exhausted
  'REQUESTED>CANCELLED': { actors: ['buyer', 'system'] },
  'NO_DRIVER>REQUESTED': { actors: ['buyer'] }, // retry dispatch
  'NO_DRIVER>CANCELLED': { actors: ['buyer', 'system'] },
  'ASSIGNED>FUNDS_HELD': { actors: ['system'] }, // fee collection confirmed
  'ASSIGNED>FUNDING_FAILED': { actors: ['system'] },
  'FUNDING_FAILED>ASSIGNED': { actors: ['system'] }, // one retry, fresh reference
  'FUNDING_FAILED>CANCELLED': { actors: ['system'] },
  'FUNDS_HELD>PICKED_UP': { actors: ['driver'] },
  'FUNDS_HELD>CANCELLED_REFUNDED': { actors: ['system'] }, // produce contract died
  'PICKED_UP>DELIVERED': { actors: ['buyer'] }, // receipt verification — the release trigger
  'DELIVERED>PAID': { actors: ['system'] }, // disbursement confirmed
};

const EVENT_FOR_STATE: Record<DeliveryJobState, LotEventType | null> = {
  REQUESTED: 'TRANSPORT_REQUESTED', // appended at creation, not via transition
  ASSIGNED: 'DRIVER_ASSIGNED',
  NO_DRIVER: 'TRANSPORT_CANCELLED',
  FUNDING_FAILED: null, // noisy — the retry/cancel outcome is what matters
  FUNDS_HELD: 'TRANSPORT_FUNDED',
  PICKED_UP: 'IN_TRANSIT',
  DELIVERED: 'TRANSPORT_DELIVERED',
  PAID: 'DRIVER_PAID',
  CANCELLED: 'TRANSPORT_CANCELLED',
  CANCELLED_REFUNDED: 'TRANSPORT_CANCELLED',
};

const TERMINAL_STATES: DeliveryJobState[] = ['PAID', 'CANCELLED', 'CANCELLED_REFUNDED', 'NO_DRIVER'];

export interface JobTransitionExtra {
  /** Set on REQUESTED>ASSIGNED — the accepting driver. */
  driverId?: string;
  payload?: Record<string, unknown>;
  /** Extra work (offer rows, ledger postings) that must commit atomically. */
  also?: (tx: DbLike, job: DeliveryJob) => void;
}

/**
 * Guarded delivery-job transition — the job update, its side effects, and the
 * lot trace event commit in ONE transaction (same shape as transitionContract).
 */
export function transitionJob(
  jobId: string,
  to: DeliveryJobState,
  actor: JobActor,
  extra: JobTransitionExtra = {},
): DeliveryJob {
  return db.transaction((tx) => {
    const job = tx.select().from(deliveryJobs).where(eq(deliveryJobs.id, jobId)).get();
    if (!job) throw notFound('delivery job');

    const rule = TRANSITIONS[`${job.state}>${to}`];
    if (!rule) {
      throw new DomainError(`Cannot move job from ${job.state} to ${to}`, 'INVALID_TRANSITION', 409);
    }
    if (!rule.actors.includes(actor.type)) {
      throw new DomainError(`${actor.type} may not perform this action`, 'FORBIDDEN_ACTOR', 403);
    }
    // A driver may only act on their own job — except the accept, which claims it.
    if (actor.type === 'driver' && job.driverId && actor.id !== job.driverId) {
      throw new DomainError('Not your job', 'FORBIDDEN_ACTOR', 403);
    }
    if (actor.type === 'buyer' && actor.id !== job.buyerId) {
      throw new DomainError('Not your job', 'FORBIDDEN_ACTOR', 403);
    }

    const now = Date.now();
    const updates: Partial<typeof deliveryJobs.$inferInsert> = { state: to };
    if (to === 'ASSIGNED') {
      updates.assignedAt = now;
      if (extra.driverId) updates.driverId = extra.driverId;
    }
    if (to === 'FUNDS_HELD') updates.fundedAt = now;
    if (to === 'PICKED_UP') updates.pickedUpAt = now;
    if (to === 'DELIVERED') updates.deliveredAt = now;
    if (to === 'PAID') {
      updates.paidAt = now;
      updates.closedAt = now;
    }
    if (TERMINAL_STATES.includes(to) && to !== 'PAID') updates.closedAt = now;

    const updated = tx.update(deliveryJobs).set(updates).where(eq(deliveryJobs.id, jobId)).returning().get()!;
    extra.also?.(tx, updated);

    const eventType = EVENT_FOR_STATE[to];
    if (eventType && to !== 'REQUESTED') {
      appendLotEvent(tx, {
        lotId: job.lotId,
        type: eventType,
        actorType: actor.type === 'driver' ? 'system' : actor.type, // lot_events actor enum has no driver; payload carries it
        actorId: actor.id ?? null,
        payload: {
          jobId,
          jobCode: job.jobCode,
          ...(actor.type === 'driver' ? { driverActor: actor.id } : {}),
          ...(extra.payload ?? {}),
        },
      });
    }
    return updated;
  });
}
