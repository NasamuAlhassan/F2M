import { config } from '../../config';
import { khayaLang } from '../khaya';

/**
 * Speech-to-text for the voice listing pipeline (D-038). The mock returns the
 * hint the wire supplied (the IVR tester types what the farmer "said"); the
 * Khaya AI (GhanaNLP) provider transcribes the recorded audio when keys land.
 */
export interface AsrProvider {
  readonly name: 'mock' | 'khaya';
  transcribe(opts: { audioRef?: string | null; hint?: string | null; locale: string }): Promise<string>;
}

export class MockAsrProvider implements AsrProvider {
  readonly name = 'mock' as const;
  async transcribe(opts: { audioRef?: string | null; hint?: string | null; locale: string }): Promise<string> {
    // Offline stand-in: the typed transcript IS the "speech".
    return (opts.hint ?? '').trim();
  }
}

export class KhayaAsrProvider implements AsrProvider {
  readonly name = 'khaya' as const;
  constructor(private readonly apiKey: string | undefined = config.KHAYA_API_KEY) {}

  async transcribe(opts: { audioRef?: string | null; hint?: string | null; locale: string }): Promise<string> {
    if (!this.apiKey) throw new Error('KHAYA_API_KEY is not set');
    if (!opts.audioRef) throw new Error('No recording to transcribe');
    const language = khayaLang(opts.locale); // throws for locales Khaya lacks — an honest failure upstream
    const audio = await fetch(opts.audioRef);
    if (!audio.ok) throw new Error(`Recording fetch failed: ${audio.status}`);
    const res = await fetch(`https://translation-api.ghananlp.org/asr/v1/transcribe?language=${language}`, {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': this.apiKey, 'Content-Type': 'audio/mpeg' },
      body: Buffer.from(await audio.arrayBuffer()),
    });
    if (!res.ok) throw new Error(`Khaya ASR failed: ${res.status} ${await res.text()}`);
    // The API may answer a bare JSON string or {text}; never .toString() an object.
    const data = (await res.json()) as unknown;
    return typeof data === 'string' ? data : ((data as { text?: string }).text ?? '');
  }
}

let provider: AsrProvider | null = null;

export function getAsrProvider(): AsrProvider {
  if (!provider) provider = config.ASR_PROVIDER === 'khaya' ? new KhayaAsrProvider() : new MockAsrProvider();
  return provider;
}

/** Test hook — swap the provider. */
export function setAsrProvider(p: AsrProvider | null): void {
  provider = p;
}
