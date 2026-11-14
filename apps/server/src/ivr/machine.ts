import {
  assistListingDraft,
  finishVoiceCall,
  getActiveCallForPhone,
  getAsrProvider,
  getCallState,
  getMtProvider,
  getVoiceCall,
  markCallInProgress,
  resolveText,
  setCallNode,
  setCallState,
  type I18nText,
  type ListingAssist,
  type VoiceCall,
} from '@ftm/core';
import { holdResponse, promptResponse, sayResponse, type IvrInput } from './xml';

/**
 * IVR node — the voice twin of UssdScreen (D-027). say() returns i18n
 * {key, params}; the XML serializer below is the only place t() runs (D-012).
 *
 * Phase 2 (docs/PHASE2.md): a node says how it listens (`input`), a call
 * keeps memory between answers (`ctx.state`, saved after every step), and the
 * same keys work everywhere — 9 hears it again (`*` on a number step), 0 goes
 * back where a node says where back is.
 */
export interface IvrCtx {
  call: VoiceCall;
  locale: string;
  /** The call's memory between answers. Change it freely; it is saved after each step. */
  state: Record<string, unknown>;
}

/** What the farmer said: the transcript in their language, in English for the parsers, and the recording. */
export interface Heard {
  transcript: string;
  english: string;
  audioRef: string | null;
  /** The language-model assist's reading of a listing sentence (D-056): validated gap-fillers only, absent when it is off. */
  assist?: ListingAssist | null;
}

export type IvrResult =
  | { next: string } // prompt again with another node (or the same one)
  | { end: I18nText[]; outcome?: Record<string, unknown> };

export interface IvrNode {
  key: string;
  /** How this step listens. Default: one key press. */
  input?: IvrInput;
  /** Where 0 goes. Without it, 0 reaches onDigits like any key. */
  back?: string;
  /** This step uses 9 itself (a long menu), so 9 is not "hear again" here. */
  ownsNine?: boolean;
  /** Return lines to say-and-hang-up instead of prompting (flow is moot / terminal). */
  guard?(ctx: IvrCtx): I18nText[] | null;
  say(ctx: IvrCtx): I18nText[] | Promise<I18nText[]>;
  onDigits?(digits: string, ctx: IvrCtx): IvrResult | Promise<IvrResult>;
  /** A recording, already heard and translated; null when it could not be understood at all. */
  onSpeech?(heard: Heard | null, ctx: IvrCtx): IvrResult | Promise<IvrResult>;
}

export interface IvrFlow {
  entry: string;
  nodes: IvrNode[];
}

// One registry for every flow's nodes, so a call can move between them (the
// listing line's menu hands over to the listing and offer steps).
const nodes = new Map<string, IvrNode>();
const entries = new Map<string, string>();

export function registerFlow(flowName: string, flow: IvrFlow): void {
  for (const n of flow.nodes) {
    if (nodes.has(n.key) && nodes.get(n.key) !== n) throw new Error(`IVR node ${n.key} registered twice`);
    nodes.set(n.key, n);
  }
  entries.set(flowName, flow.entry);
}

export interface VoiceAnswerRequest {
  callId?: string; // from our callback URL query
  phone: string; // gateway's callerNumber/phoneNumber
  sessionId: string;
  dtmfDigits?: string;
  /** A recording's URL (real gateway) or the simulator's typed stand-in for one. */
  recordingUrl?: string;
  transcript?: string;
  /** Coming back from a "one moment" hold: replay the step, it is not a missed answer. */
  hold?: boolean;
  /** Where the gateway should POST the next answer, for this call. */
  callbackUrl: (callId: string, extra?: string) => string;
}

/** Silence this many times in a row and the call ends politely. */
const MAX_MISSES = 2;
/** "One moment" at most this many times for one step before the gateway voice reads it. */
const MAX_HOLDS = 2;

/**
 * Hearing a recording (ASR, then MT, in the Space) took 15 s live — longer
 * than a voice gateway waits for an answer. So a recording is heard in the
 * background: the call waits a few seconds, and if the hearing is not done it
 * says "one moment" and comes back for it (D-052). One server holds the work,
 * so an in-memory map is enough; a hearing nobody comes back for is dropped.
 */
const HEARING_WAIT_MS = 4000;
const MAX_HEARING_HOLDS = 6;
const hearings = new Map<string, { node: string; heard: Promise<Heard | null>; holds: number }>();

async function within<T>(p: Promise<T>, ms: number): Promise<{ done: true; value: T } | { done: false }> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<{ done: false }>((resolve) => {
    timer = setTimeout(() => resolve({ done: false }), ms);
  });
  const result = await Promise.race([p.then((value) => ({ done: true as const, value })), timeout]);
  clearTimeout(timer);
  return result;
}

/** The one step where a farmer says the whole listing in a breath — the only answer the language-model assist reads (D-056). */
export const LISTING_INTRO_NODE = 'list_intro';

async function hear(call: VoiceCall, req: VoiceAnswerRequest, nodeKey: string): Promise<Heard | null> {
  try {
    const transcript = (
      await getAsrProvider().transcribe({ audioRef: req.recordingUrl ?? null, hint: req.transcript ?? null, locale: call.locale })
    ).trim();
    if (!transcript) return null;
    const english =
      call.locale === 'en' ? transcript : (await getMtProvider().translate({ text: transcript, from: call.locale, to: 'en' })).trim();
    // Only the first, whole-listing answer — whether the call is a callback ('listing') or came in
    // through the line's menu ('line') — and only while nothing has been understood yet. Every later
    // answer (crop, quantity, price, community) is short and goes to the rules alone. Done here in the
    // background, where the call is already waiting on the hearing.
    const assist =
      nodeKey === LISTING_INTRO_NODE && !getCallState<{ draft?: unknown }>(call).draft ? await assistListingDraft(english).catch(() => null) : null;
    return { transcript, english, audioRef: req.recordingUrl ?? null, assist };
  } catch {
    return null; // an unheard answer is asked again, never guessed
  }
}

/**
 * Handle one leg of a call, Africa's Talking Voice style: the first POST has
 * nothing (play the prompt), later POSTs carry dtmfDigits or a recording.
 */
export async function handleVoiceAnswer(req: VoiceAnswerRequest): Promise<string> {
  const call = (req.callId ? getVoiceCall(req.callId) : undefined) ?? getActiveCallForPhone(req.phone);
  if (!call || ['completed', 'failed', 'no_answer'].includes(call.status)) {
    // No live call → no locale to speak in; English is the only honest choice.
    return sayResponse(resolveText('en', { key: 'voice.common.goodbye' }), 'en');
  }
  const entry = entries.get(call.flow);
  if (!entry || !nodes.has(entry)) return sayResponse(resolveText(call.locale, { key: 'voice.common.goodbye' }), call.locale);

  const ctx: IvrCtx = { call, locale: call.locale, state: getCallState(call) };
  const save = () => setCallState(call.id, ctx.state);
  const speak = (lines: I18nText[]) => lines.map((l) => resolveText(call.locale, l)).join(' ');

  const end = async (lines: I18nText[], outcome: Record<string, unknown>) => {
    save();
    finishVoiceCall(call.id, 'completed', outcome);
    return sayResponse(speak(lines), call.locale);
  };

  const prompt = async (node: IvrNode): Promise<string> => {
    const gate = node.guard?.(ctx);
    if (gate) return end(gate, { result: 'gone' });
    const { xml, pending } = await promptResponse(speak(await node.say(ctx)), call.locale, req.callbackUrl(call.id), node.input);
    const holds = (ctx.state._holds as number | undefined) ?? 0;
    if (pending && holds < MAX_HOLDS) {
      // The farmer's own voice for this step is still being made: a short
      // "one moment" and straight back, rather than a stranger's voice now.
      ctx.state._holds = holds + 1;
      save();
      return holdResponse(speak([{ key: 'voice.common.moment' }]), call.locale, req.callbackUrl(call.id, 'hold=1'));
    }
    ctx.state._holds = 0;
    save();
    return xml;
  };

  const go = async (result: IvrResult): Promise<string> => {
    if ('end' in result) return end(result.end, { ...(req.dtmfDigits ? { digits: req.dtmfDigits.trim() } : {}), ...(result.outcome ?? {}) });
    const next = nodes.get(result.next);
    if (!next) throw new Error(`IVR node ${result.next} is not registered`);
    setCallNode(call.id, next.key);
    return prompt(next);
  };

  // First leg: answered — mark in progress, play the entry prompt.
  if (call.status !== 'in_progress' || !call.currentNode) {
    markCallInProgress(call.id, req.sessionId);
    setCallNode(call.id, entry);
    return prompt(nodes.get(entry)!);
  }

  const node = nodes.get(call.currentNode) ?? nodes.get(entry)!;

  /** A recording has been heard (or given up on): hand it to the step it answers. */
  const answered = async (forNode: IvrNode, heard: Heard | null): Promise<string> => {
    hearings.delete(call.id);
    if (heard) {
      // Keep what was said with the call (vision §5.3): reviewable, and data to improve the models.
      const log = ((ctx.state._heard as Heard[] | undefined) ?? []).slice(-11);
      ctx.state._heard = [...log, { ...heard, node: forNode.key }];
    }
    return go(await forNode.onSpeech!(heard, ctx));
  };

  /** Wait a little for the hearing; if it is still going, "one moment" and come back. */
  const awaitHearing = async (): Promise<string> => {
    const pending = hearings.get(call.id)!;
    const forNode = nodes.get(pending.node)!;
    const result = await within(pending.heard, HEARING_WAIT_MS);
    if (result.done) return answered(forNode, result.value);
    if (pending.holds >= MAX_HEARING_HOLDS) return answered(forNode, null); // asked again, never guessed
    pending.holds += 1;
    return holdResponse(speak([{ key: 'voice.common.moment' }]), call.locale, req.callbackUrl(call.id, 'hold=1'));
  };

  if (req.hold) return hearings.has(call.id) ? awaitHearing() : prompt(node);

  // A recording.
  if (req.recordingUrl || req.transcript !== undefined) {
    ctx.state._misses = 0;
    if (!node.onSpeech) return prompt(node);
    hearings.set(call.id, { node: node.key, heard: hear(call, req, node.key), holds: 0 });
    return awaitHearing();
  }

  const digits = req.dtmfDigits?.trim() ?? '';
  if (!digits) {
    // The gateway asked again with nothing pressed (a timeout).
    const misses = ((ctx.state._misses as number | undefined) ?? 0) + 1;
    ctx.state._misses = misses;
    if (misses > MAX_MISSES) return end([{ key: 'voice.common.noAnswer' }], { result: 'silent' });
    return prompt(node);
  }
  ctx.state._misses = 0;

  const input = node.input ?? 'key';
  const isNumberStep = input === 'number' || input === 'numberOrSpeech';
  if (isNumberStep ? digits === '*' : digits === '9' && !node.ownsNine) return prompt(node);
  if (!isNumberStep && digits === '0' && node.back) return go({ next: node.back });
  if (!node.onDigits) return prompt(node);
  return go(await node.onDigits(digits, ctx));
}
