import type { FastifyReply, FastifyRequest } from 'fastify';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; kind: 'buyer' };
    user: { sub: string; kind: 'buyer' };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authBuyer: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export {};
