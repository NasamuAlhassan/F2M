import {
  addPhoto,
  advanceFor,
  CLAIM_REASONS,
  confirmPickup,
  confirmReceipt,
  farmerPaid,
  fileClaim,
  listClaimsForContract,
  orderTotal,
  stillHeld,
  contractLedger,
  contractPriceTerms,
  DomainError,
  getCommodityById,
  getContract,
  getFarmerById,
  getLot,
  getMatch,
  getRegion,
  getTrace,
  listContractsForBuyer,
  listGradingsForContract,
  listPaymentsForContract,
  listPhotosForContract,
  queueVoiceCall,
  runGrading,
  t,
  type Contract,
} from '@ftm/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

const claimSchema = z.object({
  reason: z.enum(CLAIM_REASONS),
  note: z.string().max(500).optional(),
  /** Pesewas to deduct, at most what is still held. */
  deduction: z.number().int().min(0),
});

/** Phase 3: where the order's money stands — for the order page and the farmer's screens alike. */
export function settlementView(contract: Contract) {
  const { landed, pending } = farmerPaid(contract.id);
  return {
    total: orderTotal(contract),
    advance: advanceFor(contract),
    paidToFarmer: landed,
    onTheWay: pending,
    stillHeld: stillHeld(contract),
    deduction: contract.deductionAmount ?? 0,
    receiptDueAt: contract.receiptDueAt,
    deliveredAt: contract.deliveredAt,
    receivedAt: contract.receivedAt,
  };
}

function ownedContract(req: FastifyRequest, id: string): Contract {
  const contract = getContract(id);
  if (contract.buyerId !== req.user.sub) {
    throw new DomainError('Not your contract', 'FORBIDDEN', 403);
  }
  return contract;
}

export async function contractRoutes(app: FastifyInstance): Promise<void> {
  app.get('/contracts', { preHandler: [app.authBuyer] }, async (req) => {
    return {
      contracts: listContractsForBuyer(req.user.sub).map((c) => {
        const lot = getLot(c.lotId);
        const commodity = getCommodityById(c.commodityId);
        const farmer = getFarmerById(c.farmerId);
        return {
          ...c,
          priceTerms: contractPriceTerms(c),
          lotCode: lot.lotCode,
          commodityCode: commodity.code,
          commodityName: t('en', commodity.nameKey),
          farmerName: farmer?.name ?? null,
        };
      }),
    };
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
        ? {
            id: farmer.id,
            name: farmer.name,
            phone: farmer.phone,
            regionCode: farmer.regionCode,
            regionName: t('en', getRegion(farmer.regionCode).nameKey),
            district: farmer.district,
          }
        : null,
      commodity: { code: commodity.code, name: t('en', commodity.nameKey) },
      payments: listPaymentsForContract(contract.id),
      settlement: settlementView(contract),
      claims: listClaimsForContract(contract.id),
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

  // Phase 3: the buyer confirms the produce arrived as agreed — the driver is
  // paid and the farmer's balance goes out. Silence does the same after 24 h.
  app.post('/contracts/:id/receive', { preHandler: [app.authBuyer] }, async (req) => {
    const { id } = req.params as { id: string };
    ownedContract(req, id);
    const contract = await confirmReceipt(id, { type: 'buyer', id: req.user.sub });
    return { contract: { id: contract.id, state: contract.state }, settlement: settlementView(contract) };
  });

  // Phase 3 (vision §20): report a problem with a deduction; the farmer answers, F2M reviews.
  app.post('/contracts/:id/claims', { preHandler: [app.authBuyer] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    ownedContract(req, id);
    const input = claimSchema.parse(req.body ?? {});
    const claim = fileClaim({ contractId: id, buyerId: req.user.sub, ...input });
    return reply.code(201).send({ claim });
  });

  app.post('/contracts/:id/confirm-pickup', { preHandler: [app.authBuyer] }, async (req) => {
    const { id } = req.params as { id: string };
    ownedContract(req, id);
    const contract = confirmPickup(id, { type: 'buyer', id: req.user.sub });
    return { contract: { id: contract.id, state: contract.state } };
  });

  // Call-bridge stub (W4): queue a voice call to the farmer. Masking/translation
  // arrive with the language layer + AT Voice — the queue and provider plumbing are live now.
  app.post('/contracts/:id/call-farmer', { preHandler: [app.authBuyer] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const contract = ownedContract(req, id);
    const farmer = getFarmerById(contract.farmerId);
    if (!farmer) throw new DomainError('Farmer not found', 'NOT_FOUND', 404);
    const call = queueVoiceCall({ phone: farmer.phone, locale: farmer.locale, flow: 'bridge', contractId: id });
    return reply.code(201).send({ call: { id: call.id, status: call.status, flow: call.flow } });
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
