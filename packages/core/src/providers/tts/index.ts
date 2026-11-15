import { createHash } from 'node:crypto';
import { config } from '../../config';
import { diskStore, getMediaStore, type MediaStore } from '../../storage/index';
import { LOCALE_TO_SPACE, spaceCall, spaceFileUrl, type SpaceFile } from '../space';

/**
 * Text-to-speech for IVR in Ghanaian languages (D-040). The serializer asks
 * for audio per response; a null answer means "no audio — use <Say>", which
 * is both the mock's behavior and every failure path's. A broken TTS must
 * never kill a call, so providers swallow their own errors into null.
 * Synthesized audio is cached on disk by content hash and served statically
 * at /tts/ — a phrase is synthesized once, ever.
 */
export interface TtsProvider {
  readonly name: 'mock' | 'space';
  synthesize(opts: { text: string; locale: string }): Promise<{ url: string } | null>;
  /**
   * True while a clip that missed its wait is still being made (Phase 2): a
   * call can play "one moment" and come back for it instead of falling back
   * to the gateway voice. False for anything that will never arrive.
   */
  isPending?(opts: { text: string; locale: string }): boolean;
}

export class MockTtsProvider implements TtsProvider {
  readonly name = 'mock' as const;
  async synthesize(): Promise<null> {
    return null;
  }
}

/**
 * How long a live call may wait for a clip that is not cached yet. The Space
 * measured 1.4–9 s for a short Twi/Kusaal line (a cold model load is longer);
 * a caller on the line cannot wait that out, so a miss falls back to <Say>
 * while the synthesis keeps going and lands in the cache for the next caller.
 */
const DEFAULT_SPACE_TTS_WAIT_MS = 6000;

/**
 * The owner's language Space as the IVR voice (D-045): Twi, Kusaal, Dagbani,
 * Ewe and Hausa in the owner's own voices. English is deliberately NOT sent
 * here — the Space's English voice is a heavy model with no latency
 * guarantee, and the carrier's own English voice is the safer floor — so
 * `en` answers null (→ <Say>), as does every failure. Audio is WAV, cached
 * on disk by content hash and served at /tts/.
 */
export class SpaceTtsProvider implements TtsProvider {
  readonly name = 'space' as const;
  /** Where clips are cached: the shared media store (Supabase Storage on Vercel), or a test's own folder. */
  private readonly store: MediaStore;
  private readonly keyPrefix: string;
  private readonly baseUrl: string;
  private readonly waitMs: number;
  /** Clip key → the synthesis already running for it, so two callers never double-synthesize one phrase. */
  private readonly inflight = new Map<string, Promise<boolean>>();
  /** Clips known to exist, so a cached clip costs no storage round trip on later calls. */
  private readonly known = new Set<string>();

  constructor(opts?: { baseUrl?: string; cacheDir?: string; waitMs?: number }) {
    this.baseUrl = opts?.baseUrl ?? config.SPACE_URL;
    this.store = opts?.cacheDir ? diskStore(opts.cacheDir) : getMediaStore();
    this.keyPrefix = opts?.cacheDir ? '' : 'tts/';
    this.waitMs = opts?.waitMs ?? DEFAULT_SPACE_TTS_WAIT_MS;
  }

  /** Synthesize and write the clip; resolves true when the file exists. Never rejects. */
  private async produce(text: string, lang: string, file: string): Promise<boolean> {
    try {
      const [result] = await spaceCall('tts', [text, lang], { baseUrl: this.baseUrl });
      const audioUrl = spaceFileUrl((result ?? {}) as SpaceFile, this.baseUrl);
      if (!audioUrl) return false;
      const res = await fetch(audioUrl);
      if (!res.ok) return false;
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length === 0) return false;
      await this.store.put(file, bytes, 'audio/wav');
      this.known.add(file);
      return true;
    } catch {
      return false;
    } finally {
      this.inflight.delete(file);
    }
  }

  private clip(opts: { text: string; locale: string }): { lang: string; file: string; url: string } | null {
    const lang = LOCALE_TO_SPACE[opts.locale];
    if (!lang || opts.locale === 'en') return null;
    const hash = createHash('sha256').update(`space|${lang}|${opts.text}`).digest('hex');
    return {
      lang,
      file: `${this.keyPrefix}${opts.locale}/${hash}.wav`, // the clip's key in the store
      url: this.keyPrefix
        ? this.store.url(`${this.keyPrefix}${opts.locale}/${hash}.wav`, { absolute: true })
        : `${config.PUBLIC_BASE_URL}/tts/${opts.locale}/${hash}.wav`,
    };
  }

  isPending(opts: { text: string; locale: string }): boolean {
    const clip = this.clip(opts);
    return clip !== null && this.inflight.has(clip.file);
  }

  async synthesize(opts: { text: string; locale: string }): Promise<{ url: string } | null> {
    try {
      const clip = this.clip(opts);
      if (!clip) return null;
      const { lang, file, url } = clip;
      if (this.known.has(file) || (await this.store.exists(file))) {
        this.known.add(file);
        return { url };
      }

      let job = this.inflight.get(file);
      if (!job) {
        job = this.produce(opts.text, lang, file);
        this.inflight.set(file, job);
      }
      let timer: NodeJS.Timeout | undefined;
      const ready = await Promise.race([
        job,
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), this.waitMs);
        }),
      ]);
      clearTimeout(timer);
      return ready ? { url } : null;
    } catch {
      return null; // fail open to <Say> — the call goes on
    }
  }
}

let provider: TtsProvider | null = null;

export function getTtsProvider(): TtsProvider {
  if (!provider) provider = config.TTS_PROVIDER === 'space' ? new SpaceTtsProvider() : new MockTtsProvider();
  return provider;
}

/** Test hook — swap the provider. */
export function setTtsProvider(p: TtsProvider | null): void {
  provider = p;
}
