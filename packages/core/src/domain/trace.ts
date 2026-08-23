import { eq, max } from 'drizzle-orm';
import { db, type Db } from '../db/client';
import { lotEvents, type LotEvent, type LotEventType } from '../db/schema';

// Accept either the root db or a transaction handle — events must append in the
// SAME transaction as the state change they describe.
export type DbLike = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

export interface LotEventInput {
  lotId: string;
  type: LotEventType;
  actorType: 'farmer' | 'buyer' | 'system';
  actorId?: string | null;
  payload?: Record<string, unknown>;
}

export function appendLotEvent(tx: DbLike, ev: LotEventInput): void {
  const row = tx
    .select({ maxSeq: max(lotEvents.seq) })
    .from(lotEvents)
    .where(eq(lotEvents.lotId, ev.lotId))
    .get();
  tx.insert(lotEvents)
    .values({
      lotId: ev.lotId,
      seq: (row?.maxSeq ?? 0) + 1,
      type: ev.type,
      actorType: ev.actorType,
      actorId: ev.actorId ?? null,
      payload: ev.payload ? JSON.stringify(ev.payload) : null,
    })
    .run();
}

export interface TraceEvent extends Omit<LotEvent, 'payload'> {
  payload: Record<string, unknown> | null;
}

export function getTrace(lotId: string): TraceEvent[] {
  return db
    .select()
    .from(lotEvents)
    .where(eq(lotEvents.lotId, lotId))
    .orderBy(lotEvents.seq)
    .all()
    .map((e) => ({ ...e, payload: e.payload ? (JSON.parse(e.payload) as Record<string, unknown>) : null }));
}
