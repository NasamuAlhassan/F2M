import { afterEach, describe, expect, it, vi } from 'vitest';
import { KhayaMtProvider } from './index';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) };
}

describe('KhayaMtProvider', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('parses an object body via .translatedText and sends mapped lang codes', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ translatedText: 'I have ten bags of maize' }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await new KhayaMtProvider('key-123').translate({ text: 'mewɔ aburo nkotoku du', from: 'tw', to: 'en' });
    expect(out).toBe('I have ten bags of maize');
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body).toEqual({ in: 'mewɔ aburo nkotoku du', lang: 'tw-en' });
    expect(fetchMock.mock.calls[0]![1].headers['Ocp-Apim-Subscription-Key']).toBe('key-123');
  });

  it('parses a bare-string body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse('translated')));
    expect(await new KhayaMtProvider('k').translate({ text: 'x', from: 'dag', to: 'en' })).toBe('translated');
  });

  it('short-circuits from===to with zero fetches', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await new KhayaMtProvider('k').translate({ text: 'same', from: 'en', to: 'en' })).toBe('same');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws for a locale Khaya lacks, before any fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(new KhayaMtProvider('k').translate({ text: 'x', from: 'kus', to: 'en' })).rejects.toThrow(
      /no language code for locale 'kus'/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ error: 'x' }, false, 429)));
    await expect(new KhayaMtProvider('k').translate({ text: 'x', from: 'tw', to: 'en' })).rejects.toThrow(/Khaya MT failed: 429/);
  });
});
