import {
  db,
  getAsrProvider,
  listLotsByFarmer,
  listVoiceCallsForPhone,
  registerFarmer,
  schema,
  setLlmProvider,
  type LlmProvider,
  type LlmRequest,
} from '@ftm/core';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from './app';
import { handleUssdRequest } from './ussd/index';

/**
 * The language-model assist inside a guided voice listing (D-056). The call is
 * driven the way the gateway drives it, with a scripted stand-in for the model.
 * What must hold: it reads only the first, whole-listing sentence; it fills only
 * what the rules left empty and only with words she said; and nothing goes
 * live before she presses 1, whatever the model supplied.
 */

let app: FastifyInstance;
let seq = 0;
const nextPhone = () => `+2332076100${String(++seq).padStart(2, '0')}`;

beforeAll(async () => {
  app = await buildServer({ logger: false });
  void getAsrProvider();
});
afterAll(async () => {
  await app.close();
});
afterEach(() => setLlmProvider(undefined));

function scripted(answer: Record<string, unknown>) {
  const asked: Array<LlmRequest<unknown>> = [];
  const p: LlmProvider & { asked: typeof asked } = {
    name: 'mock',
    asked,
    async extract<T>(req: LlmRequest<T>): Promise<T> {
      asked.push(req as LlmRequest<unknown>);
      return req.schema.parse(answer);
    },
  };
  return p;
}

const said = (xml: string) => [...xml.matchAll(/<Say[^>]*>([^<]*)<\/Say>/g)].map((m) => m[1]).join(' ').replaceAll('&amp;', '&');

class Call {
  xml = '';
  constructor(
    private readonly phone: string,
    private readonly sessionId = `s-${Math.random().toString(36).slice(2)}`,
  ) {}
  private async post(url: string, fields: Record<string, string>) {
    const u = new URL(url, 'http://localhost:3000');
    const res = await app.inject({
      method: 'POST',
      url: u.pathname + u.search,
      payload: new URLSearchParams({ sessionId: this.sessionId, callerNumber: this.phone, isActive: '1', ...fields }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.statusCode).toBe(200);
    this.xml = res.body;
    return this;
  }
  answer(callId: string) {
    return this.post(`/voice/answer?callId=${callId}`, {});
  }
  dialLine() {
    return this.post('/voice/answer', {});
  }
  private callbackUrl(kind: 'GetDigits' | 'Record'): string {
    const tag = new RegExp(`<${kind}[^>]*callbackUrl="([^"]+)"`).exec(this.xml) ?? /callbackUrl="([^"]+)"/.exec(this.xml);
    if (!tag) throw new Error(`no ${kind} in: ${this.xml}`);
    return tag[1]!.replaceAll('&amp;', '&');
  }
  press(digits: string) {
    return this.post(this.callbackUrl('GetDigits'), { dtmfDigits: digits });
  }
  say(transcript: string) {
    return this.post(this.callbackUrl('Record'), { transcript });
  }
  get text() {
    return said(this.xml);
  }
  keyFor(label: string): string {
    const m = new RegExp(`Press (\\d) for ${label}\\.`).exec(this.text);
    if (!m) throw new Error(`no option ${label} in: ${this.text}`);
    return m[1]!;
  }
}

async function ussd(phone: string, inputs: string[]): Promise<string> {
  const sessionId = `u-${Math.random().toString(36).slice(2)}`;
  let last = await handleUssdRequest({ sessionId, phoneNumber: phone, text: '' });
  const history: string[] = [];
  for (const input of inputs) {
    history.push(input);
    last = await handleUssdRequest({ sessionId, phoneNumber: phone, text: history.join('*') });
  }
  return last;
}

function farmer() {
  return registerFarmer({ phone: nextPhone(), name: 'Assist Farmer', regionCode: 'NORTHERN', district: 'Tolon' });
}

async function startCallback(phone: string): Promise<Call> {
  await ussd(phone, ['1', '8']); // Sell → 8: F2M rings back for a voice listing
  const queued = listVoiceCallsForPhone(phone, 5).find((c) => c.flow === 'listing' && c.status === 'pending')!;
  const call = new Call(phone);
  await call.answer(queued.id);
  return call;
}

// "bags" of maize come in two sizes and she named none; the rules hear the crop and the count, not the price.
const SENTENCE = 'I have ten bags of maize, four hundred each';
const ANSWER = { unit: 'BAG_50KG', quantity: 10, priceCedisPerUnit: 400, readyInDays: null, harvestedDaysAgo: null };

describe('the assist inside a guided voice listing', () => {
  it('with it off, the call asks for the price, exactly as before', async () => {
    const f = farmer();
    const call = await startCallback(f.phone);
    await call.say(SENTENCE);
    expect(call.text).toContain('How do you measure your Maize?'); // the bag size is always asked
    await call.press(call.keyFor('50kg bag'));
    expect(call.text.toLowerCase()).toContain('how much do you want for each'); // the price question: the rules never heard one
  });

  it('with it on, fills the price she said, still asks the bag size, and reads it all back before 1', async () => {
    const model = scripted(ANSWER);
    setLlmProvider(model);
    const f = farmer();
    const call = await startCallback(f.phone);
    await call.say(SENTENCE);

    // The model also "guessed" a 50 kg bag: dropped, because she did not say it. The call asks.
    expect(call.text).toContain('How do you measure your Maize?');
    await call.press(call.keyFor('50kg bag'));
    expect(call.text.toLowerCase()).not.toContain('how much do you want for each'); // the price was understood: no price question

    // Walk the rest with "yes" answers until the readback.
    let guard = 0;
    while (!call.text.includes('Press 1 to publish it') && guard++ < 12) await call.press('1');
    expect(call.text).toContain('You are listing 10 50kg bag of Maize');
    expect(call.text).toContain('GHS 400.00'); // what the model supplied is read back...
    expect(listLotsByFarmer(f.id)).toHaveLength(0); // ...and nothing is live yet

    await call.press('1');
    const [lot] = listLotsByFarmer(f.id);
    expect(lot).toMatchObject({ unitQty: 10, askingPricePerUnit: 40_000, channel: 'ivr' });

    // The saved record says which fields the model supplied.
    const record = db.select().from(schema.voiceListings).where(eq(schema.voiceListings.lotId, lot!.id)).get()!;
    expect(JSON.parse(record.parsed!).aiFilled).toEqual(['pricePerUnit']);
  });

  it('reads only the first, whole-listing sentence — never the short answers after it', async () => {
    const model = scripted(ANSWER);
    setLlmProvider(model);
    const f = farmer();
    const call = await startCallback(f.phone);
    await call.say('I have ten bags, four hundred each'); // no crop heard: nothing for the model to add
    expect(model.asked).toHaveLength(0); // it does not name a crop for her
    expect(call.text.toLowerCase()).toContain('which crop are you selling');
    await call.say('maize'); // a later answer: the rules alone
    expect(model.asked).toHaveLength(0);
  });

  it('is read once for a listing started from the line menu, which is not a callback', async () => {
    const model = scripted(ANSWER);
    setLlmProvider(model);
    const f = farmer();
    const call = new Call(f.phone);
    await call.dialLine();
    await call.press('1'); // "Press 1 to sell produce"
    await call.say(SENTENCE);
    expect(model.asked).toHaveLength(1);
    await call.press(call.keyFor('50kg bag'));
    expect(model.asked).toHaveLength(1); // not again for the answers that follow
  });
});
