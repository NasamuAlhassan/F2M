import { config } from '../../config';
import { khayaLang } from '../khaya';

/**
 * Machine translation for the voice listing pipeline (D-038): local-language
 * transcript → English for the parser. Mock is a passthrough (English demo);
 * Khaya AI (GhanaNLP) translates tw/ee/dag/… when keys land.
 */
export interface MtProvider {
  readonly name: 'mock' | 'khaya';
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

let provider: MtProvider | null = null;

export function getMtProvider(): MtProvider {
  if (!provider) provider = config.MT_PROVIDER === 'khaya' ? new KhayaMtProvider() : new MockMtProvider();
  return provider;
}

/** Test hook — swap the provider. */
export function setMtProvider(p: MtProvider | null): void {
  provider = p;
}
