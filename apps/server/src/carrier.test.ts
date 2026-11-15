import { carrierCallbackUrl, carrierRequestAllowed, config } from '@ftm/core';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from './buildServer';

let app: FastifyInstance;
const original = { simulatorEnabled: config.simulatorEnabled, token: config.CARRIER_WEBHOOK_TOKEN };

beforeAll(async () => {
  app = await buildServer({ logger: false });
});
afterAll(async () => {
  await app.close();
});
afterEach(() => {
  config.simulatorEnabled = original.simulatorEnabled;
  config.CARRIER_WEBHOOK_TOKEN = original.token;
});

async function dialUssd(query = '') {
  return app.inject({
    method: 'POST',
    url: `/ussd${query}`,
    payload: new URLSearchParams({ sessionId: `carrier-${Math.random()}`, phoneNumber: '+233207480001', text: '' }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
}

describe('the carrier boundary (D-047)', () => {
  it('while the simulator is on, the USSD and voice wires answer anyone — the closed test group', async () => {
    config.simulatorEnabled = true;
    const res = await dialUssd();
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatch(/^CON /);
  });

  it('with the simulator off, only callbacks carrying the secret token get through', async () => {
    config.simulatorEnabled = false;
    config.CARRIER_WEBHOOK_TOKEN = 'carrier-secret-1';

    expect((await dialUssd()).statusCode).toBe(403);
    expect((await dialUssd('?token=wrong')).statusCode).toBe(403);
    const ok = await dialUssd('?token=carrier-secret-1');
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toMatch(/^CON /);

    const voice = await app.inject({
      method: 'POST',
      url: '/voice/answer',
      payload: new URLSearchParams({ callerNumber: '+233207480001' }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(voice.statusCode).toBe(403);
  });

  it('every callback URL F2M hands the carrier carries the token', () => {
    config.CARRIER_WEBHOOK_TOKEN = 'carrier-secret-2';
    const url = new URL(carrierCallbackUrl('/voice/answer?callId=abc'));
    expect(url.pathname).toBe('/voice/answer');
    expect(url.searchParams.get('callId')).toBe('abc');
    expect(url.searchParams.get('token')).toBe('carrier-secret-2');
  });

  it('refuses everything when the simulator is off and no token is configured', () => {
    config.simulatorEnabled = false;
    config.CARRIER_WEBHOOK_TOKEN = undefined;
    expect(carrierRequestAllowed(undefined)).toBe(false);
    expect(carrierRequestAllowed('')).toBe(false);
  });
});
