import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { accountRoleId, config, DomainError, getAccountByAuthUser, verifyAccessToken } from '@ftm/core';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { accountRoutes } from './routes/api/account';
import { demandRoutes } from './routes/api/demands';
import { lotRoutes } from './routes/api/lots';
import { contractRoutes } from './routes/api/contracts';
import { devRoutes } from './routes/api/dev';
import { engineRoutes } from './routes/api/engine';
import { logisticsRoutes } from './routes/api/logistics';
import { marketRoutes } from './routes/api/market';
import { farmerPortalRoutes } from './routes/api/farmerPortal';
import { notificationRoutes } from './routes/api/notifications';
import { publicRoutes } from './routes/api/public';
import { registryRoutes } from './routes/api/registries';
import type { Role } from './types';
import { ussdRoutes } from './routes/ussd';
import { voiceRoutes } from './routes/voice';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Zod's issue list as one sentence a person can act on, naming the field. */
function zodMessage(err: ZodError): string {
  const parts = err.issues.slice(0, 3).map((i) => {
    const field = i.path.filter((p) => typeof p !== 'number').join('.');
    return field ? `${field}: ${i.message}` : i.message;
  });
  const rest = err.issues.length - parts.length;
  return parts.join('; ') + (rest > 0 ? ` (+${rest} more)` : '');
}

export async function buildServer(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? true });

  await app.register(formbody); // Africa's Talking posts form-encoded USSD payloads
  await app.register(multipart, { limits: { fileSize: 15 * 1024 * 1024, files: 5 } });
  // The USSD/IVR tester pages are simulator surfaces (D-047): gone when it is off.
  if (!config.simulatorEnabled) {
    app.addHook('onRequest', async (req, reply) => {
      if (/^\/(ussd|ivr)-tester\.html/.test(req.url)) {
        await reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
      }
    });
  }
  await app.register(fastifyStatic, { root: path.join(SERVER_ROOT, 'public') });
  fs.mkdirSync(path.join(config.storageDir, 'photos'), { recursive: true });
  await app.register(fastifyStatic, {
    root: path.join(config.storageDir, 'photos'),
    prefix: '/photos/',
    decorateReply: false,
  });
  // Cached TTS audio for IVR <Play> (D-040, D-045) — synthesized once per phrase.
  fs.mkdirSync(path.join(config.storageDir, 'tts'), { recursive: true });
  await app.register(fastifyStatic, {
    root: path.join(config.storageDir, 'tts'),
    prefix: '/tts/',
    decorateReply: false,
  });
  // Handset simulator mic recordings (D-038) — the browser's real-audio path
  // into the ASR provider, served back out so it can fetch() the blob.
  fs.mkdirSync(path.join(config.storageDir, 'recordings'), { recursive: true });
  await app.register(fastifyStatic, {
    root: path.join(config.storageDir, 'recordings'),
    prefix: '/recordings/',
    decorateReply: false,
    // A .webm extension is guessed as video/webm, and an ASR provider that
    // forwards the content-type verbatim gets refused for sending video to a
    // speech endpoint. These files are MediaRecorder audio with no video
    // track, so say so — otherwise every real recording 400s.
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.webm')) res.header('content-type', 'audio/webm');
    },
  });

  // Web logins (D-047): verify the Supabase token, then the account behind
  // it. A valid login of the WRONG role must not pass (D-021).
  async function readLogin(req: FastifyRequest): Promise<boolean> {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) return false;
    try {
      req.login = await verifyAccessToken(token);
      return true;
    } catch (err) {
      if (err instanceof DomainError && err.code === 'AUTH_NOT_CONFIGURED') throw err;
      return false;
    }
  }
  const unauthorized = (reply: FastifyReply, message: string) =>
    reply.code(401).send({ error: { code: 'UNAUTHORIZED', message } });
  const roleGuard = (roles: Role[], message: string) => async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await readLogin(req))) return unauthorized(reply, message);
    const account = getAccountByAuthUser(req.login.authUserId);
    if (!account || !roles.includes(account.role)) return unauthorized(reply, message);
    req.user = { sub: accountRoleId(account), kind: account.role, authUserId: account.authUserId };
  };
  app.decorateRequest('user', null as unknown as FastifyRequest['user']);
  app.decorateRequest('login', null as unknown as FastifyRequest['login']);
  app.decorate('authLogin', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await readLogin(req))) return unauthorized(reply, 'Sign in required');
  });
  app.decorate('authBuyer', roleGuard(['buyer'], 'Buyer login required'));
  app.decorate('authDriver', roleGuard(['driver'], 'Driver login required'));
  app.decorate('authFarmer', roleGuard(['farmer'], 'Farmer login required'));
  app.decorate('authBuyerOrFarmer', roleGuard(['buyer', 'farmer'], 'Login required'));

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof DomainError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    }
    if (err instanceof ZodError) {
      // `issues` alone left every validation failure rendering as the client's
      // "Request failed (400)" fallback (api.ts reads error.message only), so
      // the user was told a number was wrong but never which one. Name the
      // field and say what it wanted; keep `issues` for programmatic callers.
      return reply.code(400).send({ error: { code: 'VALIDATION', message: zodMessage(err), issues: err.issues } });
    }
    req.log.error(err);
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Internal server error' } });
  });

  app.get('/health', async () => ({ ok: true }));

  await app.register(ussdRoutes);
  await app.register(voiceRoutes);
  await app.register(accountRoutes, { prefix: '/api' });
  await app.register(registryRoutes, { prefix: '/api' });
  await app.register(lotRoutes, { prefix: '/api' });
  await app.register(demandRoutes, { prefix: '/api' });
  await app.register(contractRoutes, { prefix: '/api' });
  await app.register(logisticsRoutes, { prefix: '/api' });
  await app.register(notificationRoutes, { prefix: '/api' });
  await app.register(engineRoutes, { prefix: '/api' });
  await app.register(marketRoutes, { prefix: '/api' });
  await app.register(farmerPortalRoutes, { prefix: '/api' });
  await app.register(publicRoutes, { prefix: '/api' });
  // Simulator surfaces (D-047): the handset's SMS/call inboxes and the test clock.
  if (config.simulatorEnabled) await app.register(devRoutes, { prefix: '/api' });

  // In production the built portal ships inside public/ (see Dockerfile), so
  // client-side routes must survive a hard refresh — a buyer scanning a QR
  // lands on /t/:lotId directly, with no SPA loaded to route it. Anything that
  // isn't an API call, a provider webhook, or a static asset falls back to
  // index.html. Locally that file is absent (Vite serves the portal on :5173)
  // and the honest 404 stands instead.
  const portalIndex = path.join(SERVER_ROOT, 'public', 'index.html');
  const hasPortal = fs.existsSync(portalIndex);
  const WIRE_PREFIXES = ['/api', '/ussd', '/voice', '/photos', '/tts', '/recordings', '/health'];
  app.setNotFoundHandler((req, reply) => {
    const isPageRequest =
      (req.method === 'GET' || req.method === 'HEAD') &&
      !WIRE_PREFIXES.some((p) => req.url === p || req.url.startsWith(`${p}/`) || req.url.startsWith(`${p}?`));
    if (hasPortal && isPageRequest) {
      return reply.type('text/html').send(fs.createReadStream(portalIndex));
    }
    return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });

  return app;
}
