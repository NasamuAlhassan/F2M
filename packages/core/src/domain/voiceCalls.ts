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
  flow: 'offer' | 'grade' | 'bridge' | 'bid' | 'listing' | 'claim';
  contractId?: string;
  /** The 'bid' flow (Phase 1): the offer thread whose proposal the call reads out. */
  offerId?: string;
}

/** Queue an outbound IVR call. Deduped: one active call per (phone, flow, contract or offer). */
export async function queueVoiceCall(input: QueueVoiceCallInput): Promise<VoiceCall> {
  const existing = (await db
      .select()
      .from(voiceCalls)
      .where(
        and(
          eq(voiceCalls.phone, input.phone),
          eq(voiceCalls.flow, input.flow),
          inArray(voiceCalls.status, [...ACTIVE_STATUSES]),
        ),
      ))
    .find((c) => c.contractId === (input.contractId ?? null) && c.offerId === (input.offerId ?? null));
  if (existing) return existing;

  return (await db
        .insert(voiceCalls)
        .values({
          phone: input.phone,
          locale: input.locale,
          flow: input.flow,
          contractId: input.contractId ?? null,
          offerId: input.offerId ?? null,
        })
        .returning())[0]!;
}

export async function getVoiceCall(id: string): Promise<VoiceCall | undefined> {
  return (await db.select().from(voiceCalls).where(eq(voiceCalls.id, id)))[0];
}

/** The call a gateway callback without a callId belongs to: latest live call for the phone. */
export async function getActiveCallForPhone(phone: string): Promise<VoiceCall | undefined> {
  return (await db
      .select()
      .from(voiceCalls)
      .where(and(eq(voiceCalls.phone, phone), inArray(voiceCalls.status, ['placing', 'in_progress'])))
      .orderBy(desc(voiceCalls.createdAt)))[0];
}

export async function listVoiceCallsForPhone(phone: string, limit = 10): Promise<VoiceCall[]> {
  return (await db
      .select()
      .from(voiceCalls)
      .where(eq(voiceCalls.phone, phone))
      .orderBy(desc(voiceCalls.createdAt)))
    .slice(0, limit);
}

/** Sweep (fast lane): place pending calls via the configured provider. */
export async function placePendingVoiceCalls(): Promise<number> {
  const provider = getVoiceProvider();
  const pending = (await db.select().from(voiceCalls).where(eq(voiceCalls.status, 'pending')));
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
        (await db.update(voiceCalls)
                    .set({
                      status: 'placing',
                      providerRef: result.providerRef ?? null,
                      attempts: call.attempts + 1,
                      lastAttemptAt: now,
                      updatedAt: now,
                    })
                    .where(eq(voiceCalls.id, call.id)));
        placed += 1;
      } else {
        await failOrRetry(call, now, JSON.stringify(result.raw ?? null));
      }
    } catch (err) {
      await failOrRetry(call, now, String(err));
    }
  }
  return placed;
}

async function failOrRetry(call: VoiceCall, now: number, raw: string): Promise<void> {
  const attempts = call.attempts + 1;
  (await db.update(voiceCalls)
        .set({
          status: attempts >= MAX_CALL_ATTEMPTS ? 'failed' : 'pending',
          attempts,
          outcome: raw,
          lastAttemptAt: now,
          updatedAt: now,
        })
        .where(eq(voiceCalls.id, call.id)));
}

export async function markCallInProgress(callId: string, sessionRef: string): Promise<void> {
  (await db.update(voiceCalls)
        .set({ status: 'in_progress', sessionRef, updatedAt: Date.now() })
        .where(eq(voiceCalls.id, callId)));
}

export async function setCallNode(callId: string, node: string): Promise<void> {
  (await db.update(voiceCalls).set({ currentNode: node, updatedAt: Date.now() }).where(eq(voiceCalls.id, callId)));
}

/**
 * A farmer calling the listing line (Phase 2) gets a call row like the calls
 * F2M places, so a call to the line can also go over several questions and
 * answers. It starts in progress: the farmer is already on the line.
 */
export async function startInboundCall(input: { phone: string; locale: string; sessionRef: string }): Promise<VoiceCall> {
  return (await db
        .insert(voiceCalls)
        .values({ phone: input.phone, locale: input.locale, flow: 'line', direction: 'inbound', status: 'in_progress', sessionRef: input.sessionRef, attempts: 1 })
        .returning())[0]!;
}

/** The live inbound call for a gateway session, if the farmer is still on it. */
export async function getInboundCallForSession(sessionRef: string): Promise<VoiceCall | undefined> {
  if (!sessionRef) return undefined;
  return (await db
      .select()
      .from(voiceCalls)
      .where(and(eq(voiceCalls.sessionRef, sessionRef), eq(voiceCalls.direction, 'inbound'), eq(voiceCalls.status, 'in_progress'))))[0];
}

/** The call's memory between answers (Phase 2). */
export function getCallState<T extends Record<string, unknown> = Record<string, unknown>>(call: VoiceCall): T {
  try {
    return (call.state ? JSON.parse(call.state) : {}) as T;
  } catch {
    return {} as T;
  }
}

export async function setCallState(callId: string, state: Record<string, unknown>): Promise<void> {
  (await db.update(voiceCalls).set({ state: JSON.stringify(state), updatedAt: Date.now() }).where(eq(voiceCalls.id, callId)));
}

/** Terminal call outcome + a VOICE_CALL trace event on the lot it was about. */
export async function finishVoiceCall(callId: string, status: 'completed' | 'no_answer' | 'failed', outcome?: Record<string, unknown>): Promise<void> {
  const call = await getVoiceCall(callId);
  if (!call) return;
  (await db.update(voiceCalls)
        .set({ status, outcome: outcome ? JSON.stringify(outcome) : call.outcome, updatedAt: Date.now() })
        .where(eq(voiceCalls.id, callId)));
  // The call belongs to a contract's lot, or (Phase 1 bid calls, which ring
  // before any contract exists) to the lot the offer is about.
  const lotId = call.contractId
    ? (await db.select().from(contracts).where(eq(contracts.id, call.contractId)))[0]?.lotId
    : call.offerId
      ? (await db.select().from(offers).where(eq(offers.id, call.offerId)))[0]?.lotId
      : undefined;
  if (lotId) {
    await appendLotEvent(db, {
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
export async function expireStaleVoiceCalls(now = Date.now()): Promise<number> {
  const stale = (await db
      .select()
      .from(voiceCalls)
      .where(inArray(voiceCalls.status, ['placing', 'in_progress'])))
    // An answered call is stale when its last step is old, not its dialling:
    // a guided listing (Phase 2) can run for minutes.
    .filter((c) => now - (c.status === 'in_progress' ? c.updatedAt : (c.lastAttemptAt ?? c.updatedAt)) > config.VOICE_ANSWER_TIMEOUT_MS);
  for (const call of stale) {
    if (call.status === 'in_progress') {
      // The farmer answered (or called the line) and then went quiet or hung
      // up. Ringing them again would be a stranger's call out of nowhere;
      // whatever they were doing waits for them on USSD and the SMS.
      await finishVoiceCall(call.id, 'completed', { result: 'hung_up', node: call.currentNode });
    } else if (call.attempts < MAX_CALL_ATTEMPTS) {
      (await db.update(voiceCalls)
                .set({ status: 'pending', currentNode: null, sessionRef: null, updatedAt: now })
                .where(eq(voiceCalls.id, call.id)));
    } else {
      await finishVoiceCall(call.id, 'no_answer');
    }
  }
  return stale.length;
}
