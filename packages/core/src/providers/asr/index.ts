import { config } from '../../config';
import { khayaLang } from '../khaya';

/**
 * Speech-to-text for the voice listing pipeline (D-038). The mock returns the
 * hint the wire supplied (the IVR tester types what the farmer "said"); the
 * Khaya AI (GhanaNLP) provider transcribes the recorded audio when keys land.
 */
export interface AsrProvider {
  readonly name: 'mock' | 'khaya' | 'hf' | 'local';
  transcribe(opts: { audioRef?: string | null; hint?: string | null; locale: string }): Promise<string>;
}

export class MockAsrProvider implements AsrProvider {
  readonly name = 'mock' as const;
  async transcribe(opts: { audioRef?: string | null; hint?: string | null; locale: string }): Promise<string> {
    // Offline stand-in: the typed transcript IS the "speech".
    const hint = (opts.hint ?? '').trim();
    // A real recording with nothing typed alongside it means someone pressed
    // Record while ASR is mocked. Returning '' let that surface as the farmer-
    // facing "we could not understand your listing", blaming the speaker for a
    // provider that was never going to listen. Say what actually happened.
    if (!hint && opts.audioRef) {
      throw new Error('ASR_PROVIDER=mock cannot transcribe audio — set ASR_PROVIDER to hf or local to record');
    }
    return hint;
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
 * A .webm recording is routinely labelled video/webm by whatever serves it —
 * the extension carries no track information. Speech endpoints refuse video
 * outright, so state what these actually are: MediaRecorder output with no
 * video track. Anything already audio/* is passed through untouched.
 */
function audioContentType(raw: string | null): string {
  if (!raw) return 'audio/mpeg';
  return raw.startsWith('video/webm') ? raw.replace('video/webm', 'audio/webm') : raw;
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
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': audioContentType(audio.headers.get('content-type')) },
      body: Buffer.from(await audio.arrayBuffer()),
    });
    if (!res.ok) throw new Error(`HF ASR failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { text?: string };
    return (data.text ?? '').trim();
  }
}

/**
 * Open-weight models run in-process by local-models/server.py (D-044) —
 * dedicated Wav2Vec2-BERT checkpoints (KhayaAI/w2v-bert-*, Apache-2.0), the
 * only ASR path that covers Kusaal at all. No API key: the "provider" is a
 * second local process, so failure means the service isn't running rather
 * than a missing credential.
 */
export class LocalAsrProvider implements AsrProvider {
  readonly name = 'local' as const;
  constructor(private readonly baseUrl: string = config.LOCAL_MODELS_URL) {}

  async transcribe(opts: { audioRef?: string | null; hint?: string | null; locale: string }): Promise<string> {
    if (!opts.audioRef) throw new Error('No recording to transcribe');
    const audio = await fetch(opts.audioRef);
    if (!audio.ok) throw new Error(`Recording fetch failed: ${audio.status}`);
    const form = new FormData();
    form.append('locale', opts.locale);
    form.append(
      'audio',
      new Blob([await audio.arrayBuffer()], { type: audioContentType(audio.headers.get('content-type')) }),
      'recording',
    );
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/asr`, { method: 'POST', body: form });
    } catch {
      throw new Error(`Local model service unreachable at ${this.baseUrl} — is 'npm run local-models' running?`);
    }
    if (!res.ok) throw new Error(`Local ASR failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { text?: string };
    return (data.text ?? '').trim();
  }
}

let provider: AsrProvider | null = null;

export function getAsrProvider(): AsrProvider {
  if (!provider) {
    provider =
      config.ASR_PROVIDER === 'khaya'
        ? new KhayaAsrProvider()
        : config.ASR_PROVIDER === 'hf'
          ? new HfAsrProvider()
          : config.ASR_PROVIDER === 'local'
            ? new LocalAsrProvider()
            : new MockAsrProvider();
  }
  return provider;
}

/** Test hook — swap the provider. */
export function setAsrProvider(p: AsrProvider | null): void {
  provider = p;
}
