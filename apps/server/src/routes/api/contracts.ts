import {
  addPhoto,
  confirmPickup,
  contractLedger,
  contractPriceTerms,
  DomainError,
  getCommodityById,
  getContract,
  getFarmerById,
  getLot,
  getMatch,
  getTrace,
  listContractsForBuyer,
  listGradingsForContract,
  listPaymentsForContract,
  listPhotosForContract,
  runGrading,
  t,
  type Contract,
} from '@ftm/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';

function ownedContract(req: FastifyRequest, id: string): Contract {
  const contract = getContract(id);
  if (contract.buyerId !== req.user.sub) {
    throw new DomainError('Not your contract', 'FORBIDDEN', 403);
  }
  return contract;
}

export async function contractRoutes(app: FastifyInstance): Promise<void> {
  app.get('/contracts', { preHandler: [app.authBuyer] }, async (req) => {
    return { contracts: listContractsForBuyer(req.user.sub).map((c) => ({ ...c, priceTerms: contractPriceTerms(c) })) };
  });

  app.get('/contracts/:id', { preHandler: [app.authBuyer] }, async (req) => {
    const { id } = req.params as { id: string };
    const contract = ownedContract(req, id);
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
      ledger: contractLedger(contract.id),
      photos: listPhotosForContract(contract.id).map((p) => ({ id: p.id, url: `/${p.path}`, createdAt: p.createdAt })),
      gradings: listGradingsForContract(contract.id).map((g) => ({
        ...g,
        reasons: g.reasons ? JSON.parse(g.reasons) : [],
        rawResponse: undefined,
      })),
      trace: getTrace(contract.lotId),
    };
  });

  // The buyer/agent uploads pickup photos in v1 (D-014).
  app.post('/contracts/:id/photos', { preHandler: [app.authBuyer] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    ownedContract(req, id);
    const file = await req.file();
    if (!file) throw new DomainError('Attach a photo file', 'NO_FILE', 400);
    const photo = await addPhoto({
      contractId: id,
      buffer: await file.toBuffer(),
      actor: { type: 'buyer', id: req.user.sub },
    });
    return reply.code(201).send({ photo: { id: photo.id, url: `/${photo.path}`, bytes: photo.bytes } });
  });

  app.post('/contracts/:id/confirm-pickup', { preHandler: [app.authBuyer] }, async (req) => {
    const { id } = req.params as { id: string };
    ownedContract(req, id);
    const contract = confirmPickup(id, { type: 'buyer', id: req.user.sub });
    return { contract: { id: contract.id, state: contract.state } };
  });

  app.post('/contracts/:id/grade', { preHandler: [app.authBuyer] }, async (req) => {
    const { id } = req.params as { id: string };
    ownedContract(req, id);
    const grading = await runGrading(id);
    return {
      grading: { ...grading, reasons: grading.reasons ? JSON.parse(grading.reasons) : [], rawResponse: undefined },
      contract: (() => {
        const c = getContract(id);
        return { id: c.id, state: c.state, finalGrade: c.finalGrade, finalAmount: c.finalAmount };
      })(),
    };
  });
}
