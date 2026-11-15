import {
  addPhoto,
  createDemand,
  confirmReceipt,
  getContract,
  getDemand,
  getFarmerByPhone,
  getLot,
  getOffer,
  listContractsForFarmer,
  listLotsByFarmer,
  listNotificationsForPhone,
  listOffersForFarmer,
  MockPaymentProvider,
  placeBid,
  pollPaymentsOnce,
  registerFarmer,
  registerLot,
  runGrading,
  setDraftLocalesLive,
  tDraft,
  setGradingProvider,
  setPaymentProvider,
} from '@ftm/core';
import { testBuyer } from '@ftm/core/testing';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleUssdRequest } from './index';

const PHONE = '+233209998877';

beforeAll(() => {
  setPaymentProvider(new MockPaymentProvider(0));
});
afterAll(() => {
  setPaymentProvider(null);
  setGradingProvider(null);
});

/** Drive a full USSD session the way the gateway would: cumulative '*'-joined text. */
async function dial(phone: string, inputs: string[]): Promise<string[]> {
  const sessionId = `test-${Math.random().toString(36).slice(2)}`;
  const responses: string[] = [];
  responses.push(await handleUssdRequest({ sessionId, phoneNumber: phone, text: '' }));
  const history: string[] = [];
  for (const input of inputs) {
    history.push(input);
    responses.push(await handleUssdRequest({ sessionId, phoneNumber: phone, text: history.join('*') }));
    if (responses[responses.length - 1]!.startsWith('END')) break;
  }
  return responses;
}

describe('USSD flows (M2)', () => {
  it('walks an unregistered farmer through registration', async () => {
    const responses = await dial(PHONE, ['1', 'Ama Serwaa', '9', '2', 'Tolon', '1']);
    expect(responses[0]).toMatch(/^CON Welcome to Farm to Market/);
    expect(responses[1]).toContain('Enter your full name');
    expect(responses[2]).toContain('Select your region'); // page 1
    expect(responses[3]).toContain('Select your region'); // page 2 after '9. More'
    expect(responses[3]).toContain('Northern');
    expect(responses[4]).toContain('district');
    expect(responses[5]).toContain('Register as Ama Serwaa, Northern?');
    expect(responses[6]).toMatch(/^END Welcome to Farm to Market, Ama Serwaa/);

    const farmer = await getFarmerByPhone(PHONE);
    expect(farmer).toBeDefined();
    expect(farmer!.regionCode).toBe('NORTHERN');
    expect(farmer!.district).toBe('Tolon');
  });

  it('shows the registered home menu on re-dial', async () => {
    const [first] = await dial(PHONE, []);
    expect(first).toContain('Hello Ama Serwaa');
    expect(first).toContain('1. Sell produce');
  });

  it('lists a maize lot in olonka end to end', async () => {
    // home > sell > MAIZE(1) > OLONKA(3) > qty 200 > band B(2) > ready now(1) > price 0 (let buyers bid) > confirm(1)
    const responses = await dial(PHONE, ['1', '1', '3', '200', '2', '1', '0', '1']);
    // Phase 1 asks for her own price per unit after the ready date.
    expect(responses[6]).toContain('Your price per Olonka in GHS. Send 0 to let buyers make offers.');
    const last = responses[responses.length - 1]!;
    expect(last).toMatch(/^END Lot FTM-/);
    expect(last).toContain('200 Olonka of Maize');

    const farmer = (await getFarmerByPhone(PHONE))!;
    const lots = await listLotsByFarmer(farmer.id);
    expect(lots).toHaveLength(1);
    expect(lots[0]!.quantityKg).toBe(500); // 200 x 2.5kg
    expect(lots[0]!.declaredBand).toBe('B');
  });

  it('gives tomato only today/tomorrow ready choices (perishable clock)', async () => {
    const responses = await dial(PHONE, ['1', '2', '1', '10', '1']);
    const readyScreen = responses[responses.length - 1]!;
    expect(readyScreen).toContain('1. Today');
    expect(readyScreen).toContain('2. Tomorrow');
    expect(readyScreen).not.toContain('week');
  });

  it('shows lots and empty offers/payments', async () => {
    const [, lotsScreen] = await dial(PHONE, ['3']);
    expect(lotsScreen).toContain('My lots:');
    expect(lotsScreen).toContain('500kg Maize');

    const [, offersScreen] = await dial(PHONE, ['2']);
    expect(offersScreen).toContain('No offers yet');

    const [, payScreen] = await dial(PHONE, ['4']);
    expect(payScreen).toContain('No payments yet');
  });

  it('re-renders with an error line on invalid input', async () => {
    const [, bad] = await dial(PHONE, ['9']); // 7 became the language menu (M30)
    expect(bad).toContain('Invalid choice');
    expect(bad).toContain('1. Sell produce'); // same screen re-rendered
  });

  it('lets an UNREGISTERED phone browse market prices (M10)', async () => {
    const [welcome, commodityList, prices] = await dial('+233559990001', ['3', '1']);
    expect(welcome).toContain('3. Market prices'); // no registration gate on information
    expect(commodityList).toContain('Prices for which crop?');
    expect(prices).toContain('Latest Maize prices:');
    expect(prices).toContain('Techiman: GHS 3.80/kg');
    expect(prices).toContain('Agbogbloshie: GHS 4.60/kg');
  });

  it('reaches market prices from the registered home menu (M10)', async () => {
    const [home, , prices] = await dial(PHONE, ['5', '2']);
    expect(home).toContain('5. Market prices');
    expect(home).toContain('6. Help');
    expect(prices).toContain('Latest Tomato prices:');
  });

  it('shows a bid in her own unit at her declared grade’s price and accepts it (M3, Phase 1)', async () => {
    const buyer = await testBuyer();
    const now = Date.now();
    // Demand more than every maize lot combined so Ama's 500kg lot is bid on
    // regardless of which other fixture lots exist when this file runs.
    await createDemand({
            buyerId: buyer.id,
            commodityCode: 'MAIZE',
            quantityKg: 5000,
            minBand: 'B',
            basePricePerKg: 440, // pesewas/kg: B GHS 4.40, A GHS 5.00
            windowStart: now,
            windowEnd: now + 7 * 24 * 60 * 60 * 1000,
            regionCode: 'GREATER_ACCRA',
          });
    const farmer = (await getFarmerByPhone(PHONE))!;
    // A bid is an offer thread, not a contract: nothing exists to accept until she does.
    expect(await listContractsForFarmer(farmer.id)).toHaveLength(0);

    // Home shows the badge; open offers > detail > accept. The engine's bid is
    // whole olonkas at the request's price for her declared grade B:
    // GHS 4.40/kg × 2.5kg = GHS 11.00 each, 200 × GHS 11.00 = GHS 2200.00.
    const [home, list, detail, done] = await dial(PHONE, ['2', '1', '1']);
    expect(home).toContain('2. My offers (1)');
    expect(list).toContain('200 Olonka Maize at GHS 11.00 - your answer');
    expect(detail).toContain('Accra Fresh Markets Ltd offers 200 Olonka of Maize at GHS 11.00 each (GHS 2200.00).');
    expect(detail).toContain('1. Accept');
    expect(detail).toContain('2. Counter');
    expect(detail).toContain('3. Reject');
    expect(done).toMatch(/^END Deal agreed: 200 Olonka of Maize for GHS 2200.00/);

    // Accepting makes the order: ACCEPTED, holding exactly the agreed total.
    const accepted = await listContractsForFarmer(farmer.id, ['ACCEPTED']);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.holdAmount).toBe(200 * 1100);
    expect(accepted[0]!.agreedTotal).toBe(200 * 1100);
  });

  it('confirms pickup, sees the grade with its reason, and agrees — all on USSD (M5)', async () => {
    const farmer = (await getFarmerByPhone(PHONE))!;
    await pollPaymentsOnce(); // resolve the hold from the accept above
    const contract = (await listContractsForFarmer(farmer.id, ['FUNDS_HELD']))[0]!;

    // Lot detail now offers pickup confirmation.
    const [, , pickupScreen] = await dial(PHONE, ['3', '1']);
    expect(pickupScreen).toContain('1. Confirm pickup done');
    const [, , , done] = await dial(PHONE, ['3', '1', '1']);
    expect(done).toMatch(/^END Thank you. Pickup confirmed/);
    expect((await getContract(contract.id)).state).toBe('PICKUP_CONFIRMED');

    // Buyer-side photo + grading (the same domain calls the web portal makes).
    const buffer = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 220, g: 190, b: 90 } } })
      .jpeg()
      .toBuffer();
    await addPhoto({ contractId: contract.id, buffer, actor: { type: 'buyer', id: contract.buyerId } });
    // Graded C — below the B she declared. Phase 1 pays the agreed total
    // whatever the grade (only REJECT refunds), so the payout stays GHS 2200.00.
    setGradingProvider({
      name: 'mock',
      grade: async () => ({
        gradeBand: 'C',
        confidence: 0.88,
        reasons: [{ criterion: 'moisture', observation: 'some kernels still damp', bandForCriterion: 'C' }],
        provider: 'mock',
      }),
    });
    await runGrading(contract.id);

    // The farmer sees the grade, the money in two parts (Phase 3), and the reason — and agrees.
    const [, , gradeScreen] = await dial(PHONE, ['3', '1']);
    expect(gradeScreen).toContain('Graded Grade C. GHS 660.00 paid now, GHS 1540.00 when the buyer receives it.');
    expect(gradeScreen).toContain('Reason: some kernels still damp');
    expect(gradeScreen).toContain('1. Agree with the grade');
    const [, , , agreed] = await dial(PHONE, ['3', '1', '1']);
    expect(agreed).toContain('Your advance of GHS 660.00 is on its way to your MoMo');

    await pollPaymentsOnce();
    expect((await getContract(contract.id)).state).toBe('DELIVERED');
    const [, , waiting] = await dial(PHONE, ['3', '1']);
    expect(waiting).toContain('Waiting for the buyer to confirm');
    // The buyer receives it: the balance goes out and the order settles.
    await confirmReceipt(contract.id, { type: 'buyer', id: contract.buyerId });
    await pollPaymentsOnce();
    expect((await getContract(contract.id)).state).toBe('SETTLED');

    // And the payments screen now shows it.
    const [, payScreen] = await dial(PHONE, ['4']);
    // Two payouts since Phase 3: the advance at pickup and the balance on receipt.
    expect(payScreen).toContain('GHS 1540.00 - Paid');
    expect(payScreen).toContain('GHS 660.00 - Paid');
  });
});

describe('USSD negotiation, requests and listing management (Phase 1)', () => {
  const P2 = '+233209997001';
  const DAY = 24 * 60 * 60 * 1000;
  let farmerId: string;
  let lotId: string;

  beforeAll(async () => {
    // Rice lane: no other suite here touches it, so the engine stays out of the way.
    const farmer = await registerFarmer({ phone: P2, name: 'Akosua Rice', regionCode: 'NORTHERN' });
    farmerId = farmer.id;
    lotId = (await registerLot({
          farmerId,
          commodityCode: 'RICE',
          unitCode: 'BAG_50KG',
          unitQty: 10,
          declaredBand: 'B',
          askingPricePerUnit: 50000, // GHS 500.00 a bag
        })).id;
  });

  it('counters a buyer bid with a price typed on the keypad, then withdraws it', async () => {
    const offer = await placeBid({ buyerId: (await testBuyer()).id, lotId, units: 4, pricePerUnit: 40000 });

    // home > My offers > the bid > 2 Counter > GHS 450 > 0 keep 4 bags > 1 confirm
    const r = await dial(P2, ['2', '1', '2', '450', '0', '1']);
    expect(r[0]).toContain('2. My offers (1)');
    expect(r[1]).toContain('4 50kg bag Rice at GHS 400.00 - your answer');
    expect(r[2]).toContain('Accra Fresh Markets Ltd offers 4 50kg bag of Rice at GHS 400.00 each (GHS 1600.00).');
    expect(r[2]).toContain('You asked GHS 500.00 each.');
    expect(r[3]).toContain('Your price per 50kg bag in GHS (they offered GHS 400.00):');
    expect(r[4]).toContain('How many 50kg bag? Send 0 to keep 4.');
    expect(r[5]).toContain('Offer 4 50kg bag of Rice at GHS 450.00 each (GHS 1800.00)?');
    expect(r[6]).toMatch(/^END Sent to Accra Fresh Markets Ltd/);

    const countered = await getOffer(offer.id);
    expect(countered.turn).toBe('buyer');
    expect(countered.units).toBe(4);
    expect(countered.pricePerUnit).toBe(45000);

    // Now it waits on the buyer: no badge, and her only move is to withdraw.
    const [home, list, detail, done] = await dial(P2, ['2', '1', '1']);
    expect(home).not.toContain('My offers (');
    expect(list).toContain('4 50kg bag Rice at GHS 450.00 - waiting');
    expect(detail).toContain('You offered Accra Fresh Markets Ltd 4 50kg bag of Rice at GHS 450.00 each (GHS 1800.00).');
    expect(detail).toContain('1. Withdraw my offer');
    expect(done).toMatch(/^END Your offer was withdrawn/);
    expect((await getOffer(offer.id)).status).toBe('withdrawn');
  });

  it('rejects a bid with 3', async () => {
    const offer = await placeBid({ buyerId: (await testBuyer()).id, lotId, units: 2, pricePerUnit: 30000 });
    const [, , , done] = await dial(P2, ['2', '1', '3']);
    expect(done).toMatch(/^END You turned down the offer/);
    expect((await getOffer(offer.id)).status).toBe('rejected');
    expect(await listContractsForFarmer(farmerId)).toHaveLength(0);
  });

  it('changes the price and quantity of an open listing, then removes it', async () => {
    const [, , detail] = await dial(P2, ['3', '1']);
    expect(detail).toContain('Asking: GHS 500.00 each');
    expect(detail).toContain('1. Remove this listing');
    expect(detail).toContain('2. Change price');
    expect(detail).toContain('3. Change quantity');
    expect(detail).toContain('4. Sold elsewhere');

    const price = await dial(P2, ['3', '1', '2', '550']);
    expect(price[3]).toContain('New price per 50kg bag in GHS');
    expect(price[4]).toMatch(/^END FTM-\S+ updated\. It stays on the market for \d+ more days/);
    expect((await getLot(lotId)).askingPricePerUnit).toBe(55000);

    const qty = await dial(P2, ['3', '1', '3', '12']);
    expect(qty[4]).toMatch(/^END FTM-\S+ updated/);
    expect((await getLot(lotId)).quantityKg).toBe(600);

    const removed = await dial(P2, ['3', '1', '1', '1']);
    expect(removed[4]).toMatch(/^END FTM-\S+ has been removed from the market/);
    expect((await getLot(lotId)).status).toBe('withdrawn');
  });

  it('answers a buyer request from menu 8 with an offer on her own listing', async () => {
    // Ready in a month — past the request's one-week window, so the engine
    // makes no bid of its own and the farmer is the one who starts the thread.
    const forward = await registerLot({
          farmerId,
          commodityCode: 'RICE',
          unitCode: 'BAG_50KG',
          unitQty: 6,
          declaredBand: 'B',
          readyDate: Date.now() + 30 * DAY,
        });
    const demand = await createDemand({
          buyerId: (await testBuyer()).id,
          commodityCode: 'RICE',
          quantityKg: 200,
          minBand: 'B',
          basePricePerKg: 600,
          windowStart: Date.now(),
          windowEnd: Date.now() + 7 * DAY,
          regionCode: 'GREATER_ACCRA',
        });
    expect(await listOffersForFarmer(farmerId, 'open')).toHaveLength(0);

    const [home, requests = ''] = await dial(P2, ['8']);
    expect(home).toContain('8. Buyer requests');
    expect(requests).toContain('Buyers want:');
    const pick = /(\d)\. 200kg Rice - Accra Fresh Markets Ltd/.exec(requests)?.[1];
    expect(pick).toBeDefined();

    // request > 1 Offer my produce > lot 1 > 3 bags > GHS 620 > 1 confirm
    const r = await dial(P2, ['8', pick!, '1', '1', '3', '620', '1']);
    expect(r[2]).toContain('Accra Fresh Markets Ltd wants 200kg Rice, Grade B or better, about GHS 6.00/kg');
    expect(r[2]).toContain('1. Offer my produce');
    expect(r[3]).toContain(`${forward.lotCode} - 6 50kg bag left`);
    expect(r[4]).toContain('How many 50kg bag? Up to 4.'); // the request covers only 200kg = 4 bags
    expect(r[5]).toContain('Your price per 50kg bag in GHS:');
    expect(r[6]).toContain('Offer Accra Fresh Markets Ltd 3 50kg bag of Rice at GHS 620.00 each (GHS 1860.00)?');
    expect(r[7]).toMatch(/^END Sent to Accra Fresh Markets Ltd/);

    const [thread] = await listOffersForFarmer(farmerId, 'open');
    expect(thread).toMatchObject({ lotId: forward.id, demandId: demand.id, turn: 'buyer', units: 3, pricePerUnit: 62000 });
    expect((await getDemand(demand.id)).remainingKg).toBe(50); // the thread holds 150kg of the request
  });
});

describe('USSD language flows (M30, D-040)', () => {
  beforeAll(() => setDraftLocalesLive(true));
  afterAll(() => setDraftLocalesLive(null));

  it('a brand-new caller picks a language first, and the menu names each language in itself', async () => {
    const [first] = await dial('+233209990401', []);
    expect(first).toMatch(/^CON Choose your language/);
    expect(first).toContain('1. English');
    expect(first).toContain('2. Twi');
    expect(first).toContain('3. Eʋegbe');
    expect(first).toContain('4. Dagbanli');
  });

  it('a Twi choice renders the rest of the session in draft Twi and registration persists it', async () => {
    const phone = '+233209990402';
    // 2 = Twi → welcome renders in whatever the tw catalog holds for that key
    // today (draft or en fallback — drafting fills over time) → register.
    const responses = await dial(phone, ['2', '1', 'Yaw Mensah', '9', '2', 'Tolon', '1']);
    expect(responses[1]).toBe(`CON ${tDraft('tw', 'ussd.welcome.title')}\n${tDraft('tw', 'ussd.welcome.register')}\n${tDraft('tw', 'ussd.welcome.registerDriver')}\n${tDraft('tw', 'ussd.welcome.prices')}`);
    expect(responses[7]).toMatch(/^END/);
    const farmer = (await getFarmerByPhone(phone))!;
    expect(farmer.locale).toBe('tw');
    // The registration receipt rode the chosen locale (Twi catalog lacks
    // sms.registered → resolved from English under the per-key fallback).
    expect((await listNotificationsForPhone(phone)).some((n) => n.templateKey === 'sms.registered')).toBe(true);
  });

  it('home menu 7 changes a farmer language and confirms in the NEW language', async () => {
    const phone = '+233209990403';
    await dial(phone, ['1', '1', 'Ama Lang', '9', '2', 'Tolon', '1']); // register in English
    const [home, menu, done] = await dial(phone, ['7', '2']);
    expect(home).toContain('7. Language');
    expect(menu).toContain('Language for SMS and calls:');
    expect(done).toMatch(/^END/);
    expect(done).toContain('Twi'); // the endonym names the choice
    expect((await getFarmerByPhone(phone))!.locale).toBe('tw');
    // Round-trip back to English.
    const [, , back] = await dial(phone, ['7', '1']);
    expect(back).toMatch(/^END/);
    expect((await getFarmerByPhone(phone))!.locale).toBe('en');
  });

  it('with the gate closed, new callers see the plain welcome and no language menu', async () => {
    setDraftLocalesLive(null); // back to config default: only en is live
    const [first] = await dial('+233209990404', []);
    expect(first).toMatch(/^CON Welcome to Farm to Market/);
    const [home] = await dial(PHONE, []);
    expect(home).toContain('7. Language'); // the settings item stays, listing only English
    setDraftLocalesLive(true);
  });
});
