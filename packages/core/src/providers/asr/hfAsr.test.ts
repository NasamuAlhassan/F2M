import { afterEach, describe, expect, it, vi } from 'vitest';
import { HfAsrProvider } from './index';

function audioResponse(type = 'audio/wav') {
  return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8), headers: new Headers({ 'content-type': type }) };
}
function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => 'err' };
}

describe('HfAsrProvider (D-041)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts the recording bytes to hf-inference with its own content type', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(audioResponse('audio/wav'))
      .mockResolvedValueOnce(jsonResponse({ text: ' I have ten bags of maize ' }));
    vi.stubGlobal('fetch', fetchMock);
    const out = await new HfAsrProvider('tok', 'openai/whisper-large-v3').transcribe({
      audioRef: 'http://gw/rec.wav',
      locale: 'en',
    });
    expect(out).toBe('I have ten bags of maize');
    expect(fetchMock.mock.calls[1]![0]).toContain('/hf-inference/models/openai/whisper-large-v3');
    expect(fetchMock.mock.calls[1]![1].headers['Content-Type']).toBe('audio/wav');
  });

  it('throws on missing token, missing recording, and non-ok responses', async () => {
    await expect(new HfAsrProvider('').transcribe({ audioRef: 'x', locale: 'en' })).rejects.toThrow(/HF_TOKEN/);
    await expect(new HfAsrProvider('tok').transcribe({ audioRef: null, locale: 'en' })).rejects.toThrow(/No recording/);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(audioResponse()).mockResolvedValueOnce(jsonResponse({}, false, 503)),
    );
    await expect(new HfAsrProvider('tok').transcribe({ audioRef: 'http://gw/r.wav', locale: 'en' })).rejects.toThrow(
      /HF ASR failed: 503/,
    );
  });
});
