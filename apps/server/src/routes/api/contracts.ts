import {
  contractPriceTerms,
  DomainError,
  getCommodityById,
  getContract,
  getFarmerById,
  getLot,
  getMatch,
  getTrace,
  listContractsForBuyer,
  listPaymentsForContract,
  t,
} from '@ftm/core';
import type { FastifyInstance } from 'fastify';

export async function contractRoutes(app: FastifyInstance): Promise<void> {
  app.get('/contracts', { preHandler: [app.authBuyer] }, async (req) => {
    return { contracts: listContractsForBuyer(req.user.sub).map((c) => ({ ...c, priceTerms: contractPriceTerms(c) })) };
  });

  app.get('/contracts/:id', { preHandler: [app.authBuyer] }, async (req) => {
    const { id } = req.params as { id: string };
    const contract = getContract(id);
    if (contract.buyerId !== req.user.sub) {
      throw new DomainError('Not your contract', 'FORBIDDEN', 403);
    }
    const lot = getLot(contract.lotId);
    const farmer = getFarmerById(contract.farmerId);
    const commodity = getCommodityById(contract.commodityId);
    const match = getMatch(contract.matchId);
    return {
      contract: { ...contract, priceTerms: contractPriceTerms(contract) },
      match: { score: match.score, expiresAt: match.expiresAt, breakdown: JSON.parse(match.scoreBreakdown) },
      lot: { id: lot.id, lotCode: lot.lotCode, quantityKg: lot.quantityKg, declaredBand: lot.declaredBand, status: lot.status },
      farmer: farmer
        ? { id: farmer.id, name: farmer.name, phone: farmer.phone, regionCode: farmer.regionCode, district: farmer.district }
        : null,
      commodity: { code: commodity.code, name: t('en', commodity.nameKey) },
      payments: listPaymentsForContract(contract.id),
      trace: getTrace(contract.lotId),
    };
  });
}
