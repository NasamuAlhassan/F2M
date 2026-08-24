import { config } from '../../config';

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
  async transcribe(opts: { audioRef?: string | null; hint?: string | null; locale: string }): Promise<string> {
    if (!config.KHAYA_API_KEY) throw new Error('KHAYA_API_KEY is not set');
    if (!opts.audioRef) throw new Error('No recording to transcribe');
    // GhanaNLP Khaya ASR: POST the audio for the caller's language.
    const audio = await fetch(opts.audioRef);
    if (!audio.ok) throw new Error(`Recording fetch failed: ${audio.status}`);
    const res = await fetch(`https://translation-api.ghananlp.org/asr/v1/transcribe?language=${opts.locale}`, {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': config.KHAYA_API_KEY, 'Content-Type': 'audio/mpeg' },
      body: Buffer.from(await audio.arrayBuffer()),
    });
    if (!res.ok) throw new Error(`Khaya ASR failed: ${res.status} ${await res.text()}`);
    return ((await res.json()) as string | { text?: string })?.toString() ?? '';
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
