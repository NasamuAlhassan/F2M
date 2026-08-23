import formbody from '@fastify/formbody';
import jwt from '@fastify/jwt';
import { config, DomainError } from '@ftm/core';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { authRoutes } from './routes/api/auth';
import { demandRoutes } from './routes/api/demands';
import { farmerRoutes } from './routes/api/farmers';
import { lotRoutes } from './routes/api/lots';
import { registryRoutes } from './routes/api/registries';

export async function buildServer(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? true });

  await app.register(formbody); // Africa's Talking posts form-encoded USSD payloads
  await app.register(jwt, { secret: config.JWT_SECRET });

  app.decorate('authBuyer', async (req, reply) => {
    try {
      await req.jwtVerify();
    } catch {
      await reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Login required' } });
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

  await app.register(authRoutes, { prefix: '/api' });
  await app.register(registryRoutes, { prefix: '/api' });
  await app.register(farmerRoutes, { prefix: '/api' });
  await app.register(lotRoutes, { prefix: '/api' });
  await app.register(demandRoutes, { prefix: '/api' });

  return app;
}
