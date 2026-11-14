import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AnthropicLlmProvider, jsonSchemaFor, LlmError, scrubPii, setLlmProvider, type LlmProvider, type LlmRequest } from '../providers/llm/index';
import { adviseOffer, assistListingDraft, checkListingPhoto, fillGaps, understandRequest } from './aiAssist';
import { registerFarmer } from './farmers';
import { registerLot } from './lots';
import { placeBid } from './offers';
import { recordPrice } from './priceIntel';
import { getCommodityByCode } from './registries';
import { testBuyer } from '../testing/fixtures';

const DAY = 24 * 60 * 60 * 1000;

/** A stand-in model that answers with whatever the test scripts, and remembers what it was asked. */
function scripted(answer: unknown | (() => never)): LlmProvider & { asked: Array<LlmRequest<unknown>> } {
  const asked: Array<LlmRequest<unknown>> = [];
  return {
    name: 'mock',
    asked,
    async extract<T>(req: LlmRequest<T>): Promise<T> {
      asked.push(req as LlmRequest<unknown>);
      if (typeof answer === 'function') (answer as () => never)();
      return req.schema.parse(answer);
    },
  };
}

afterEach(() => setLlmProvider(undefined));

describe('scrubPii', () => {
  it('removes phone numbers and e-mail addresses before text leaves the server', () => {
    const out = scrubPii('call me on 0244123456 or +233 24 412 3456, kofi@example.com, ten bags of maize');
    expect(out).not.toMatch(/0244123456|412 3456|kofi@/);
    expect(out).toContain('ten bags of maize');
  });
});

describe('AnthropicLlmProvider', () => {
  const schema = z.object({ answer: z.string().nullable(), count: z.number().int().min(0) });
  const okReply = (text: string, stop = 'end_turn') => async () =>
    new Response(JSON.stringify({ stop_reason: stop, content: [{ type: 'thinking', thinking: '' }, { type: 'text', text }] }), { status: 200 });

  function provider(fetchImpl: typeof fetch, model = 'claude-opus-5-5') {
    return new AnthropicLlmProvider({ apiKey: 'sk-test', model, effort: 'low', timeoutMs: 1000, fetchImpl });
  }

  it('sends the documented request: key and version headers, structured output, effort, no sampling or prefill', async () => {
    let seen: { headers: Record<string, string>; body: Record<string, any> } | null = null;
    const p = provider((async (_url: string, init: RequestInit) => {
      seen = { headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) };
      return okReply('{"answer":"hi","count":2}')();
    }) as unknown as typeof fetch);
    const out = await p.extract({ system: 'sys', user: 'text', schema });
    expect(out).toEqual({ answer: 'hi', count: 2 });
    expect(seen!.headers['x-api-key']).toBe('sk-test');
    expect(seen!.headers['anthropic-version']).toBe('2026-10-21');
    const body = seen!.body;
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.output_config.effort).toBe('low');
    expect(body.output_config.format.type).toBe('json_schema');
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('thinking');
    expect(body.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'text' }] }]);
    // The refusal rescue is requested for this model...
    expect(body.fallbacks).toBe('default');
    expect(seen!.headers['anthropic-beta']).toBe('server-side-fallback-2026-07-01');
  });

  it('does not ask for a rescue model on a model that has none', async () => {
    let body: Record<string, any> = {};
    let headers: Record<string, string> = {};
    const p = provider((async (_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      headers = init.headers as Record<string, string>;
      return okReply('{"answer":null,"count":0}')();
    }) as unknown as typeof fetch, 'claude-haiku-5-5');
    await p.extract({ system: 's', user: 'u', schema });
    expect(body).not.toHaveProperty('fallbacks');
    expect(headers).not.toHaveProperty('anthropic-beta');
  });

  it('attaches images as base64 blocks before the text', async () => {
    let body: Record<string, any> = {};
    const p = provider((async (_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return okReply('{"answer":null,"count":0}')();
    }) as unknown as typeof fetch);
    await p.extract({ system: 's', user: 'u', schema, images: [{ mime: 'image/jpeg', base64: 'AAAA' }] });
    expect(body.messages[0].content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } });
    expect(body.messages[0].content[1].type).toBe('text');
  });

  it('turns every kind of failure into an error the caller can swallow', async () => {
    await expect(provider(okReply('{"answer":"x","count":1}', 'refusal') as unknown as typeof fetch).extract({ system: 's', user: 'u', schema })).rejects.toThrow(LlmError);
    await expect(provider(okReply('{"answer":"x","count":1}', 'max_tokens') as unknown as typeof fetch).extract({ system: 's', user: 'u', schema })).rejects.toThrow(/cut off/);
    await expect(provider(okReply('not json') as unknown as typeof fetch).extract({ system: 's', user: 'u', schema })).rejects.toThrow(/not JSON/);
    await expect(provider(okReply('{"answer":"x","count":-4}') as unknown as typeof fetch).extract({ system: 's', user: 'u', schema })).rejects.toThrow(/schema/);
    await expect(provider((async () => new Response('{}', { status: 500 })) as unknown as typeof fetch).extract({ system: 's', user: 'u', schema })).rejects.toThrow(/500/);
  });

  it('refuses to run without a key', async () => {
    const p = new AnthropicLlmProvider({ apiKey: '', fetchImpl: (async () => new Response('{}')) as unknown as typeof fetch });
    await expect(p.extract({ system: 's', user: 'u', schema })).rejects.toThrow(/key/);
  });
});

describe('jsonSchemaFor', () => {
  it('leaves out the keywords structured outputs reject (the Zod check enforces them after)', () => {
    const json = JSON.stringify(jsonSchemaFor(z.object({ n: z.number().int().min(1).max(9), s: z.string().max(5), m: z.number().nullable() })));
    for (const bad of ['"minimum"', '"maximum"', '"maxLength"', '"$schema"']) expect(json).not.toContain(bad);
    expect(json).toContain('"type":"object"');
  });
});

describe('assistListingDraft', () => {
  const sentence = 'I have ten bags of maize, the fifty kilo bags, I want four hundred cedis a bag, ready in three days';
  const good = { unit: 'BAG_50KG', quantity: 10, priceCedisPerUnit: 400, readyInDays: 3, harvestedDaysAgo: null };

  it('does nothing while the assist is off', async () => {
    expect(await assistListingDraft(sentence)).toBeNull();
  });

  it('returns validated fields that match what she said', async () => {
    setLlmProvider(scripted(good));
    const r = await assistListingDraft(sentence);
    expect(r!.draft).toEqual({ unitCode: 'BAG_50KG', unitQty: 10, pricePerUnit: 40_000, readyInDays: 3 });
    expect(r!.fields.sort()).toEqual(['pricePerUnit', 'readyInDays', 'unitCode', 'unitQty']);
  });

  it('never lets the model name the crop, and does not send names or numbers it was not given', async () => {
    const model = scripted(good);
    setLlmProvider(model);
    await assistListingDraft(`${sentence}, call 0244123456`);
    expect(model.asked[0]!.system).toContain('The crop is Maize');
    expect(model.asked[0]!.user).not.toContain('0244123456'); // scrubbed on the way out
    setLlmProvider(scripted(good));
    expect(await assistListingDraft('I have ten bags, I want four hundred cedis a bag')).toBeNull(); // no crop from the rules: no assist
    expect(await assistListingDraft('ten bags of maize and five crates of tomato')).toBeNull(); // two crops: the call asks
  });

  it('drops any number she did not say — a hallucinated quantity or price never gets through', async () => {
    setLlmProvider(scripted({ ...good, quantity: 25, priceCedisPerUnit: 380, readyInDays: 9 }));
    expect(await assistListingDraft(sentence)).toEqual({ draft: { unitCode: 'BAG_50KG' }, fields: ['unitCode'] });
  });

  it('never lets the model pick a bag size she did not say — "bags" of maize is asked, not assumed', async () => {
    setLlmProvider(scripted({ ...good, unit: 'BAG_50KG' }));
    const r = await assistListingDraft('I have ten bags of maize, four hundred each');
    expect(r!.draft).toEqual({ unitQty: 10, pricePerUnit: 40_000 }); // the price she named; the size stays unanswered
  });

  it('does not read a weight she said as a price or a count', async () => {
    setLlmProvider(scripted({ ...good, unit: null, quantity: 10, priceCedisPerUnit: 50, readyInDays: null }));
    const r = await assistListingDraft('ten bags of maize, fifty kilos each');
    expect(r!.draft).toEqual({ unitQty: 10 }); // 50 was a weight, so it cannot be the price
  });

  it('takes a unit when her own words single it out', async () => {
    setLlmProvider(scripted({ ...good, unit: 'OLONKA', quantity: null, priceCedisPerUnit: null, readyInDays: null }));
    const r = await assistListingDraft('I have maize in olonka');
    expect(r!.draft).toEqual({ unitCode: 'OLONKA' });
  });

  it('drops a unit that is not sold for that crop', async () => {
    setLlmProvider(scripted({ ...good, unit: 'CRATE' }));
    const r = await assistListingDraft(sentence);
    expect(r!.draft.unitCode).toBeUndefined();
  });

  it('is null, not an error, when the model fails or says nothing useful', async () => {
    setLlmProvider(scripted(() => {
      throw new Error('down');
    }));
    expect(await assistListingDraft(sentence)).toBeNull();
    setLlmProvider(scripted({ unit: null, quantity: null, priceCedisPerUnit: null, readyInDays: null, harvestedDaysAgo: null }));
    expect(await assistListingDraft(sentence)).toBeNull();
  });

  it('accepts "today" for a ready date and "yesterday" for a harvest', async () => {
    setLlmProvider(scripted({ ...good, quantity: null, priceCedisPerUnit: null, unit: null, readyInDays: 0, harvestedDaysAgo: 1 }));
    const r = await assistListingDraft('maize ready today, harvested yesterday');
    expect(r!.draft).toEqual({ readyInDays: 0, harvestedDaysAgo: 1 });
  });
});

describe('fillGaps', () => {
  it('never overrides what the rules heard, and says what it added', () => {
    const { draft, aiFilled } = fillGaps({ commodityCode: 'MAIZE', unitQty: 8 }, { unitQty: 10, unitCode: 'BAG_50KG', pricePerUnit: 40_000 });
    expect(draft).toEqual({ commodityCode: 'MAIZE', unitQty: 8, unitCode: 'BAG_50KG', pricePerUnit: 40_000 });
    expect(aiFilled.sort()).toEqual(['pricePerUnit', 'unitCode']);
  });
});

describe('understandRequest', () => {
  const answer = {
    commodity: 'TOMATO',
    quantity: 5,
    quantityIsKg: true,
    unit: null,
    priceCedisPerKg: 6,
    grade: 'A',
    region: 'ASHANTI',
    neededWithinDays: 2,
  };
  const text = 'I need 5 tonnes of grade A tomatoes in Kumasi within 2 days, up to 6 cedis a kilo';

  it('reads a plain-words request into form fields, turning tonnes into kilograms', async () => {
    setLlmProvider(scripted(answer));
    expect(await understandRequest(text)).toEqual({ commodityCode: 'TOMATO', quantityKg: 5000, pricePerKgGhs: 6, minBand: 'A', regionCode: 'ASHANTI', windowDays: 2 });
  });

  it('drops invented numbers, unknown regions, and a grade the buyer did not name', async () => {
    setLlmProvider(scripted({ ...answer, quantity: 7, priceCedisPerKg: 4.5, region: 'ATLANTIS', neededWithinDays: 9 }));
    const r = await understandRequest('I need tomatoes in Kumasi, grade A please');
    expect(r).toEqual({ commodityCode: 'TOMATO', minBand: 'A' });
    setLlmProvider(scripted({ ...answer, grade: 'A' }));
    expect(await understandRequest('5 tonnes of tomatoes')).not.toHaveProperty('minBand');
  });

  it('is null while the assist is off', async () => {
    expect(await understandRequest(text)).toBeNull();
  });
});

describe('adviseOffer — arithmetic, no model', () => {
  const seedPrices = (code: string, perKg: number, tag: string) => {
    const c = getCommodityByCode(code).id;
    for (let i = 0; i < 6; i += 1) recordPrice({ commodityId: c, pricePerKg: perKg + i, source: 'deal', refId: `${tag}-${i}`, observedAt: Date.now() - (i + 1) * DAY });
  };
  const bid = (phone: string, pricePerUnit: number) => {
    const farmer = registerFarmer({ phone, name: 'Advice Farmer', regionCode: 'ASHANTI' });
    const lot = registerLot({ farmerId: farmer.id, commodityCode: 'PLANTAIN', unitCode: 'BUNCH', unitQty: 10, declaredBand: 'B', askingPricePerUnit: 6000 });
    return placeBid({ buyerId: testBuyer().id, lotId: lot.id, units: 2, pricePerUnit });
  };

  it('tells a farmer to accept a fair or generous offer and to counter a low one at the market middle', () => {
    seedPrices('PLANTAIN', 500, 'adv'); // ~GHS 5/kg → ~GHS 60 a 12 kg bunch
    const fair = adviseOffer(bid('+233207600001', 6100).id, 'farmer');
    expect(fair.action).toBe('accept');
    const low = adviseOffer(bid('+233207600002', 3000).id, 'farmer');
    expect(low.action).toBe('counter');
    expect(low.suggestedPricePerUnit).toBeGreaterThan(5500);
    expect(low.message).toContain('Consider countering');
  });

  it('advises the buyer the other way round', () => {
    seedPrices('PLANTAIN', 500, 'adv2');
    const dear = adviseOffer(bid('+233207600003', 9500).id, 'buyer');
    expect(dear.action).toBe('counter'); // the buyer is bidding well over the market
  });

  it('says so when there is too little data', () => {
    const farmer = registerFarmer({ phone: '+233207600004', name: 'No Data Farmer', regionCode: 'ASHANTI' });
    const lot = registerLot({ farmerId: farmer.id, commodityCode: 'RICE', unitCode: 'BAG_50KG', unitQty: 5, declaredBand: 'B' });
    const offer = placeBid({ buyerId: testBuyer().id, lotId: lot.id, units: 1, pricePerUnit: 50_000 });
    expect(adviseOffer(offer.id, 'farmer').action).toBe('none');
  });
});

describe('checkListingPhoto', () => {
  it('is null while the assist is off, and null when a lot has no photo', async () => {
    const farmer = registerFarmer({ phone: '+233207600005', name: 'Photo Farmer', regionCode: 'ASHANTI' });
    const lot = registerLot({ farmerId: farmer.id, commodityCode: 'ONION', unitCode: 'BAG_50KG', unitQty: 2, declaredBand: 'B' });
    expect(await checkListingPhoto(lot.id)).toBeNull();
    setLlmProvider(scripted({ showsProduce: true, produceSeen: 'onions', matchesDeclaredCrop: true, concerns: [] }));
    expect(await checkListingPhoto(lot.id)).toBeNull(); // nothing to look at
  });
});
