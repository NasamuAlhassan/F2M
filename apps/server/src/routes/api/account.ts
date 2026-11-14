import { describeAccount, DomainError, getAccountByAuthUser, registerAccount } from '@ftm/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const registerSchema = z
  .object({
    role: z.enum(['farmer', 'buyer', 'driver']),
    name: z.string().trim().min(1, 'Enter your name'),
    regionCode: z.string().min(1, 'Choose your region'),
    district: z.string().trim().optional(),
    company: z.string().trim().optional(),
    vehicleClassCode: z.string().optional(),
    locale: z.string().optional(),
  })
  .strict();

/**
 * Web accounts (D-047). The browser signs in with Supabase (phone + password)
 * and sends the access token; these two routes turn that login into an F2M
 * profile. The phone always comes from the verified token, never the body.
 */
export async function accountRoutes(app: FastifyInstance): Promise<void> {
  // Who am I? `account: null` means "signed in, profile not created yet" —
  // the web then shows the second signup step.
  app.get('/account/me', { preHandler: [app.authLogin] }, async (req) => {
    const account = getAccountByAuthUser(req.login.authUserId);
    return { account: account ? describeAccount(account) : null };
  });

  app.post('/account/register', { preHandler: [app.authLogin] }, async (req, reply) => {
    if (!req.login.phone) {
      throw new DomainError('Sign in with your phone number to create an F2M profile', 'PHONE_REQUIRED', 400);
    }
    const input = registerSchema.parse(req.body ?? {});
    const account = registerAccount({ ...input, authUserId: req.login.authUserId, phone: req.login.phone });
    return reply.code(201).send({ account: describeAccount(account) });
  });
}
