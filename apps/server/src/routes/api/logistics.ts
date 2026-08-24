import {
  acceptJob,
  confirmJobDelivery,
  confirmJobPickup,
  declineJob,
  DomainError,
  driverRouteRegions,
  getContract,
  getDriverById,
  getJobForContract,
  jobSummary,
  listAvailableDrivers,
  listJobsForDriver,
  listOffersForDriver,
  listOpenRequestsForDriver,
  listVehicleClasses,
  quoteTransportOptions,
  requestTransport,
  retryDispatch,
  t,
  updateDriverProfile,
  type DeliveryJob,
} from '@ftm/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const requestTransportSchema = z
  .object({ vehicleClassCode: z.string().optional(), preferredDriverId: z.string().optional() })
  .default({});
const profileSchema = z.object({
  vehicleClassCode: z.string().optional(),
  active: z.boolean().optional(),
  routeRegions: z.array(z.string()).max(16).optional(),
  locale: z.string().optional(), // SMS + call language (D-040)
});

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
  // Instant quotes for every vehicle class that fits the load — the buyer picks.
  app.get('/contracts/:id/transport-quote', { preHandler: [app.authBuyer] }, async (req) => {
    const { id } = req.params as { id: string };
    const contract = getContract(id);
    if (contract.buyerId !== req.user.sub) throw new DomainError('Not your contract', 'FORBIDDEN', 403);
    return {
      quotes: quoteTransportOptions(id).map((quote) => ({
        vehicleClassCode: quote.vehicleClass.code,
        vehicleClassName: t('en', quote.vehicleClass.nameKey),
        capacityKg: quote.vehicleClass.capacityKg,
        baseFee: quote.vehicleClass.baseFee,
        perKmRate: quote.vehicleClass.perKmRate,
        distanceKm: quote.distanceKm,
        quoteAmount: quote.quoteAmount,
      })),
    };
  });

  app.post('/contracts/:id/transport', { preHandler: [app.authBuyer] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { vehicleClassCode, preferredDriverId } = requestTransportSchema.parse(req.body ?? {});
    const job = requestTransport(id, req.user.sub, vehicleClassCode, preferredDriverId);
    return reply.code(201).send({ job: jobView(job) });
  });

  // The side-hustle directory (D-037): online drivers, browsable by buyers AND
  // sellers — call to inquire, or hire directly on a funded contract.
  app.get('/drivers/available', async (req, reply) => {
    try {
      await req.jwtVerify();
      if (req.user.kind !== 'buyer' && req.user.kind !== 'farmer') throw new Error('wrong role');
    } catch {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Login required' } });
    }
    const classes = new Map(listVehicleClasses().map((v) => [v.code, v]));
    return {
      drivers: listAvailableDrivers().map((d) => {
        const vc = classes.get(d.vehicleClassCode);
        return {
          ...d,
          vehicleClassName: vc ? t('en', vc.nameKey) : d.vehicleClassCode,
          capacityKg: vc?.capacityKg ?? 0,
        };
      }),
    };
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
      // Read-only queue behind the sequential dispatcher (D-023) — the board's
      // "open requests" section.
      openRequests: listOpenRequestsForDriver(driverId).map(jobView),
      jobs: listJobsForDriver(driverId).map(jobView),
    };
  });

  app.get('/driver/profile', { preHandler: [app.authDriver] }, async (req) => {
    const driver = getDriverById(req.user.sub);
    if (!driver) throw new DomainError('Driver not found', 'NOT_FOUND', 404);
    return {
      profile: {
        name: driver.name,
        phone: driver.phone,
        regionCode: driver.regionCode,
        vehicleClassCode: driver.vehicleClassCode,
        active: driver.active,
        routeRegions: driverRouteRegions(driver),
        locale: driver.locale,
      },
    };
  });

  app.put('/driver/profile', { preHandler: [app.authDriver] }, async (req) => {
    const input = profileSchema.parse(req.body ?? {});
    const driver = updateDriverProfile(req.user.sub, input);
    return {
      profile: {
        name: driver.name,
        phone: driver.phone,
        regionCode: driver.regionCode,
        vehicleClassCode: driver.vehicleClassCode,
        active: driver.active,
        routeRegions: driverRouteRegions(driver),
        locale: driver.locale,
      },
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
