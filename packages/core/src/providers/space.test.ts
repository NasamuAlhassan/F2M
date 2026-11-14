import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpaceAsrProvider } from './asr/index';
import { SpaceMtProvider } from './mt/index';
import { spaceCall, spaceLang } from './space';
import { SpaceTtsProvider } from './tts/index';

const BASE = 'https://space.test';

/** A Gradio reply: the POST that returns an event id, then the SSE stream that carries the result. */
function gradio(result: unknown, event = 'complete') {
  return [
    { ok: true, status: 200, json: async () => ({ event_id: 'ev1' }), text: async () => '' },
    {
      ok: true,
      status: 200,
      text: async () => `event: heartbeat\ndata: null\n\nevent: ${event}\ndata: ${JSON.stringify(result)}\n\n`,
    },
  ];
}
function stubFetch(...replies: unknown[]) {
  const fn = vi.fn();
  for (const r of replies) fn.mockResolvedValueOnce(r);
  vi.stubGlobal('fetch', fn);
  return fn;
}
function audioResponse(bytes: number[] = [1, 2, 3, 4, 5, 6, 7, 8], type = 'audio/wav') {
  return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array(bytes).buffer, headers: new Headers({ 'content-type': type }) };
}

describe('Space client (D-045)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('maps F2M locales to the Space and refuses unknown ones', () => {
    expect(spaceLang('en')).toBe('eng');
    expect(spaceLang('tw')).toBe('twi');
    expect(spaceLang('ee')).toBe('ewe');
    expect(spaceLang('ha')).toBe('hau');
    expect(spaceLang('dag')).toBe('dag');
    expect(spaceLang('kus')).toBe('kus');
    expect(() => spaceLang('gaa')).toThrow(/no language code/);
  });

  it('posts {data:[...]} then reads the completed event from the stream', async () => {
    const fetchMock = stubFetch(...gradio(['hello']));
    const out = await spaceCall('translate', ['a', 'eng', 'twi'], { baseUrl: `${BASE}/` });
    expect(out).toEqual(['hello']);
    expect(fetchMock.mock.calls[0]![0]).toBe(`${BASE}/gradio_api/call/translate`);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toEqual({ data: ['a', 'eng', 'twi'] });
    expect(fetchMock.mock.calls[1]![0]).toBe(`${BASE}/gradio_api/call/translate/ev1`);
  });

  it('retries once when the connection drops, then succeeds — but not on a timeout or the Space’s own error', async () => {
    const reset = Object.assign(new TypeError('fetch failed'), { cause: new Error('read ECONNRESET') });
    const [start, events] = gradio(['ok']);
    const fetchMock = vi.fn().mockRejectedValueOnce(reset).mockResolvedValueOnce(start).mockResolvedValueOnce(events);
    vi.stubGlobal('fetch', fetchMock);
    expect(await spaceCall('health', [], { baseUrl: BASE })).toEqual(['ok']);
    expect(fetchMock).toHaveBeenCalledTimes(3); // reset, then a clean second attempt

    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    const slow = vi.fn().mockRejectedValue(timeout);
    vi.stubGlobal('fetch', slow);
    await expect(spaceCall('health', [], { baseUrl: BASE })).rejects.toThrow(/unreachable/);
    expect(slow).toHaveBeenCalledTimes(1); // a timeout already spent its budget — no second try

    const refused = stubFetch(...gradio('asr: bad audio', 'error'));
    await expect(spaceCall('asr_b64', [], { baseUrl: BASE })).rejects.toThrow(/asr: bad audio/);
    expect(refused).toHaveBeenCalledTimes(2); // the Space answered — an error reply is final, not retried
  });

  it('turns an unreachable Space, a non-2xx, a missing event id and an error event into readable errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ENOTFOUND')));
    await expect(spaceCall('health', [], { baseUrl: BASE })).rejects.toThrow(/unreachable.*ENOTFOUND/);

    stubFetch({ ok: false, status: 503, text: async () => 'sleeping' });
    await expect(spaceCall('health', [], { baseUrl: BASE })).rejects.toThrow(/failed to start: 503/);

    stubFetch({ ok: true, status: 200, json: async () => ({}), text: async () => '' });
    await expect(spaceCall('health', [], { baseUrl: BASE })).rejects.toThrow(/no event id/);

    stubFetch(...gradio('asr: the recording is empty or too long.', 'error'));
    await expect(spaceCall('asr_b64', ['', 'twi'], { baseUrl: BASE })).rejects.toThrow(/error: asr: the recording is empty/);
  });
});

describe('SpaceAsrProvider (D-045)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends the recording as base64 with the Space language code and returns trimmed text', async () => {
    const wav = [0x52, 0x49, 0x46, 0x46, 9, 9, 9, 9]; // "RIFF…"
    const fetchMock = stubFetch(audioResponse(wav), ...gradio([' mewɔ aburo nkotoku du ']));
    const out = await new SpaceAsrProvider(BASE).transcribe({ audioRef: 'http://gw/rec.wav', locale: 'tw' });
    expect(out).toBe('mewɔ aburo nkotoku du');
    expect(fetchMock.mock.calls[1]![0]).toBe(`${BASE}/gradio_api/call/asr_b64`);
    const body = JSON.parse(fetchMock.mock.calls[1]![1].body as string) as { data: [string, string] };
    expect(Buffer.from(body.data[0], 'base64')).toEqual(Buffer.from(wav));
    expect(body.data[1]).toBe('twi');
  });

  it('refuses a missing recording, an unsupported locale and a WebM clip before calling the Space', async () => {
    await expect(new SpaceAsrProvider(BASE).transcribe({ audioRef: null, locale: 'tw' })).rejects.toThrow(/No recording/);
    await expect(new SpaceAsrProvider(BASE).transcribe({ audioRef: 'http://gw/r.wav', locale: 'gaa' })).rejects.toThrow(/no language code/);

    const fetchMock = stubFetch(audioResponse([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4], 'audio/webm'));
    await expect(new SpaceAsrProvider(BASE).transcribe({ audioRef: 'http://gw/r.webm', locale: 'kus' })).rejects.toThrow(/cannot read WebM/);
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the recording fetch — nothing was sent to the Space
  });
});

describe('SpaceMtProvider (D-045)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('translates with the Space codes and parses the JSON answer', async () => {
    const fetchMock = stubFetch(...gradio([JSON.stringify({ translation: ' I have ten bags ', covered: true, engine: 'nllb600m-v3' })]));
    const out = await new SpaceMtProvider(BASE).translate({ text: 'Mɔr bʋnkɔnb', from: 'kus', to: 'en' });
    expect(out).toBe('I have ten bags');
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toEqual({ data: ['Mɔr bʋnkɔnb', 'kus', 'eng'] });
  });

  it('short-circuits same-locale; rejects uncovered pairs, empty output and unknown locales', async () => {
    const fetchMock = stubFetch();
    expect(await new SpaceMtProvider(BASE).translate({ text: 'same', from: 'en', to: 'en' })).toBe('same');
    expect(fetchMock).not.toHaveBeenCalled();

    stubFetch(...gradio([JSON.stringify({ translation: 'x', covered: false })]));
    await expect(new SpaceMtProvider(BASE).translate({ text: 'x', from: 'tw', to: 'en' })).rejects.toThrow(/does not translate/);

    stubFetch(...gradio([JSON.stringify({ translation: '  ', covered: true })]));
    await expect(new SpaceMtProvider(BASE).translate({ text: 'x', from: 'tw', to: 'en' })).rejects.toThrow(/empty translation/);

    await expect(new SpaceMtProvider(BASE).translate({ text: 'x', from: 'gaa', to: 'en' })).rejects.toThrow(/no language code/);
  });
});

describe('SpaceTtsProvider (D-045)', () => {
  let cacheDir: string;
  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ftm-space-tts-'));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  const fileResult = { path: '/tmp/x.wav', url: `${BASE}/gradio_api/file=/tmp/x.wav`, orig_name: 'x.wav' };

  it('synthesizes, caches a .wav by content hash, and serves the same URL from cache', async () => {
    const fetchMock = stubFetch(...gradio([fileResult]), audioResponse());
    const tts = new SpaceTtsProvider({ baseUrl: BASE, cacheDir });
    const first = await tts.synthesize({ text: 'Maakye', locale: 'tw' });
    expect(first?.url).toMatch(/\/tts\/tw\/[0-9a-f]{64}\.wav$/);
    expect(fs.readdirSync(path.join(cacheDir, 'tw'))).toHaveLength(1);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toEqual({ data: ['Maakye', 'twi'] });

    const second = await tts.synthesize({ text: 'Maakye', locale: 'tw' });
    expect(second?.url).toBe(first?.url);
    expect(fetchMock).toHaveBeenCalledTimes(3); // post + stream + audio, once — the second call hit the cache
  });

  it('answers null (→ <Say>) for English, unknown locales, Space errors and empty audio', async () => {
    const fetchMock = stubFetch();
    const tts = new SpaceTtsProvider({ baseUrl: BASE, cacheDir });
    expect(await tts.synthesize({ text: 'x', locale: 'en' })).toBeNull();
    expect(await tts.synthesize({ text: 'x', locale: 'gaa' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    expect(await tts.synthesize({ text: 'y', locale: 'kus' })).toBeNull();

    stubFetch(...gradio([fileResult]), audioResponse([]));
    expect(await tts.synthesize({ text: 'z', locale: 'kus' })).toBeNull();
  });

  it('does not hold a live call past its budget — and the clip still lands in the cache for the next caller', async () => {
    let releaseAudio: (v: unknown) => void = () => undefined;
    const slowAudio = new Promise((resolve) => {
      releaseAudio = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(gradio([fileResult])[0])
      .mockResolvedValueOnce(gradio([fileResult])[1])
      .mockReturnValueOnce(slowAudio);
    vi.stubGlobal('fetch', fetchMock);
    const tts = new SpaceTtsProvider({ baseUrl: BASE, cacheDir, waitMs: 20 });

    expect(await tts.synthesize({ text: 'Slow line', locale: 'dag' })).toBeNull(); // budget spent → <Say>
    releaseAudio(audioResponse());
    await vi.waitFor(() => expect(fs.existsSync(path.join(cacheDir, 'dag'))).toBe(true));

    const next = await tts.synthesize({ text: 'Slow line', locale: 'dag' });
    expect(next?.url).toMatch(/\/tts\/dag\/[0-9a-f]{64}\.wav$/);
    expect(fetchMock).toHaveBeenCalledTimes(3); // the late clip was reused, not synthesized again
  });
});
