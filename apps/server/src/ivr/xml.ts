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

async function speech(text: string, locale: string): Promise<string> {
  const audio = await getTtsProvider()
    .synthesize({ text, locale: speechLocale(locale) })
    .catch(() => null);
  return audio ? `<Play url="${xmlEscape(audio.url)}"/>` : `<Say voice="woman">${xmlEscape(text)}</Say>`;
}

export async function sayResponse(text: string, locale: string): Promise<string> {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${await speech(text, locale)}</Response>`;
}

export async function gatherResponse(text: string, locale: string, callbackUrl: string): Promise<string> {
  return (
    `<?xml version="1.0" encoding="UTF-8"?><Response>` +
    `<GetDigits timeout="12" numDigits="1" callbackUrl="${xmlEscape(callbackUrl)}">` +
    (await speech(text, locale)) +
    `</GetDigits></Response>`
  );
}

export async function recordResponse(prompt: string, locale: string, callbackUrl: string): Promise<string> {
  return (
    `<?xml version="1.0" encoding="UTF-8"?><Response>` +
    (await speech(prompt, locale)) +
    `<Record finishOnKey="#" maxLength="90" trimSilence="true" playBeep="true" callbackUrl="${xmlEscape(callbackUrl)}"/>` +
    `</Response>`
  );
}
