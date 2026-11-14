import { config } from '../../config';
import { spaceCall, spaceLang } from '../space';

/**
 * Machine translation for the voice listing pipeline (D-038) and catalog
 * drafting: local-language transcript → English for the parser. Two
 * providers: the mock is a passthrough (English demo), and the owner's
 * language Space translates every pair it covers (D-045).
 */
export interface MtProvider {
  readonly name: 'mock' | 'space';
  translate(opts: { text: string; from: string; to: string }): Promise<string>;
}

export class MockMtProvider implements MtProvider {
  readonly name = 'mock' as const;
  async translate(opts: { text: string; from: string; to: string }): Promise<string> {
    return opts.text;
  }
}

/**
 * Translation by the owner's language Space (D-045): the Tɛkyerɛma NLLB models
 * (v3 for every direction, v2 for English → Twi) — the only translator that
 * covers Kusaal, Dagbani and Ewe as well as Twi and Hausa. The Space answers
 * `{translation, covered, engine}`; `covered: false` means it passed the text
 * through untranslated, which must never be mistaken for a translation.
 */
export class SpaceMtProvider implements MtProvider {
  readonly name = 'space' as const;
  constructor(private readonly baseUrl: string = config.SPACE_URL) {}

  async translate(opts: { text: string; from: string; to: string }): Promise<string> {
    if (opts.from === opts.to) return opts.text;
    const src = spaceLang(opts.from);
    const tgt = spaceLang(opts.to);
    const [raw] = await spaceCall('translate', [opts.text, src, tgt], { baseUrl: this.baseUrl });
    let parsed: { translation?: string; covered?: boolean };
    try {
      parsed = JSON.parse(String(raw)) as { translation?: string; covered?: boolean };
    } catch {
      throw new Error('Language Space translate returned something that is not JSON');
    }
    const out = (parsed.translation ?? '').trim();
    if (parsed.covered === false) throw new Error(`The language Space does not translate ${opts.from} → ${opts.to}`);
    if (!out) throw new Error('The language Space returned an empty translation');
    return out;
  }
}

let provider: MtProvider | null = null;

export function getMtProvider(): MtProvider {
  if (!provider) provider = config.MT_PROVIDER === 'space' ? new SpaceMtProvider() : new MockMtProvider();
  return provider;
}

/** Test hook — swap the provider. */
export function setMtProvider(p: MtProvider | null): void {
  provider = p;
}
