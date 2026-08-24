import { db, requestFarmerLoginCode, schema, verifyBuyerLogin, verifyDriverLogin, verifyFarmerLoginCode } from '@ftm/core';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const loginSchema = z.object({ email: z.string(), password: z.string() });
const driverLoginSchema = z.object({ phone: z.string(), pin: z.string() });
const farmerOtpSchema = z.object({ phone: z.string() });
const farmerLoginSchema = z.object({ phone: z.string(), code: z.string() });

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

  // Farmers sign in with phone + one-time code sent over the SMS outbox (D-032)
  // — no password, no change to USSD registration. In the offline demo the
  // code appears in the USSD tester's SMS inbox.
  app.post('/auth/farmer-otp', async (req) => {
    const { phone } = farmerOtpSchema.parse(req.body);
    return requestFarmerLoginCode(phone);
  });

  app.post('/auth/farmer-login', async (req) => {
    const { phone, code } = farmerLoginSchema.parse(req.body);
    const farmer = verifyFarmerLoginCode(phone, code);
    const token = app.jwt.sign({ sub: farmer.id, kind: 'farmer' });
    return { token, farmer: { id: farmer.id, name: farmer.name, phone: farmer.phone, regionCode: farmer.regionCode } };
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
