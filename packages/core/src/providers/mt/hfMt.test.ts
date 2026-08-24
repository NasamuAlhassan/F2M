import { afterEach, describe, expect, it, vi } from 'vitest';
import { HfMtProvider } from './index';

function chatResponse(content: string, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => ({ choices: [{ message: { content } }] }),
    text: async () => 'err',
  };
}

describe('HfMtProvider (D-041)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('translates via the router with temperature 0 and strips wrapping quotes', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(chatResponse('"Wo aburo no wɔ gua so 70901."'));
    vi.stubGlobal('fetch', fetchMock);
    const out = await new HfMtProvider('tok', 'google/gemma-3-27b-it').translate({
      text: 'Your maize is listed 70901.',
      from: 'en',
      to: 'tw',
    });
    expect(out).toBe('Wo aburo no wɔ gua so 70901.');
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.model).toBe('google/gemma-3-27b-it');
    expect(body.temperature).toBe(0);
    expect(body.messages[0].content).toContain('Twi (Akan, Ghana)');
    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe('Bearer tok');
  });

  it('short-circuits from===to; throws on empty output, non-ok, and missing token', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await new HfMtProvider('tok').translate({ text: 'same', from: 'en', to: 'en' })).toBe('same');
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(chatResponse('   ')));
    await expect(new HfMtProvider('tok').translate({ text: 'x', from: 'en', to: 'tw' })).rejects.toThrow(/empty translation/);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(chatResponse('', false, 402)));
    await expect(new HfMtProvider('tok').translate({ text: 'x', from: 'en', to: 'tw' })).rejects.toThrow(/HF MT failed: 402/);

    await expect(new HfMtProvider('').translate({ text: 'x', from: 'en', to: 'tw' })).rejects.toThrow(/HF_TOKEN/);
  });
});
