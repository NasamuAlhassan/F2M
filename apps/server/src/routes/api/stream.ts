import { audienceKeys, getAccountByAuthUser, subscribeLive, type LiveTopic } from '@ftm/core';
import type { FastifyInstance } from 'fastify';

/** A connection is closed after this long so the client reconnects with a fresh login token. */
const MAX_LIFETIME_MS = 30 * 60 * 1000;
const HEARTBEAT_MS = 25_000;
/** Events inside this window are sent as one message, so a burst of changes is one refresh. */
const COALESCE_MS = 250;
const MAX_CONNECTIONS_PER_PERSON = 4;

const open = new Map<string, Array<() => void>>();

/**
 * Live updates (D-054): `GET /api/stream` is a server-sent-events stream. Each
 * message names the topics that changed ("market", "prices", "offers"…) and
 * nothing else; the client re-reads whatever it shows through the normal,
 * authenticated API. The bearer token goes in the Authorization header (the
 * browser's `EventSource` cannot set one, so the web app streams with `fetch`).
 */
export async function streamRoutes(app: FastifyInstance): Promise<void> {
  app.get('/stream', { preHandler: [app.authAnyRole] }, async (req, reply) => {
    const account = await getAccountByAuthUser(req.user.authUserId);
    const keys = audienceKeys({ role: req.user.kind, id: req.user.sub, phone: account?.phone ?? null });

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // proxies must not hold the stream back
    });
    res.write('retry: 3000\n: connected\n\n');

    const pending = new Set<LiveTopic>();
    let flushTimer: NodeJS.Timeout | null = null;
    const unsubscribe = subscribeLive(keys, (event) => {
      pending.add(event.topic);
      if (flushTimer) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        const topics = [...pending];
        pending.clear();
        res.write(`event: live\ndata: ${JSON.stringify({ topics })}\n\n`);
      }, COALESCE_MS);
    });
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), HEARTBEAT_MS);
    const lifetime = setTimeout(() => res.end(), MAX_LIFETIME_MS);

    let closed = false;
    const person = `${req.user.kind}:${req.user.sub}`;
    const close = () => {
      if (closed) return;
      closed = true;
      unsubscribe();
      clearInterval(heartbeat);
      clearTimeout(lifetime);
      if (flushTimer) clearTimeout(flushTimer);
      const mine = (open.get(person) ?? []).filter((c) => c !== close);
      if (mine.length > 0) open.set(person, mine);
      else open.delete(person);
      if (!res.writableEnded) res.end();
    };
    res.on('close', close);
    res.on('error', close);

    // One person with many tabs open: the oldest stream makes way.
    const mine = [...(open.get(person) ?? []), close];
    while (mine.length > MAX_CONNECTIONS_PER_PERSON) mine.shift()!();
    open.set(person, mine);
  });
}
