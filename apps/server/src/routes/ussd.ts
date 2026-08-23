import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { handleUssdRequest } from '../ussd/index';

// Africa's Talking wire format: form-encoded sessionId/serviceCode/phoneNumber/text,
// plain-text response beginning "CON " (continue) or "END " (terminate).
const ussdBodySchema = z.object({
  sessionId: z.string(),
  phoneNumber: z.string(),
  text: z.string().default(''),
  serviceCode: z.string().optional(),
  networkCode: z.string().optional(),
});

export async function ussdRoutes(app: FastifyInstance): Promise<void> {
  app.post('/ussd', async (req, reply) => {
    const body = ussdBodySchema.parse(req.body);
    let response: string;
    try {
      response = handleUssdRequest(body);
    } catch (err) {
      req.log.error(err, 'ussd handler failed');
      response = 'END Sorry, the service is unavailable. Please try again.';
    }
    return reply.type('text/plain').send(response);
  });
}
