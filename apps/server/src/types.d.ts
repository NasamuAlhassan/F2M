import type { FastifyReply, FastifyRequest } from 'fastify';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; kind: 'buyer' | 'driver' };
    user: { sub: string; kind: 'buyer' | 'driver' };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authBuyer: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authDriver: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export {};
