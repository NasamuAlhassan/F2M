import { db, schema, verifyBuyerLogin, verifyDriverLogin } from '@ftm/core';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const loginSchema = z.object({ email: z.string(), password: z.string() });
const driverLoginSchema = z.object({ phone: z.string(), pin: z.string() });

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/login', async (req) => {
    const { email, password } = loginSchema.parse(req.body);
    const buyer = verifyBuyerLogin(email, password);
    const token = app.jwt.sign({ sub: buyer.id, kind: 'buyer' });
    return {
      token,
      buyer: { id: buyer.id, name: buyer.name, email: buyer.email, company: buyer.company },
    };
  });

  app.get('/auth/me', { preHandler: [app.authBuyer] }, async (req) => {
    const buyer = db.select().from(schema.buyers).where(eq(schema.buyers.id, req.user.sub)).get();
    return {
      buyerId: req.user.sub,
      name: buyer?.name ?? null,
      company: buyer?.company ?? null,
      regionCode: buyer?.regionCode ?? null,
    };
  });

  // Drivers sign in with the phone + PIN they set during USSD registration (D-021).
  app.post('/auth/driver-login', async (req) => {
    const { phone, pin } = driverLoginSchema.parse(req.body);
    const driver = verifyDriverLogin(phone, pin);
    const token = app.jwt.sign({ sub: driver.id, kind: 'driver' });
    return {
      token,
      driver: { id: driver.id, name: driver.name, phone: driver.phone, vehicleClassCode: driver.vehicleClassCode },
    };
  });
}
