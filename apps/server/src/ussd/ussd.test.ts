import {
  createDemand,
  getFarmerByPhone,
  listContractsForFarmer,
  listLotsByFarmer,
  verifyBuyerLogin,
} from '@ftm/core';
import { describe, expect, it } from 'vitest';
import { handleUssdRequest } from './index';

const PHONE = '+233209998877';

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

    const farmer = getFarmerByPhone(PHONE);
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
    // home > sell > MAIZE(1) > OLONKA(3) > qty 200 > band B(2) > ready now(1) > confirm(1)
    const responses = await dial(PHONE, ['1', '1', '3', '200', '2', '1', '1']);
    const last = responses[responses.length - 1]!;
    expect(last).toMatch(/^END Lot FTM-/);
    expect(last).toContain('200 Olonka of Maize');

    const farmer = getFarmerByPhone(PHONE)!;
    const lots = listLotsByFarmer(farmer.id);
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
    const [, bad] = await dial(PHONE, ['7']);
    expect(bad).toContain('Invalid choice');
    expect(bad).toContain('1. Sell produce'); // same screen re-rendered
  });

  it('shows an offer with the price-per-grade table and accepts it (M3)', async () => {
    const buyer = verifyBuyerLogin('buyer@demo.ftm', 'demo-buyer-2026');
    const now = Date.now();
    // Demand more than every maize lot combined so Ama's 500kg lot is offered
    // regardless of which other fixture lots exist when this file runs.
    createDemand({
      buyerId: buyer.id,
      commodityCode: 'MAIZE',
      quantityKg: 5000,
      minBand: 'B',
      basePricePerKg: 440, // pesewas/kg: B GHS 4.40, A GHS 5.00
      windowStart: now,
      windowEnd: now + 7 * 24 * 60 * 60 * 1000,
      regionCode: 'GREATER_ACCRA',
    });

    // Home now shows the badge; open offers > detail > accept.
    const [home, list, detail, done] = await dial(PHONE, ['2', '1', '1']);
    expect(home).toContain('2. My offers (1)');
    expect(list).toContain('500kg Maize');
    expect(detail).toContain('Offer: 500kg Maize for Accra Fresh Markets Ltd');
    expect(detail).toContain('Price/kg: A GHS 5.00, B GHS 4.40, C GHS 3.50');
    expect(detail).toContain('1. Accept');
    expect(done).toMatch(/^END Accepted/);
    expect(done).toContain('GHS 2500.00'); // 500kg x GHS 5.00 best-band hold

    const farmer = getFarmerByPhone(PHONE)!;
    const accepted = listContractsForFarmer(farmer.id, ['ACCEPTED']);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.holdAmount).toBe(500 * 500);
  });
});
