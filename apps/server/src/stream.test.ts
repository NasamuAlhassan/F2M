import { publishLive, registerFarmer, registerLot, liveListenerCount } from '@ftm/core';
import { testBuyer, testBuyerToken } from '@ftm/core/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from './app';

let app: FastifyInstance;
let base: string;
const open: Array<() => void> = [];

beforeAll(async () => {
  app = await buildServer({ logger: false });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});
afterAll(async () => {
  for (const close of open) close();
  await app.close();
});

/** Open the stream and return a reader that yields the next "live" message's topics. */
async function connect(token: string) {
  const controller = new AbortController();
  const res = await fetch(`${base}/api/stream`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // One read in flight at a time: abandoning a read that lost a timeout race would let it swallow the next chunk.
  let inFlight: ReturnType<typeof reader.read> | null = null;
  async function next(timeoutMs = 2000): Promise<string[] | null> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const m = /event: live\ndata: (.*)\n\n/.exec(buffer);
      if (m) {
        buffer = buffer.slice(buffer.indexOf(m[0]) + m[0].length);
        return (JSON.parse(m[1]!) as { topics: string[] }).topics;
      }
      const left = deadline - Date.now();
      if (left <= 0) return null;
      inFlight ??= reader.read();
      const chunk = await Promise.race([inFlight, new Promise<null>((r) => setTimeout(() => r(null), left))]);
      if (chunk === null) return null; // the read stays in flight for the next call
      inFlight = null;
      if (chunk.done) return null;
      buffer += decoder.decode(chunk.value);
    }
  }
  open.push(() => controller.abort());
  return { next, close: () => controller.abort() };
}

describe('GET /api/stream', () => {
  it('needs a login', async () => {
    const res = await fetch(`${base}/api/stream`);
    expect(res.status).toBe(401);
  });

  it('tells a signed-in person when the market changes, naming only the topic', async () => {
    const stream = await connect(testBuyerToken());
    const farmer = registerFarmer({ phone: '+233207540001', name: 'Live Farmer', regionCode: 'ASHANTI' });
    registerLot({ farmerId: farmer.id, commodityCode: 'PLANTAIN', unitCode: 'BUNCH', unitQty: 3, declaredBand: 'B' });
    const topics = await stream.next();
    expect(topics).toContain('market');
    stream.close();
  });

  it('sends a burst of changes as one message', async () => {
    const stream = await connect(testBuyerToken());
    for (let i = 0; i < 5; i += 1) publishLive({ topic: 'prices', audience: ['all'] });
    publishLive({ topic: 'market', audience: ['all'] });
    const first = await stream.next();
    expect(first!.sort()).toEqual(['market', 'prices']);
    stream.close();
  });

  it('delivers a private event only to the person it is for', async () => {
    const stream = await connect(testBuyerToken());
    publishLive({ topic: 'notifications', audience: ['buyer:someone-else'] });
    expect(await stream.next(600)).toBeNull();
    publishLive({ topic: 'notifications', audience: [`buyer:${testBuyer().id}`] });
    expect(await stream.next()).toEqual(['notifications']);
    stream.close();
  });

  it('stops listening for a person who disconnects', async () => {
    await new Promise((r) => setTimeout(r, 300)); // let earlier tests' streams finish closing
    const before = liveListenerCount();
    const stream = await connect(testBuyerToken());
    expect(liveListenerCount()).toBe(before + 1);
    stream.close();
    await new Promise((r) => setTimeout(r, 300));
    expect(liveListenerCount()).toBe(before);
  });
});
