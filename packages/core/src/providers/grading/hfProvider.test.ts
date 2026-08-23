import { afterEach, describe, expect, it, vi } from 'vitest';
import { rubricDocSchema } from '../../domain/types';
import { HfGradingProvider } from './hfProvider';

const rubric = rubricDocSchema.parse({
  gradeBands: ['A', 'B', 'C', 'REJECT'],
  aggregation: 'worst_criterion',
  criteria: [
    {
      key: 'mould',
      labelKey: 'rubric.maize.mould',
      visualCues: 'fuzz, caking',
      bandDescriptors: { A: 'none', B: 'specks', C: 'patches', REJECT: 'widespread' },
    },
  ],
});

const IMAGES = [{ mime: 'image/jpeg', base64: 'aGVsbG8=' }];

function chatResponse(content: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
    text: async () => '',
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('HF grading provider', () => {
  it('repairs malformed JSON with one round-trip', async () => {
    const goodJson = JSON.stringify({
      gradeBand: 'C',
      confidence: 0.7,
      reasons: [{ criterion: 'mould', observation: 'patches near seam', bandForCriterion: 'C' }],
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(chatResponse('The maize looks mouldy, grade C I think.')) // no JSON at all
      .mockResolvedValueOnce(chatResponse('```json\n' + goodJson + '\n```'));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new HfGradingProvider({ token: 'test', model: 'test/model', retryDelayMs: 0 });
    const result = await provider.grade({ commodityCode: 'MAIZE', rubric, images: IMAGES });

    expect(result.gradeBand).toBe('C');
    expect(result.provider).toBe('hf');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The repair request includes the model's bad reply plus the demand for JSON only.
    const secondBody = JSON.parse(fetchMock.mock.calls[1]![1].body as string);
    expect(secondBody.messages.at(-1).content).toMatch(/not valid JSON/);
  });

  it('backs off through 503s and rejects bands outside the rubric', async () => {
    const badBand = JSON.stringify({ gradeBand: 'PREMIUM', confidence: 0.9, reasons: [] });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}), text: async () => 'loading' })
      .mockResolvedValueOnce(chatResponse(badBand)) // schema-invalid → triggers repair
      .mockResolvedValueOnce(chatResponse(badBand)); // repair also invalid → throw
    vi.stubGlobal('fetch', fetchMock);

    const provider = new HfGradingProvider({ token: 'test', model: 'test/model', retryDelayMs: 0 });
    await expect(provider.grade({ commodityCode: 'MAIZE', rubric, images: IMAGES })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(3); // 503 retry + first + repair
  });
});
