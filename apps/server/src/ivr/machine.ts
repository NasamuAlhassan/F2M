import {
  finishVoiceCall,
  getActiveCallForPhone,
  getVoiceCall,
  markCallInProgress,
  resolveText,
  setCallNode,
  type I18nText,
  type VoiceCall,
} from '@ftm/core';

/**
 * IVR node — the voice twin of UssdScreen (D-027). say() returns i18n
 * {key, params}; the XML serializer below is the only place t() runs (D-012).
 */
export interface IvrCtx {
  call: VoiceCall;
  locale: string;
}

export type IvrResult =
  | { next: string } // prompt again with another node
  | { end: I18nText[]; outcome?: Record<string, unknown> };

export interface IvrNode {
  key: string;
  /** Return lines to say-and-hang-up instead of prompting (flow is moot / terminal). */
  guard?(ctx: IvrCtx): I18nText[] | null;
  say(ctx: IvrCtx): I18nText[] | Promise<I18nText[]>;
  onDigits(digits: string, ctx: IvrCtx): IvrResult | Promise<IvrResult>;
}

export interface IvrFlow {
  entry: string;
  nodes: IvrNode[];
}

const flows = new Map<string, Map<string, IvrNode>>();
const entries = new Map<string, string>();

export function registerFlow(flowName: string, flow: IvrFlow): void {
  flows.set(flowName, new Map(flow.nodes.map((n) => [n.key, n])));
  entries.set(flowName, flow.entry);
}

function xmlEscape(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function sayXml(text: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="woman">${xmlEscape(text)}</Say></Response>`;
}

function gatherXml(text: string, callbackUrl: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?><Response>` +
    `<GetDigits timeout="12" numDigits="1" callbackUrl="${xmlEscape(callbackUrl)}">` +
    `<Say voice="woman">${xmlEscape(text)}</Say>` +
    `</GetDigits></Response>`
  );
}

export interface VoiceAnswerRequest {
  callId?: string; // from our callback URL query
  phone: string; // gateway's callerNumber/phoneNumber
  sessionId: string;
  dtmfDigits?: string;
  callbackUrl: string; // where the gateway should POST the next digits
}

/**
 * Handle one leg of an answered outbound call, Africa's Talking Voice style:
 * first POST has no digits (play the prompt), subsequent POSTs carry dtmfDigits.
 */
export async function handleVoiceAnswer(req: VoiceAnswerRequest): Promise<string> {
  const call = (req.callId ? getVoiceCall(req.callId) : undefined) ?? getActiveCallForPhone(req.phone);
  if (!call || ['completed', 'failed', 'no_answer'].includes(call.status)) {
    return sayXml(resolveText('en', { key: 'voice.common.goodbye' }));
  }

  const flowNodes = flows.get(call.flow);
  const entry = entries.get(call.flow);
  if (!flowNodes || !entry) return sayXml(resolveText(call.locale, { key: 'voice.common.goodbye' }));

  const ctx: IvrCtx = { call, locale: call.locale };

  const promptOrHangup = async (node: IvrNode): Promise<string> => {
    const gate = node.guard?.(ctx);
    if (gate) {
      finishVoiceCall(call.id, 'completed', { result: 'gone' });
      return sayXml(gate.map((l) => resolveText(call.locale, l)).join(' '));
    }
    const text = (await node.say(ctx)).map((l) => resolveText(call.locale, l)).join(' ');
    return gatherXml(text, req.callbackUrl);
  };

  // First leg: answered — mark in progress, play the entry prompt.
  if (call.status !== 'in_progress' || !call.currentNode) {
    markCallInProgress(call.id, req.sessionId);
    setCallNode(call.id, entry);
    return promptOrHangup(flowNodes.get(entry)!);
  }

  const node = flowNodes.get(call.currentNode) ?? flowNodes.get(entry)!;
  if (!req.dtmfDigits) {
    // Gateway re-asked without digits (timeout) — repeat the prompt.
    return promptOrHangup(node);
  }

  const result = await node.onDigits(req.dtmfDigits.trim(), ctx);
  if ('end' in result) {
    finishVoiceCall(call.id, 'completed', { digits: req.dtmfDigits.trim(), ...(result.outcome ?? {}) });
    return sayXml(result.end.map((l) => resolveText(call.locale, l)).join(' '));
  }
  setCallNode(call.id, result.next);
  return promptOrHangup(flowNodes.get(result.next)!);
}
