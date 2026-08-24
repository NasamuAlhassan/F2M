import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config';
import { LOCALE_TO_KHAYA, khayaLang } from '../khaya';

/**
 * Text-to-speech for IVR in Ghanaian languages (D-040). The serializer asks
 * for audio per response; a null answer means "no audio — use <Say>", which
 * is both the mock's behavior and every failure path's. A broken TTS must
 * never kill a call, so the Khaya provider swallows its own errors into null.
 * Synthesized audio is cached on disk by content hash and served statically
 * at /tts/ — a phrase is synthesized once, ever.
 */
export interface TtsProvider {
  readonly name: 'mock' | 'khaya';
  synthesize(opts: { text: string; locale: string }): Promise<{ url: string } | null>;
}

export class MockTtsProvider implements TtsProvider {
  readonly name = 'mock' as const;
  async synthesize(): Promise<null> {
    return null;
  }
}

// Confirmed against GhanaNLP docs during live verification (step 10).
const KHAYA_TTS_URL = 'https://translation-api.ghananlp.org/tts/v1/synthesize';

export class KhayaTtsProvider implements TtsProvider {
  readonly name = 'khaya' as const;
  private readonly apiKey: string | undefined;
  private readonly cacheDir: string;

  constructor(opts?: { apiKey?: string; cacheDir?: string }) {
    this.apiKey = opts?.apiKey ?? config.KHAYA_API_KEY;
    this.cacheDir = opts?.cacheDir ?? path.join(config.storageDir, 'tts');
  }

  async synthesize(opts: { text: string; locale: string }): Promise<{ url: string } | null> {
    try {
      if (!this.apiKey || !LOCALE_TO_KHAYA[opts.locale]) return null;
      const language = khayaLang(opts.locale);
      const hash = createHash('sha256').update(`${language}|${opts.text}`).digest('hex');
      const dir = path.join(this.cacheDir, opts.locale);
      const file = path.join(dir, `${hash}.mp3`);
      const url = `${config.PUBLIC_BASE_URL}/tts/${opts.locale}/${hash}.mp3`;
      if (fs.existsSync(file)) return { url };

      const res = await fetch(KHAYA_TTS_URL, {
        method: 'POST',
        headers: { 'Ocp-Apim-Subscription-Key': this.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: opts.text, language }),
      });
      if (!res.ok) return null;
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length === 0) return null;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, bytes);
      return { url };
    } catch {
      return null; // fail open to <Say> — the call goes on
    }
  }
}

let provider: TtsProvider | null = null;

export function getTtsProvider(): TtsProvider {
  if (!provider) provider = config.TTS_PROVIDER === 'khaya' ? new KhayaTtsProvider() : new MockTtsProvider();
  return provider;
}

/** Test hook — swap the provider. */
export function setTtsProvider(p: TtsProvider | null): void {
  provider = p;
}
