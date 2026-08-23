import {
  acceptJob,
  confirmJobDelivery,
  confirmJobPickup,
  declineJob,
  DomainError,
  getContract,
  getDriverById,
  getJobForContract,
  jobSummary,
  listJobsForDriver,
  listOffersForDriver,
  quoteTransport,
  requestTransport,
  retryDispatch,
  t,
  type DeliveryJob,
} from '@ftm/core';
import type { FastifyInstance } from 'fastify';

function jobView(job: DeliveryJob) {
  const driver = job.driverId ? getDriverById(job.driverId) : undefined;
  const { commodityCode, quantityKg } = jobSummary(job);
  return {
    id: job.id,
    jobCode: job.jobCode,
    contractId: job.contractId,
    lotId: job.lotId,
    state: job.state,
    vehicleClassCode: job.vehicleClassCode,
    vehicleClassName: t('en', `vehicle.${job.vehicleClassCode}`),
    distanceKm: job.distanceKm,
    quoteAmount: job.quoteAmount,
    commodityCode,
    quantityKg,
    driver: driver ? { name: driver.name, phone: driver.phone } : null,
    assignedAt: job.assignedAt,
    pickedUpAt: job.pickedUpAt,
    deliveredAt: job.deliveredAt,
    paidAt: job.paidAt,
    createdAt: job.createdAt,
  };
}

export async function logisticsRoutes(app: FastifyInstance): Promise<void> {
  // ---- Buyer side ----
  app.get('/contracts/:id/transport-quote', { preHandler: [app.authBuyer] }, async (req) => {
    const { id } = req.params as { id: string };
    const contract = getContract(id);
    if (contract.buyerId !== req.user.sub) throw new DomainError('Not your contract', 'FORBIDDEN', 403);
    const quote = quoteTransport(id);
    return {
      quote: {
        vehicleClassCode: quote.vehicleClass.code,
        vehicleClassName: t('en', quote.vehicleClass.nameKey),
        capacityKg: quote.vehicleClass.capacityKg,
        baseFee: quote.vehicleClass.baseFee,
        perKmRate: quote.vehicleClass.perKmRate,
        distanceKm: quote.distanceKm,
        quoteAmount: quote.quoteAmount,
      },
    };
  });

  app.post('/contracts/:id/transport', { preHandler: [app.authBuyer] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = requestTransport(id, req.user.sub);
    return reply.code(201).send({ job: jobView(job) });
  });

  app.get('/contracts/:id/transport', { preHandler: [app.authBuyer] }, async (req) => {
    const { id } = req.params as { id: string };
    const contract = getContract(id);
    if (contract.buyerId !== req.user.sub) throw new DomainError('Not your contract', 'FORBIDDEN', 403);
    const job = getJobForContract(id);
    return { job: job ? jobView(job) : null };
  });

  app.post('/jobs/:id/retry-dispatch', { preHandler: [app.authBuyer] }, async (req) => {
    const { id } = req.params as { id: string };
    return { job: jobView(retryDispatch(id, req.user.sub)) };
  });

  app.post('/jobs/:id/deliver', { preHandler: [app.authBuyer] }, async (req) => {
    const { id } = req.params as { id: string };
    const job = await confirmJobDelivery(id, req.user.sub);
    return { job: jobView(job) };
  });

  // ---- Driver side (same domain calls the USSD screens make) ----
  app.get('/driver/jobs', { preHandler: [app.authDriver] }, async (req) => {
    const driverId = req.user.sub;
    return {
      offers: listOffersForDriver(driverId).map((o) => ({
        jobId: o.jobId,
        expiresAt: o.expiresAt,
        ...jobView(o.job),
      })),
      jobs: listJobsForDriver(driverId).map(jobView),
    };
  });

  app.post('/jobs/:id/accept', { preHandler: [app.authDriver] }, async (req) => {
    const { id } = req.params as { id: string };
    const job = await acceptJob(id, req.user.sub);
    return { job: jobView(job) };
  });

  app.post('/jobs/:id/decline', { preHandler: [app.authDriver] }, async (req) => {
    const { id } = req.params as { id: string };
    declineJob(id, req.user.sub);
    return { ok: true };
  });

  app.post('/jobs/:id/pickup', { preHandler: [app.authDriver] }, async (req) => {
    const { id } = req.params as { id: string };
    const job = confirmJobPickup(id, req.user.sub);
    return { job: jobView(job) };
  });
}
