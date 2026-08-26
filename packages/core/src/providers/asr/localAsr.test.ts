import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalAsrProvider } from './index';

function audioResponse(type = 'audio/mpeg') {
  return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8), headers: new Headers({ 'content-type': type }) };
}
function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => 'err' };
}

describe('LocalAsrProvider (D-044)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts the recording plus locale to the local service as multipart form data', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(audioResponse())
      .mockResolvedValueOnce(jsonResponse({ text: ' Ma bɔɔlim naara ' }));
    vi.stubGlobal('fetch', fetchMock);
    const out = await new LocalAsrProvider('http://localhost:8008').transcribe({
      audioRef: 'http://gw/rec.mp3',
      locale: 'kus',
    });
    expect(out).toBe('Ma bɔɔlim naara');
    expect(fetchMock.mock.calls[1]![0]).toBe('http://localhost:8008/asr');
    const form = fetchMock.mock.calls[1]![1].body as FormData;
    expect(form.get('locale')).toBe('kus');
    expect(form.get('audio')).toBeTruthy();
  });

  it('throws on missing recording, an unreachable service, and non-ok responses', async () => {
    await expect(new LocalAsrProvider('http://localhost:8008').transcribe({ audioRef: null, locale: 'kus' })).rejects.toThrow(
      /No recording/,
    );

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(audioResponse()).mockRejectedValueOnce(new Error('ECONNREFUSED')),
    );
    await expect(
      new LocalAsrProvider('http://localhost:8008').transcribe({ audioRef: 'http://gw/r.mp3', locale: 'kus' }),
    ).rejects.toThrow(/unreachable/);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(audioResponse()).mockResolvedValueOnce(jsonResponse({}, false, 500)),
    );
    await expect(
      new LocalAsrProvider('http://localhost:8008').transcribe({ audioRef: 'http://gw/r.mp3', locale: 'kus' }),
    ).rejects.toThrow(/Local ASR failed: 500/);
  });
});
