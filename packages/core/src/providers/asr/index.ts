import { config } from '../../config';
import { spaceCall, spaceLang } from '../space';

/**
 * Speech-to-text for the voice listing pipeline (D-038). Two providers:
 * the mock returns the transcript the wire supplied (the simulator types what
 * the farmer "said"), and the owner's language Space hears real recordings
 * (D-045).
 */
export interface AsrProvider {
  readonly name: 'mock' | 'space';
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
      throw new Error('ASR_PROVIDER=mock cannot transcribe audio — set ASR_PROVIDER=space to record');
    }
    return hint;
  }
}

/** WebM/Matroska files start with the EBML magic number; libsndfile (which the Space reads audio with) cannot open them. */
function looksLikeWebm(bytes: Buffer): boolean {
  return bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
}

/**
 * The owner's own language Space (D-045): recognisers fine-tuned for Twi, Ewe,
 * Kusaal and Dagbani, MMS for Hausa and Whisper for Ghanaian English, behind
 * one public endpoint. The recording goes up as base64. The Space reads audio
 * with libsndfile, so WAV/FLAC/Ogg/MP3 work (a carrier's recording URL is
 * typically MP3 or WAV) but a browser's WebM does not — the handset
 * simulator therefore encodes WAV itself — and a WebM that slips through gets
 * a plain error instead of a model's confusing decode failure.
 */
export class SpaceAsrProvider implements AsrProvider {
  readonly name = 'space' as const;
  constructor(private readonly baseUrl: string = config.SPACE_URL) {}

  async transcribe(opts: { audioRef?: string | null; hint?: string | null; locale: string }): Promise<string> {
    if (!opts.audioRef) throw new Error('No recording to transcribe');
    const lang = spaceLang(opts.locale); // throws for locales the Space lacks — an honest failure upstream
    const audio = await fetch(opts.audioRef);
    if (!audio.ok) throw new Error(`Recording fetch failed: ${audio.status}`);
    const bytes = Buffer.from(await audio.arrayBuffer());
    if (looksLikeWebm(bytes)) {
      throw new Error('The language Space cannot read WebM recordings — send WAV (the handset simulator converts automatically)');
    }
    const [text] = await spaceCall('asr_b64', [bytes.toString('base64'), lang], { baseUrl: this.baseUrl });
    return typeof text === 'string' ? text.trim() : '';
  }
}

let provider: AsrProvider | null = null;

export function getAsrProvider(): AsrProvider {
  if (!provider) provider = config.ASR_PROVIDER === 'space' ? new SpaceAsrProvider() : new MockAsrProvider();
  return provider;
}

/** Test hook — swap the provider. */
export function setAsrProvider(p: AsrProvider | null): void {
  provider = p;
}
