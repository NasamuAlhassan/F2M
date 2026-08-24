import { config } from '../../config';
import { khayaLang } from '../khaya';

/**
 * Speech-to-text for the voice listing pipeline (D-038). The mock returns the
 * hint the wire supplied (the IVR tester types what the farmer "said"); the
 * Khaya AI (GhanaNLP) provider transcribes the recorded audio when keys land.
 */
export interface AsrProvider {
  readonly name: 'mock' | 'khaya' | 'hf';
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

/**
 * Whisper on hf-inference (D-041): the transcription path the HF token
 * verifiably reaches. Strong for English calls; Ghanaian-language speech is
 * beyond stock Whisper — the pipeline's honest-failure SMS covers the gap
 * until a Ghanaian ASR model lands on an HF provider (or Khaya quota returns).
 */
export class HfAsrProvider implements AsrProvider {
  readonly name = 'hf' as const;
  constructor(
    private readonly token: string | undefined = config.HF_TOKEN,
    private readonly model: string = config.ASR_MODEL,
  ) {}

  async transcribe(opts: { audioRef?: string | null; hint?: string | null; locale: string }): Promise<string> {
    if (!this.token) throw new Error('HF_TOKEN is not set');
    if (!opts.audioRef) throw new Error('No recording to transcribe');
    const audio = await fetch(opts.audioRef);
    if (!audio.ok) throw new Error(`Recording fetch failed: ${audio.status}`);
    const res = await fetch(`https://router.huggingface.co/hf-inference/models/${this.model}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': audio.headers.get('content-type') ?? 'audio/mpeg' },
      body: Buffer.from(await audio.arrayBuffer()),
    });
    if (!res.ok) throw new Error(`HF ASR failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { text?: string };
    return (data.text ?? '').trim();
  }
}

let provider: AsrProvider | null = null;

export function getAsrProvider(): AsrProvider {
  if (!provider) {
    provider =
      config.ASR_PROVIDER === 'khaya' ? new KhayaAsrProvider() : config.ASR_PROVIDER === 'hf' ? new HfAsrProvider() : new MockAsrProvider();
  }
  return provider;
}

/** Test hook — swap the provider. */
export function setAsrProvider(p: AsrProvider | null): void {
  provider = p;
}
