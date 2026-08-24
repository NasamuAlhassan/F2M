import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KhayaTtsProvider, MockTtsProvider } from './index';

function audioOk(bytes = 16) {
  return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(bytes) };
}

describe('TTS providers', () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ftm-tts-'));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it('mock always answers null (→ <Say> fallback)', async () => {
    expect(await new MockTtsProvider().synthesize()).toBeNull();
  });

  it('khaya synthesizes, caches to disk, and serves the same URL from cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue(audioOk());
    vi.stubGlobal('fetch', fetchMock);
    const tts = new KhayaTtsProvider({ apiKey: 'k', cacheDir });

    const first = await tts.synthesize({ text: 'Maakye', locale: 'tw' });
    expect(first?.url).toMatch(/\/tts\/tw\/[0-9a-f]{64}\.mp3$/);
    const files = fs.readdirSync(path.join(cacheDir, 'tw'));
    expect(files).toHaveLength(1);

    const second = await tts.synthesize({ text: 'Maakye', locale: 'tw' });
    expect(second?.url).toBe(first?.url);
    expect(fetchMock).toHaveBeenCalledTimes(1); // cache hit — no second synthesis
  });

  it('fails open to null: unmapped locale, missing key, HTTP error, empty audio', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0) });
    vi.stubGlobal('fetch', fetchMock);
    expect(await new KhayaTtsProvider({ apiKey: 'k', cacheDir }).synthesize({ text: 'x', locale: 'kus' })).toBeNull();
    expect(await new KhayaTtsProvider({ apiKey: undefined, cacheDir }).synthesize({ text: 'x', locale: 'tw' })).toBeNull();
    expect(await new KhayaTtsProvider({ apiKey: 'k', cacheDir }).synthesize({ text: 'x', locale: 'tw' })).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(audioOk(0)));
    expect(await new KhayaTtsProvider({ apiKey: 'k', cacheDir }).synthesize({ text: 'y', locale: 'tw' })).toBeNull();
  });
});
