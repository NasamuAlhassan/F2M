import { afterEach, describe, expect, it, vi } from 'vitest';
import { KhayaAsrProvider } from './index';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) };
}
function audioResponse() {
  return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) };
}

// Wire-format tests: the first fetch pulls the gateway recording, the second
// posts it to Khaya. The API has answered both bare strings and {text} objects
// in the wild — both must yield the transcript, never "[object Object]".
describe('KhayaAsrProvider', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('parses an object body via .text, and maps the locale into the URL', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(audioResponse())
      .mockResolvedValueOnce(jsonResponse({ text: 'mewɔ aburo nkotoku du' }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await new KhayaAsrProvider('key-123').transcribe({ audioRef: 'http://gw/rec.mp3', locale: 'tw' });
    expect(out).toBe('mewɔ aburo nkotoku du');
    expect(fetchMock.mock.calls[1]![0]).toContain('language=tw');
    expect(fetchMock.mock.calls[1]![1].headers['Ocp-Apim-Subscription-Key']).toBe('key-123');
  });

  it('parses a bare-string body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(audioResponse()).mockResolvedValueOnce(jsonResponse('plain transcript')),
    );
    const out = await new KhayaAsrProvider('k').transcribe({ audioRef: 'http://gw/rec.mp3', locale: 'dag' });
    expect(out).toBe('plain transcript');
  });

  it('throws a descriptive error for a locale Khaya lacks, before any fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(new KhayaAsrProvider('k').transcribe({ audioRef: 'http://gw/rec.mp3', locale: 'kus' })).rejects.toThrow(
      /no language code for locale 'kus'/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws on a non-ok Khaya response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(audioResponse()).mockResolvedValueOnce(jsonResponse({ error: 'x' }, false, 500)),
    );
    await expect(new KhayaAsrProvider('k').transcribe({ audioRef: 'http://gw/rec.mp3', locale: 'tw' })).rejects.toThrow(
      /Khaya ASR failed: 500/,
    );
  });

  it('throws without a key or a recording', async () => {
    // '' (not undefined): undefined would fall back to a real key in .env.
    await expect(new KhayaAsrProvider('').transcribe({ audioRef: 'x', locale: 'tw' })).rejects.toThrow(/KHAYA_API_KEY/);
    await expect(new KhayaAsrProvider('k').transcribe({ audioRef: null, locale: 'tw' })).rejects.toThrow(/No recording/);
  });
});
