import type { VerifiedLogin } from '@ftm/core';
import type { FastifyReply, FastifyRequest } from 'fastify';

export type Role = 'buyer' | 'driver' | 'farmer';

declare module 'fastify' {
  interface FastifyInstance {
    authBuyer: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authDriver: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authFarmer: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Buyer or farmer — the two roles that browse and hire drivers. */
    authBuyerOrFarmer: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** A valid web login, with or without an F2M profile yet (signup's second step). */
    authLogin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    /** Set by the role guards: `sub` is the farmer/buyer/driver row id the request acts as. */
    user: { sub: string; kind: Role; authUserId: string };
    /** Set by authLogin and the role guards: the verified Supabase login. */
    login: VerifiedLogin;
  }
}

export {};
