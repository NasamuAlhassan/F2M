import { config } from '../../config';

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
  async translate(opts: { text: string; from: string; to: string }): Promise<string> {
    if (opts.from === opts.to) return opts.text;
    if (!config.KHAYA_API_KEY) throw new Error('KHAYA_API_KEY is not set');
    const res = await fetch('https://translation-api.ghananlp.org/v1/translate', {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': config.KHAYA_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ in: opts.text, lang: `${opts.from}-${opts.to}` }),
    });
    if (!res.ok) throw new Error(`Khaya MT failed: ${res.status} ${await res.text()}`);
    return ((await res.json()) as string | { translatedText?: string })?.toString() ?? opts.text;
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
