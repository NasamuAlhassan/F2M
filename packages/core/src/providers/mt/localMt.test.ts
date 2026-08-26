import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalMtProvider } from './index';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => 'err' };
}

describe('LocalMtProvider (D-044)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts text/from/to to the local service', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ text: 'I have ten bags of maize' }));
    vi.stubGlobal('fetch', fetchMock);
    const out = await new LocalMtProvider('http://localhost:8008').translate({
      text: 'Mam bɔɔlim pia',
      from: 'kus',
      to: 'en',
    });
    expect(out).toBe('I have ten bags of maize');
    expect(fetchMock.mock.calls[0]![0]).toBe('http://localhost:8008/mt');
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body).toEqual({ text: 'Mam bɔɔlim pia', from: 'kus', to: 'en' });
  });

  it('short-circuits from===to; throws on an unreachable service, empty output, and non-ok', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await new LocalMtProvider('http://localhost:8008').translate({ text: 'same', from: 'en', to: 'en' })).toBe('same');
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('ECONNREFUSED')));
    await expect(new LocalMtProvider('http://localhost:8008').translate({ text: 'x', from: 'kus', to: 'en' })).rejects.toThrow(
      /unreachable/,
    );

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ text: '   ' })));
    await expect(new LocalMtProvider('http://localhost:8008').translate({ text: 'x', from: 'kus', to: 'en' })).rejects.toThrow(
      /empty translation/,
    );

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({}, false, 500)));
    await expect(new LocalMtProvider('http://localhost:8008').translate({ text: 'x', from: 'kus', to: 'en' })).rejects.toThrow(
      /Local MT failed: 500/,
    );
  });
});
