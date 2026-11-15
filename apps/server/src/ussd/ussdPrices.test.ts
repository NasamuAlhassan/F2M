import { getCommodityByCode, recordPrice, registerFarmer } from '@ftm/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { handleUssdRequest } from './index';

const PHONE = '+233209990042';
const DAY = 24 * 60 * 60 * 1000;

async function dial(phone: string, inputs: string[]): Promise<string[]> {
  const sessionId = `test-${Math.random().toString(36).slice(2)}`;
  const responses: string[] = [await handleUssdRequest({ sessionId, phoneNumber: phone, text: '' })];
  const history: string[] = [];
  for (const input of inputs) {
    history.push(input);
    responses.push(await handleUssdRequest({ sessionId, phoneNumber: phone, text: history.join('*') }));
    if (responses[responses.length - 1]!.startsWith('END')) break;
  }
  return responses;
}

beforeAll(async () => {
  await registerFarmer({ phone: PHONE, name: 'Price Farmer', regionCode: 'ASHANTI' });
  // A run of recent maize deals around GHS 4/kg — GHS 400 for a 100 kg bag.
  const maize = getCommodityByCode('MAIZE').id;
  for (let i = 0; i < 6; i += 1) {
    await recordPrice({ commodityId: maize, pricePerKg: 400 + i, source: 'deal', regionCode: 'ASHANTI', refId: `ussd-maize-${i}`, observedAt: Date.now() - (i + 1) * DAY });
  }
});

describe('USSD market prices with live data (D-053)', () => {
  it('leads with the live price for the crop', async () => {
    const responses = await dial('+233559990077', ['3', '1']); // an unregistered phone browses maize
    const prices = responses[responses.length - 1]!;
    expect(prices).toContain('Latest Maize prices:');
    expect(prices).toMatch(/Market price \(per kg\): GHS 4\.\d\d/);
  });
});

describe('USSD sell flow with price advice (D-053)', () => {
  // sell > maize > 100kg bag > 5 > grade B > ready now
  const toPrice = ['1', '1', '1', '5', '2', '1'];

  it('shows what the crop has been fetching before the farmer names a price', async () => {
    const responses = await dial(PHONE, toPrice);
    const priceScreen = responses[responses.length - 1]!;
    expect(priceScreen).toContain('Recent prices: GHS 3');
    expect(priceScreen).toMatch(/to GHS 4/);
  });

  it('warns before confirming when the price is far off the market', async () => {
    const responses = await dial(PHONE, [...toPrice, '900']); // GHS 900 a bag vs ~GHS 400
    const confirm = responses[responses.length - 1]!;
    expect(confirm).toContain('Far above the market');
    expect(confirm).toContain('1. Confirm'); // a warning, not a block: it is still her choice
  });

  it('stays quiet for a sensible price', async () => {
    const responses = await dial(PHONE, [...toPrice, '410']);
    const confirm = responses[responses.length - 1]!;
    expect(confirm).not.toContain('above the market');
    expect(confirm).not.toContain('below the market');
  });

  it('still lets her list at the odd price', async () => {
    const responses = await dial(PHONE, [...toPrice, '900', '1']);
    expect(responses[responses.length - 1]).toMatch(/^END/);
  });
});
