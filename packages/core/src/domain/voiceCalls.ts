import { and, desc, eq, inArray } from 'drizzle-orm';
import { config } from '../config';
import { db } from '../db/client';
import { contracts, offers, voiceCalls, type VoiceCall } from '../db/schema';
import { getVoiceProvider } from '../providers/voice/index';
import { carrierCallbackUrl } from './carrier';
import { appendLotEvent } from './trace';

const MAX_CALL_ATTEMPTS = 2;
const ACTIVE_STATUSES = ['pending', 'placing', 'in_progress'] as const;

export interface QueueVoiceCallInput {
  phone: string;
  locale: string;
  flow: 'offer' | 'grade' | 'bridge' | 'bid';
  contractId?: string;
  /** The 'bid' flow (Phase 1): the offer thread whose proposal the call reads out. */
  offerId?: string;
}

/** Queue an outbound IVR call. Deduped: one active call per (phone, flow, contract or offer). */
export function queueVoiceCall(input: QueueVoiceCallInput): VoiceCall {
  const existing = db
    .select()
    .from(voiceCalls)
    .where(
      and(
        eq(voiceCalls.phone, input.phone),
        eq(voiceCalls.flow, input.flow),
        inArray(voiceCalls.status, [...ACTIVE_STATUSES]),
      ),
    )
    .all()
    .find((c) => c.contractId === (input.contractId ?? null) && c.offerId === (input.offerId ?? null));
  if (existing) return existing;

  return db
    .insert(voiceCalls)
    .values({
      phone: input.phone,
      locale: input.locale,
      flow: input.flow,
      contractId: input.contractId ?? null,
      offerId: input.offerId ?? null,
    })
    .returning()
    .get();
}

export function getVoiceCall(id: string): VoiceCall | undefined {
  return db.select().from(voiceCalls).where(eq(voiceCalls.id, id)).get();
}

/** The call a gateway callback without a callId belongs to: latest live call for the phone. */
export function getActiveCallForPhone(phone: string): VoiceCall | undefined {
  return db
    .select()
    .from(voiceCalls)
    .where(and(eq(voiceCalls.phone, phone), inArray(voiceCalls.status, ['placing', 'in_progress'])))
    .orderBy(desc(voiceCalls.createdAt))
    .get();
}

export function listVoiceCallsForPhone(phone: string, limit = 10): VoiceCall[] {
  return db
    .select()
    .from(voiceCalls)
    .where(eq(voiceCalls.phone, phone))
    .orderBy(desc(voiceCalls.createdAt))
    .all()
    .slice(0, limit);
}

/** Sweep (fast lane): place pending calls via the configured provider. */
export async function placePendingVoiceCalls(): Promise<number> {
  const provider = getVoiceProvider();
  const pending = db.select().from(voiceCalls).where(eq(voiceCalls.status, 'pending')).all();
  let placed = 0;
  for (const call of pending) {
    const now = Date.now();
    try {
      const result = await provider.initiateCall({
        callId: call.id,
        phone: call.phone,
        callbackUrl: carrierCallbackUrl(`/voice/answer?callId=${call.id}`),
      });
      if (result.status === 'queued') {
        db.update(voiceCalls)
          .set({
            status: 'placing',
            providerRef: result.providerRef ?? null,
            attempts: call.attempts + 1,
            lastAttemptAt: now,
            updatedAt: now,
          })
          .where(eq(voiceCalls.id, call.id))
          .run();
        placed += 1;
      } else {
        failOrRetry(call, now, JSON.stringify(result.raw ?? null));
      }
    } catch (err) {
      failOrRetry(call, now, String(err));
    }
  }
  return placed;
}

function failOrRetry(call: VoiceCall, now: number, raw: string): void {
  const attempts = call.attempts + 1;
  db.update(voiceCalls)
    .set({
      status: attempts >= MAX_CALL_ATTEMPTS ? 'failed' : 'pending',
      attempts,
      outcome: raw,
      lastAttemptAt: now,
      updatedAt: now,
    })
    .where(eq(voiceCalls.id, call.id))
    .run();
}

export function markCallInProgress(callId: string, sessionRef: string): void {
  db.update(voiceCalls)
    .set({ status: 'in_progress', sessionRef, updatedAt: Date.now() })
    .where(eq(voiceCalls.id, callId))
    .run();
}

export function setCallNode(callId: string, node: string): void {
  db.update(voiceCalls).set({ currentNode: node, updatedAt: Date.now() }).where(eq(voiceCalls.id, callId)).run();
}

/** Terminal call outcome + a VOICE_CALL trace event on the lot it was about. */
export function finishVoiceCall(callId: string, status: 'completed' | 'no_answer' | 'failed', outcome?: Record<string, unknown>): void {
  const call = getVoiceCall(callId);
  if (!call) return;
  db.update(voiceCalls)
    .set({ status, outcome: outcome ? JSON.stringify(outcome) : call.outcome, updatedAt: Date.now() })
    .where(eq(voiceCalls.id, callId))
    .run();
  // The call belongs to a contract's lot, or (Phase 1 bid calls, which ring
  // before any contract exists) to the lot the offer is about.
  const lotId = call.contractId
    ? db.select().from(contracts).where(eq(contracts.id, call.contractId)).get()?.lotId
    : call.offerId
      ? db.select().from(offers).where(eq(offers.id, call.offerId)).get()?.lotId
      : undefined;
  if (lotId) {
    appendLotEvent(db, {
      lotId,
      type: 'VOICE_CALL',
      actorType: 'system',
      payload: { flow: call.flow, status, ...(outcome ?? {}) },
    });
  }
}

/**
 * Sweep (slow lane): calls stuck placing/in_progress past the answer timeout.
 * One retry, then no_answer — SMS already went out unconditionally, so an
 * unanswered call costs the farmer nothing.
 */
export function expireStaleVoiceCalls(now = Date.now()): number {
  const stale = db
    .select()
    .from(voiceCalls)
    .where(inArray(voiceCalls.status, ['placing', 'in_progress']))
    .all()
    .filter((c) => now - (c.lastAttemptAt ?? c.updatedAt) > config.VOICE_ANSWER_TIMEOUT_MS);
  for (const call of stale) {
    if (call.attempts < MAX_CALL_ATTEMPTS) {
      db.update(voiceCalls)
        .set({ status: 'pending', currentNode: null, sessionRef: null, updatedAt: now })
        .where(eq(voiceCalls.id, call.id))
        .run();
    } else {
      finishVoiceCall(call.id, 'no_answer');
    }
  }
  return stale.length;
}
