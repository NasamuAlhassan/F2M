import { listCommodities, listRegions, t } from '@ftm/core';
import type { FastifyInstance } from 'fastify';

export async function registryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/registries', async () => {
    return {
      commodities: listCommodities().map((c) => ({
        id: c.id,
        code: c.code,
        name: t('en', c.nameKey),
        category: c.category,
        clockType: c.clockType,
        clock: c.clock,
        units: c.units.map((u) => ({
          id: u.id,
          code: u.code,
          name: t('en', u.nameKey),
          kgPerUnit: u.kgPerUnit,
          isInformal: u.isInformal,
        })),
      })),
      regions: listRegions().map((r) => ({ code: r.code, name: t('en', r.nameKey), lat: r.lat, lng: r.lng })),
    };
  });
}
