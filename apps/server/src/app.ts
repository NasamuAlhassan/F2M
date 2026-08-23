import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import formbody from '@fastify/formbody';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { config, DomainError } from '@ftm/core';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { authRoutes } from './routes/api/auth';
import { demandRoutes } from './routes/api/demands';
import { farmerRoutes } from './routes/api/farmers';
import { lotRoutes } from './routes/api/lots';
import { contractRoutes } from './routes/api/contracts';
import { devRoutes } from './routes/api/dev';
import { logisticsRoutes } from './routes/api/logistics';
import { notificationRoutes } from './routes/api/notifications';
import { registryRoutes } from './routes/api/registries';
import { momoCallbackRoutes } from './routes/momoCallbacks';
import { ussdRoutes } from './routes/ussd';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function buildServer(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? true });

  await app.register(formbody); // Africa's Talking posts form-encoded USSD payloads
  await app.register(multipart, { limits: { fileSize: 15 * 1024 * 1024, files: 5 } });
  await app.register(jwt, { secret: config.JWT_SECRET });
  await app.register(fastifyStatic, { root: path.join(SERVER_ROOT, 'public') });
  fs.mkdirSync(path.join(config.storageDir, 'photos'), { recursive: true });
  await app.register(fastifyStatic, {
    root: path.join(config.storageDir, 'photos'),
    prefix: '/photos/',
    decorateReply: false,
  });

  // Role-checked guards — a valid JWT of the WRONG kind must not pass (D-021).
  app.decorate('authBuyer', async (req, reply) => {
    try {
      await req.jwtVerify();
      if (req.user.kind !== 'buyer') throw new Error('wrong role');
    } catch {
      await reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Buyer login required' } });
    }
  });
  app.decorate('authDriver', async (req, reply) => {
    try {
      await req.jwtVerify();
      if (req.user.kind !== 'driver') throw new Error('wrong role');
    } catch {
      await reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Driver login required' } });
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof DomainError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    }
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: { code: 'VALIDATION', issues: err.issues } });
    }
    req.log.error(err);
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Internal server error' } });
  });

  app.get('/health', async () => ({ ok: true }));

  await app.register(ussdRoutes);
  await app.register(momoCallbackRoutes);
  await app.register(authRoutes, { prefix: '/api' });
  await app.register(registryRoutes, { prefix: '/api' });
  await app.register(farmerRoutes, { prefix: '/api' });
  await app.register(lotRoutes, { prefix: '/api' });
  await app.register(demandRoutes, { prefix: '/api' });
  await app.register(contractRoutes, { prefix: '/api' });
  await app.register(logisticsRoutes, { prefix: '/api' });
  await app.register(notificationRoutes, { prefix: '/api' });
  await app.register(devRoutes, { prefix: '/api' });

  return app;
}
