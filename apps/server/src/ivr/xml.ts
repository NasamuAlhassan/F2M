import { getTtsProvider, speechLocale } from '@ftm/core';

/**
 * The one place voice-response XML is built (deduplicates the old per-file
 * sayXml copies). Each response asks the TTS provider for audio in the
 * caller's SPEECH locale — the locale the gate actually resolved text in
 * (D-040), so English fallback text is never read by a Twi voice. Audio →
 * <Play>; no audio (mock provider, or any TTS failure) → the English
 * gateway voice via <Say>, and the call goes on.
 */
export function xmlEscape(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

const HEAD = `<?xml version="1.0" encoding="UTF-8"?><Response>`;

/** The spoken part, and whether the farmer's own voice for it is still being made (Phase 2 hold). */
async function speech(text: string, locale: string): Promise<{ xml: string; pending: boolean }> {
  const tts = getTtsProvider();
  const opts = { text, locale: speechLocale(locale) };
  const audio = await tts.synthesize(opts).catch(() => null);
  if (audio) return { xml: `<Play url="${xmlEscape(audio.url)}"/>`, pending: false };
  return { xml: `<Say voice="woman">${xmlEscape(text)}</Say>`, pending: tts.isPending?.(opts) ?? false };
}

export async function sayResponse(text: string, locale: string): Promise<string> {
  return `${HEAD}${(await speech(text, locale)).xml}</Response>`;
}

/**
 * How a step listens (Phase 2, docs/PHASE2.md):
 * - `key`: one key press (menus);
 * - `number`: digits ended by # (quantities, prices) — `*` alone means "again";
 * - `speech`: a recording after the beep;
 * - `numberOrSpeech`: type it and press #, or wait and say it. The gateway runs
 *   the actions in order, so a GetDigits that times out falls through to Record.
 */
export type IvrInput = 'key' | 'number' | 'speech' | 'numberOrSpeech';

const RECORD = (cb: string) =>
  `<Record finishOnKey="#" maxLength="30" trimSilence="true" playBeep="true" callbackUrl="${xmlEscape(cb)}"/>`;

export async function promptResponse(
  text: string,
  locale: string,
  callbackUrl: string,
  input: IvrInput = 'key',
): Promise<{ xml: string; pending: boolean }> {
  const { xml: spoken, pending } = await speech(text, locale);
  const cb = xmlEscape(callbackUrl);
  let body: string;
  switch (input) {
    case 'key':
      body = `<GetDigits timeout="12" numDigits="1" callbackUrl="${cb}">${spoken}</GetDigits>`;
      break;
    case 'number':
      body = `<GetDigits timeout="20" finishOnKey="#" callbackUrl="${cb}">${spoken}</GetDigits>`;
      break;
    case 'speech':
      body = `${spoken}${RECORD(callbackUrl)}`;
      break;
    case 'numberOrSpeech':
      body = `<GetDigits timeout="8" finishOnKey="#" callbackUrl="${cb}">${spoken}</GetDigits>${RECORD(callbackUrl)}`;
      break;
  }
  return { xml: `${HEAD}${body}</Response>`, pending };
}

/** "One moment" while the farmer's own voice for the next step is made, then straight back (Phase 2). */
export async function holdResponse(text: string, locale: string, redirectUrl: string): Promise<string> {
  return `${HEAD}${(await speech(text, locale)).xml}<Redirect>${xmlEscape(redirectUrl)}</Redirect></Response>`;
}

/** Kept for existing callers: one key press. */
export async function gatherResponse(text: string, locale: string, callbackUrl: string): Promise<string> {
  return (await promptResponse(text, locale, callbackUrl, 'key')).xml;
}

export async function recordResponse(prompt: string, locale: string, callbackUrl: string): Promise<string> {
  // The open listing line's one long answer keeps its 90 seconds.
  return `${HEAD}${(await speech(prompt, locale)).xml}${RECORD(callbackUrl).replace('maxLength="30"', 'maxLength="90"')}</Response>`;
}
