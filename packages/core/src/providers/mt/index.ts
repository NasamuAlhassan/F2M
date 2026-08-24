import { config } from '../../config';
import { khayaLang, LOCALE_ENGLISH_NAME } from '../khaya';

/**
 * Machine translation for the voice listing pipeline (D-038): local-language
 * transcript → English for the parser. Mock is a passthrough (English demo);
 * Khaya AI (GhanaNLP) translates tw/ee/dag/… when keys land.
 */
export interface MtProvider {
  readonly name: 'mock' | 'khaya' | 'hf';
  translate(opts: { text: string; from: string; to: string }): Promise<string>;
}

export class MockMtProvider implements MtProvider {
  readonly name = 'mock' as const;
  async translate(opts: { text: string; from: string; to: string }): Promise<string> {
    return opts.text;
  }
}

export class KhayaMtProvider implements MtProvider {
  readonly name = 'khaya' as const;
  constructor(private readonly apiKey: string | undefined = config.KHAYA_API_KEY) {}

  async translate(opts: { text: string; from: string; to: string }): Promise<string> {
    if (opts.from === opts.to) return opts.text;
    if (!this.apiKey) throw new Error('KHAYA_API_KEY is not set');
    const lang = `${khayaLang(opts.from)}-${khayaLang(opts.to)}`; // throws for locales Khaya lacks
    const res = await fetch('https://translation-api.ghananlp.org/v1/translate', {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ in: opts.text, lang }),
    });
    if (!res.ok) throw new Error(`Khaya MT failed: ${res.status} ${await res.text()}`);
    // The API may answer a bare JSON string or {translatedText}; never .toString() an object.
    const data = (await res.json()) as unknown;
    return typeof data === 'string' ? data : ((data as { translatedText?: string }).translatedText ?? opts.text);
  }
}

/**
 * Translation by an instruction-following LLM on the HF router (D-041) — the
 * path the HF token verifiably reaches when Khaya's metered API is out of
 * quota. Deterministic (temperature 0), reply-only prompting; numerals (the
 * draft pipeline's placeholder sentinels included) are ordered kept verbatim.
 */
export class HfMtProvider implements MtProvider {
  readonly name = 'hf' as const;
  constructor(
    private readonly token: string | undefined = config.HF_TOKEN,
    private readonly model: string = config.MT_MODEL,
  ) {}

  async translate(opts: { text: string; from: string; to: string }): Promise<string> {
    if (opts.from === opts.to) return opts.text;
    if (!this.token) throw new Error('HF_TOKEN is not set');
    const from = LOCALE_ENGLISH_NAME[opts.from] ?? opts.from;
    const to = LOCALE_ENGLISH_NAME[opts.to] ?? opts.to;
    const res = await fetch('https://router.huggingface.co/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        max_tokens: 512,
        messages: [
          {
            role: 'user',
            content:
              `Translate the following ${from} text to ${to}. It is a short SMS/USSD message from a farm-produce marketplace. ` +
              `Keep every number exactly as written. Reply with ONLY the translation — no quotes, no notes.\n\n${opts.text}`,
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`HF MT failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const out = (data.choices?.[0]?.message?.content ?? '').trim().replace(/^["'“‘]+|["'”’]+$/g, '');
    if (!out) throw new Error('HF MT returned an empty translation');
    return out;
  }
}

let provider: MtProvider | null = null;

export function getMtProvider(): MtProvider {
  if (!provider) {
    provider =
      config.MT_PROVIDER === 'khaya' ? new KhayaMtProvider() : config.MT_PROVIDER === 'hf' ? new HfMtProvider() : new MockMtProvider();
  }
  return provider;
}

/** Test hook — swap the provider. */
export function setMtProvider(p: MtProvider | null): void {
  provider = p;
}
