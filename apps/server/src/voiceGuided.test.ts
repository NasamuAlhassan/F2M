import {
  db,
  expireStaleVoiceCalls,
  getLot,
  getVoiceCall,
  getOffer,
  getTrace,
  listLotsByFarmer,
  listNotificationsForPhone,
  listVoiceCallsForPhone,
  MockPaymentProvider,
  placeBid,
  pollPaymentsOnce,
  registerBuyer,
  registerFarmer,
  registerLot,
  schema,
  setAsrProvider,
  setPaymentProvider,
  setTtsProvider,
} from '@ftm/core';
import { acceptFor, testBuyer } from '@ftm/core/testing';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from './app';
import { handleUssdRequest } from './ussd/index';

/**
 * Phase 2 (docs/PHASE2.md): the farmer on a basic phone. Every call here is
 * driven the way the gateway drives it — each answer is POSTed to the
 * callbackUrl the previous response named — with the mock voice (<Say>), so
 * the spoken text can be read straight off the XML.
 */

let app: FastifyInstance;
let seq = 0;
const nextPhone = () => `+2332074960${String(++seq).padStart(2, '0')}`;

beforeAll(async () => {
  app = await buildServer({ logger: false });
  setPaymentProvider(new MockPaymentProvider(0));
});
afterAll(async () => {
  setPaymentProvider(null);
  setTtsProvider(null);
  await app.close();
});

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

  /** The call F2M placed, answered. */
  answer(callId: string) {
    return this.post(`/voice/answer?callId=${callId}`, {});
  }

  /** The farmer dials the listing line. */
  dialLine() {
    return this.post('/voice/answer', {});
  }

  private callback(kind: 'GetDigits' | 'Record' | 'Redirect' = 'GetDigits'): string {
    if (kind === 'Redirect') return /<Redirect>([^<]+)<\/Redirect>/.exec(this.xml)![1]!.replaceAll('&amp;', '&');
    const tag = new RegExp(`<${kind}[^>]*callbackUrl="([^"]+)"`).exec(this.xml) ?? /callbackUrl="([^"]+)"/.exec(this.xml);
    if (!tag) throw new Error(`no ${kind} in: ${this.xml}`);
    return tag[1]!.replaceAll('&amp;', '&');
  }

  press(digits: string) {
    return this.post(this.callback('GetDigits'), { dtmfDigits: digits });
  }

  say(transcript: string) {
    return this.post(this.callback('Record'), { transcript });
  }

  silence() {
    return this.post(this.callback('GetDigits'), {});
  }

  followRedirect() {
    return this.post(this.callback('Redirect'), {});
  }

  get text() {
    return said(this.xml);
  }

  get ended() {
    return !this.xml.includes('<GetDigits') && !this.xml.includes('<Record') && !this.xml.includes('<Redirect');
  }

  /** The key the prompt names for an option: "Press 2 for 50kg bag." → '2'. */
  keyFor(label: string): string {
    const m = new RegExp(`Press (\\d) for ${label}\\.`).exec(this.text);
    if (!m) throw new Error(`no option ${label} in: ${this.text}`);
    return m[1]!;
  }
}

async function dialUssd(phone: string, inputs: string[]): Promise<string> {
  const sessionId = `u-${Math.random().toString(36).slice(2)}`;
  let last = await handleUssdRequest({ sessionId, phoneNumber: phone, text: '' });
  const history: string[] = [];
  for (const input of inputs) {
    history.push(input);
    last = await handleUssdRequest({ sessionId, phoneNumber: phone, text: history.join('*') });
  }
  return last;
}

function farmer(name = 'Voice Farmer') {
  return registerFarmer({ phone: nextPhone(), name, regionCode: 'NORTHERN', district: 'Tolon' });
}

function listingCall(phone: string): string {
  const call = listVoiceCallsForPhone(phone, 5).find((c) => c.flow === 'listing' && c.status === 'pending');
  if (!call) throw new Error('no listing call queued');
  return call.id;
}

describe('listing by voice (vision §5.2)', () => {
  it('USSD Sell → 8 rings the farmer back for a voice listing', async () => {
    const f = farmer();
    const screen = await dialUssd(f.phone, ['1', '8']);
    expect(screen).toContain('We are calling you now');
    expect(listVoiceCallsForPhone(f.phone, 5).some((c) => c.flow === 'listing' && c.status === 'pending')).toBe(true);
  });

  it('one sentence, the missing bits asked, read back, published only on 1', async () => {
    const f = farmer('Abiba Sulemana');
    await dialUssd(f.phone, ['1', '8']);
    const call = new Call(f.phone);
    await call.answer(listingCall(f.phone));
    expect(call.text).toContain('You are about to list produce');
    expect(call.xml).toContain('<Record');

    // The vision's own example sentence.
    await call.say('I have 99 bags of rice, and I am selling each bag for 2,000 Ghana cedis. I harvested them yesterday, and they will be ready tomorrow.');
    // Rice comes in a 50kg and a 25kg bag: "bags" alone is asked, never guessed.
    expect(call.text).toContain('How do you measure your Rice?');
    await call.press(call.keyFor('50kg bag'));

    // Quantity, price and both dates were understood: straight to the quality questions.
    expect(call.text).toContain('two short questions about the quality');
    expect(call.text).toContain('Is the rice dry');
    await call.press('1');
    expect(call.text).toContain('Is it clean');
    await call.press('1');

    expect(call.text).toContain('Your produce is in Tolon, Northern');
    await call.press('1');

    // The readback (vision step 8), with replay and a change detour.
    const review = call.text;
    expect(review).toContain('You are listing 99 50kg bag of Rice');
    expect(review).toContain('GHS 2000.00');
    expect(review).toContain('harvested yesterday');
    expect(review).toContain('from tomorrow');
    expect(review).toContain('grade A');
    expect(review).toContain('Press 1 to publish it');
    await call.press('9');
    expect(call.text).toBe(review);
    await call.press('2');
    expect(call.text).toContain('What do you want to change?');
    await call.press('0');
    expect(call.text).toBe(review);
    expect(listLotsByFarmer(f.id)).toHaveLength(0); // nothing is live before 1

    await call.press('1');
    expect(call.ended).toBe(true);
    expect(call.text).toContain('is now on the market');
    const [lot] = listLotsByFarmer(f.id);
    expect(lot).toMatchObject({ channel: 'ivr', unitQty: 99, quantityKg: 4950, askingPricePerUnit: 200000, declaredBand: 'A' });
    expect(lot!.harvestedAt).toBeLessThan(Date.now() - 20 * 3600_000);
    expect(lot!.readyDate).toBeGreaterThan(Date.now() + 20 * 3600_000);
    expect(call.text).toContain(lot!.lotCode);

    // What was said is kept with the listing (vision §5.3), and the SMS receipt went out.
    const record = db.select().from(schema.voiceListings).where(eq(schema.voiceListings.lotId, lot!.id)).get();
    expect(record).toMatchObject({ status: 'listed' });
    expect(record!.transcript).toContain('99 bags of rice');
    expect(listNotificationsForPhone(f.phone, 5).some((n) => n.templateKey === 'sms.listingCreated')).toBe(true);
  });

  it('asks again when unsure, falls back to the keypad, and cancels without saving', async () => {
    const f = farmer();
    await dialUssd(f.phone, ['1', '8']);
    const call = new Call(f.phone);
    await call.answer(listingCall(f.phone));

    await call.say('hello, good morning');
    expect(call.text).toContain('Which crop are you selling?');
    await call.say('mmm');
    expect(call.text).toContain('Sorry, we did not understand that.');
    await call.say('the thing from the farm');
    // Two misses: the crops read out on the keypad, four at a time.
    expect(call.text).toContain('Press 1 for Maize.');
    expect(call.text).toContain('Press 8 for more crops.');
    await call.press('8');
    expect(call.text).toContain('Press 1 for Groundnut.');
    await call.press('0');
    await call.press(call.keyFor('Rice'));
    await call.press(call.keyFor('25kg bag'));

    // Typed numbers end with #; * alone hears it again.
    expect(call.xml).toContain('finishOnKey="#"');
    const ask = call.text;
    await call.press('*');
    expect(call.text).toBe(ask);
    await call.press('12');
    expect(call.text).toContain('How much do you want for each 25kg bag');
    await call.press('0'); // let buyers make offers
    await call.press('5'); // not harvested yet
    await call.press('1'); // ready now
    await call.press('2');
    await call.press('2'); // two noes → grade C
    await call.press('2'); // say the community
    await call.say('Nyankpala');
    const review = call.text;
    expect(review).toContain('12 25kg bag of Rice');
    expect(review).toContain('buyers will make you offers');
    expect(review).toContain('not harvested yet');
    expect(review).toContain('grade C');
    expect(review).toContain('Nyankpala, Tolon, Northern');

    await call.press('3');
    expect(call.ended).toBe(true);
    expect(call.text).toContain('not published');
    expect(listLotsByFarmer(f.id)).toHaveLength(0);
  });

  it('a silent line is asked twice more, then ended politely', async () => {
    const f = farmer();
    await dialUssd(f.phone, ['1', '8']);
    const call = new Call(f.phone);
    await call.answer(listingCall(f.phone));
    await call.say('rice');
    const ask = call.text;
    await call.silence();
    expect(call.text).toBe(ask);
    await call.silence();
    expect(call.text).toBe(ask);
    await call.silence();
    expect(call.ended).toBe(true);
    expect(call.text).toContain('We did not hear an answer');
  });

  it('a farmer who hangs up mid-listing is not rung back, and a long call is not cut short', async () => {
    const f = farmer();
    await dialUssd(f.phone, ['1', '8']);
    const callId = listingCall(f.phone);
    // Placed long ago, but answered and still going: not stale.
    db.update(schema.voiceCalls).set({ status: 'placing', attempts: 1, lastAttemptAt: Date.now() - 10 * 60_000 }).where(eq(schema.voiceCalls.id, callId)).run();
    const call = new Call(f.phone);
    await call.answer(callId);
    await call.say('rice');
    expireStaleVoiceCalls();
    expect(getVoiceCall(callId)!.status).toBe('in_progress');

    // Quiet for longer than the answer timeout: closed, never re-queued.
    db.update(schema.voiceCalls).set({ updatedAt: Date.now() - 10 * 60_000 }).where(eq(schema.voiceCalls.id, callId)).run();
    expireStaleVoiceCalls();
    expect(getVoiceCall(callId)).toMatchObject({ status: 'completed' });
    expect(JSON.parse(getVoiceCall(callId)!.outcome!)).toMatchObject({ result: 'hung_up' });
  });

  it('a recording that takes long to hear is held with "one moment", not left hanging', async () => {
    const f = farmer();
    await dialUssd(f.phone, ['1', '8']);
    const call = new Call(f.phone);
    await call.answer(listingCall(f.phone));
    // The live Space took 15 s to hear a Twi sentence; a gateway does not wait that long.
    let finish!: (text: string) => void;
    setAsrProvider({ name: 'mock', transcribe: () => new Promise<string>((resolve) => (finish = resolve)) });
    try {
      await call.say('ignored: the slow recogniser decides');
      expect(call.xml).toContain('<Redirect>');
      expect(call.text).toContain('One moment');
      finish('I have 30 crates of tomato');
      await call.followRedirect();
      expect(call.xml).not.toContain('<Redirect>');
      // Heard: tomato, 30 crates — straight on to the price.
      expect(call.text).toContain('How much do you want for each Crate');
    } finally {
      setAsrProvider(null);
    }
  }, 15_000);

  it('plays "one moment" while the farmer’s own voice is still being made, then goes on', async () => {
    const f = farmer();
    await dialUssd(f.phone, ['1', '8']);
    setTtsProvider({ name: 'mock', synthesize: async () => null, isPending: () => true });
    try {
      const call = new Call(f.phone);
      await call.answer(listingCall(f.phone));
      expect(call.xml).toContain('<Redirect>');
      expect(call.text).toContain('One moment');
      await call.followRedirect();
      expect(call.xml).toContain('<Redirect>');
      await call.followRedirect();
      // After two holds the step is spoken anyway, by the gateway voice.
      expect(call.xml).not.toContain('<Redirect>');
      expect(call.text).toContain('You are about to list produce');
    } finally {
      setTtsProvider(null);
    }
  });
});

describe('listings and offers by voice (vision §5.5, §8)', () => {
  it('the listing line: hear a listing, change its price and quantity, mark it sold', async () => {
    const f = farmer();
    const lot = registerLot({ farmerId: f.id, commodityCode: 'RICE', unitCode: 'BAG_50KG', unitQty: 10, declaredBand: 'B', askingPricePerUnit: 40000, channel: 'ussd' });
    const call = new Call(f.phone);
    await call.dialLine();
    expect(call.text).toContain('Welcome to Farm to Market, Voice Farmer.');
    await call.press('2');
    expect(call.text).toContain('Listing 1 of 1: 10 50kg bag of Rice at GHS 400.00 each.');

    await call.press('2'); // price
    await call.press('350');
    expect(call.text).toContain('Done. Your listing is updated.');
    expect(getLot(lot.id).askingPricePerUnit).toBe(35000);

    await call.press('1'); // quantity left to sell
    await call.press('8');
    expect(getLot(lot.id).remainingKg).toBe(400);
    expect(call.text).toContain('8 50kg bag of Rice at GHS 350.00');

    await call.press('4'); // sold elsewhere
    await call.press('1');
    expect(getLot(lot.id).status).toBe('sold');
    expect(call.text).toContain('You have no listings on the market.');
    await call.press('0');
    expect(call.text).toContain('Press 1 to sell produce.');
  });

  it('an offer call: 3 counters by voice in one sentence, read back, sent', async () => {
    const f = farmer();
    const lot = registerLot({ farmerId: f.id, commodityCode: 'RICE', unitCode: 'BAG_50KG', unitQty: 12, declaredBand: 'B', channel: 'ussd' });
    const offer = placeBid({ buyerId: testBuyer().id, lotId: lot.id, units: 10, pricePerUnit: 190000 });
    const callRow = listVoiceCallsForPhone(f.phone, 5).find((c) => c.flow === 'bid' && c.offerId === offer.id)!;

    const call = new Call(f.phone);
    await call.answer(callRow.id);
    expect(call.text).toContain('offers 10 50kg bag of your Rice at GHS 1900.00 each');
    expect(call.text).toContain('Press 3 to make a counter offer');
    await call.press('3');
    await call.say('I can sell the 10 bags, but I want 2,100 cedis per bag');
    expect(call.text).toContain('You will offer 10 50kg bag at GHS 2100.00 each, GHS 21000.00 in all.');
    await call.press('1');
    expect(call.ended).toBe(true);
    expect(call.text).toContain('Your offer was sent to Accra Fresh Markets Ltd');
    expect(getOffer(offer.id)).toMatchObject({ turn: 'buyer', units: 10, pricePerUnit: 210000, proposedBy: 'farmer' });
  });

  it('a typed counter keeps the quantity on 0; the line hears waiting offers one after another', async () => {
    const f = farmer();
    const lot = registerLot({ farmerId: f.id, commodityCode: 'RICE', unitCode: 'BAG_50KG', unitQty: 20, declaredBand: 'B', channel: 'ussd' });
    const first = placeBid({ buyerId: testBuyer().id, lotId: lot.id, units: 5, pricePerUnit: 180000 });
    const other = registerBuyer({ phone: nextPhone(), name: 'Second buyer', company: 'Tamale Grain Traders', regionCode: 'NORTHERN' });
    const second = placeBid({ buyerId: other.id, lotId: lot.id, units: 4, pricePerUnit: 185000 });

    const call = new Call(f.phone);
    await call.dialLine();
    expect(call.text).toContain('Offers waiting for your answer: 2.');
    await call.press('3');
    await call.press('1');
    // Newest first.
    expect(call.text).toContain('Tamale Grain Traders offers 4');
    await call.press('3');
    await call.press('2050');
    await call.press('0'); // keep 4
    expect(call.text).toContain('You will offer 4 50kg bag at GHS 2050.00 each');
    await call.press('1');
    // Back on the line, not hung up: the next waiting offer.
    expect(call.ended).toBe(false);
    expect(call.text).toContain('Your offer was sent to Tamale Grain Traders');
    expect(getOffer(second.id)).toMatchObject({ turn: 'buyer', units: 4, pricePerUnit: 205000 });

    await call.press('1');
    expect(call.text).toContain('Accra Fresh Markets Ltd offers 5');
    await call.press('2');
    expect(call.text).toContain('You turned down the offer');
    expect(getOffer(first.id).status).toBe('rejected');
    expect(call.text).toContain('No offers are waiting for your answer.');
  });
});

describe('transport and dates by USSD (vision §10.2, §5.5)', () => {
  it('a secured order shows "Ask for transport", which asks the buyer to approve it', async () => {
    const f = farmer();
    const lot = registerLot({ farmerId: f.id, commodityCode: 'RICE', unitCode: 'BAG_50KG', unitQty: 6, declaredBand: 'B', channel: 'ussd' });
    placeBid({ buyerId: testBuyer().id, lotId: lot.id, units: 6, pricePerUnit: 190000 });
    await acceptFor(f.id, lot.id);
    await pollPaymentsOnce();

    const pick = String(listLotsByFarmer(f.id).slice(0, 5).findIndex((l) => l.id === lot.id) + 1);
    const detail = await dialUssd(f.phone, ['3', pick]);
    expect(detail).toContain('2. Ask for transport');
    const done = await dialUssd(f.phone, ['3', pick, '2']);
    expect(done).toContain('Your buyer has been asked to approve and pay for transport');
    expect(getTrace(lot.id).map((e) => e.type)).toContain('TRANSPORT_SUGGESTED');
  });

  it('an open listing can change its ready date', async () => {
    const f = farmer();
    const lot = registerLot({ farmerId: f.id, commodityCode: 'RICE', unitCode: 'BAG_50KG', unitQty: 3, declaredBand: 'B', channel: 'ussd' });
    const pick = String(listLotsByFarmer(f.id).slice(0, 5).findIndex((l) => l.id === lot.id) + 1);
    const screen = await dialUssd(f.phone, ['3', pick, '5']);
    expect(screen).toContain('In 1 week');
    const done = await dialUssd(f.phone, ['3', pick, '5', '3']);
    expect(done).toContain('updated');
    expect(getLot(lot.id).readyDate).toBeGreaterThan(Date.now() + 6 * 24 * 3600_000);
  });
});
