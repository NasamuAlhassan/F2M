import {
  acceptOfferAndHold,
  addLotPhoto,
  bestBand,
  contractPriceTerms,
  db,
  declineOffer,
  DomainError,
  getCommodityById,
  getContract,
  getFarmerById,
  getMatch,
  gradeBandSchema,
  listContractsForFarmer,
  listListingPhotos,
  listLotsByFarmer,
  listPaymentsForFarmer,
  registerLot,
  schema,
  suggestTransport,
  t,
  updateFarmerProfile,
} from '@ftm/core';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const listLotSchema = z.object({
  commodityCode: z.string(),
  unitCode: z.string(),
  unitQty: z.number().positive(),
  declaredBand: gradeBandSchema,
  askingPricePerKg: z.number().int().positive().optional(), // pesewas
  readyDate: z.number().optional(),
});

/**
 * The farmer's web portal (prototype Frame 07): the same actions the USSD tree
 * offers — list a lot, see offers ("incoming bids"), accept or decline, watch
 * payouts — through the same domain calls. Feature parity, third surface.
 */
export async function farmerPortalRoutes(app: FastifyInstance): Promise<void> {
  app.get('/farmer/dashboard', { preHandler: [app.authFarmer] }, async (req) => {
    const farmer = getFarmerById(req.user.sub);
    if (!farmer) throw new DomainError('Farmer not found', 'NOT_FOUND', 404);

    const lots = listLotsByFarmer(farmer.id).map((l) => {
      const commodity = getCommodityById(l.commodityId);
      const unit = db.select().from(schema.units).where(eq(schema.units.id, l.unitId)).get();
      const bids = db.select().from(schema.matches).where(eq(schema.matches.lotId, l.id)).all().length;
      const photo = listListingPhotos(l.id)[0];
      return {
        id: l.id,
        lotCode: l.lotCode,
        commodityCode: commodity.code,
        commodityName: t('en', commodity.nameKey),
        quantityKg: l.quantityKg,
        remainingKg: l.remainingKg,
        unitName: unit ? t('en', unit.nameKey) : 'unit',
        declaredBand: l.declaredBand,
        askingPricePerKg: l.askingPricePerKg,
        status: l.status,
        channel: l.channel,
        photoUrl: photo ? `/${photo.path}` : null,
        bids,
        createdAt: l.createdAt,
      };
    });

    const contracts = listContractsForFarmer(farmer.id).map((c) => {
      const commodity = getCommodityById(c.commodityId);
      const buyer = db.select().from(schema.buyers).where(eq(schema.buyers.id, c.buyerId)).get();
      const terms = contractPriceTerms(c);
      const match = getMatch(c.matchId);
      return {
        id: c.id,
        state: c.state,
        commodityCode: commodity.code,
        commodityName: t('en', commodity.nameKey),
        quantityKg: c.quantityKg,
        bestPricePerKg: terms[bestBand(terms)] ?? 0,
        holdAmount: c.holdAmount,
        finalAmount: c.finalAmount,
        finalGrade: c.finalGrade,
        buyerName: buyer?.company ?? buyer?.name ?? 'Buyer',
        lotId: c.lotId,
        expiresAt: match.expiresAt,
        createdAt: c.createdAt,
      };
    });

    const payouts = listPaymentsForFarmer(farmer.id, 50).map((p) => {
      const contract = getContract(p.contractId);
      const lot = db.select().from(schema.lots).where(eq(schema.lots.id, contract.lotId)).get();
      return {
        id: p.id,
        lotCode: lot?.lotCode ?? '—',
        amount: p.amount,
        status: p.status,
        provider: p.provider,
        providerRef: p.providerRef,
        counterpartyMsisdn: p.counterpartyMsisdn,
        createdAt: p.createdAt,
      };
    });

    const activeStates = ['ACCEPTED', 'FUNDS_HELD', 'PICKUP_CONFIRMED', 'GRADED', 'DISPUTED'];
    return {
      profile: {
        name: farmer.name,
        phone: farmer.phone,
        regionCode: farmer.regionCode,
        district: farmer.district,
        momoMsisdn: farmer.momoMsisdn,
        locale: farmer.locale,
      },
      stats: {
        activeListings: lots.filter((l) => ['registered', 'matched'].includes(l.status) && l.remainingKg > 0).length,
        matchedContracts: contracts.filter((c) => activeStates.includes(c.state)).length,
        totalEarned: payouts.filter((p) => p.status === 'successful').reduce((s, p) => s + p.amount, 0),
      },
      offers: contracts.filter((c) => c.state === 'OFFERED'),
      contracts: contracts.filter((c) => c.state !== 'OFFERED').slice(0, 15),
      lots,
      payouts,
    };
  });

  // SMS & call language (D-040) — the one profile field a farmer can change.
  app.patch('/farmer/profile', { preHandler: [app.authFarmer] }, async (req) => {
    const input = z.object({ locale: z.string() }).parse(req.body ?? {});
    const farmer = updateFarmerProfile(req.user.sub, { locale: input.locale });
    return { profile: { locale: farmer.locale } };
  });

  // "List a New Lot" — same registerLot the USSD tree calls, now with the web
  // form's optional ask price (USSD keeps its shorter flow).
  app.post('/farmer/lots', { preHandler: [app.authFarmer] }, async (req, reply) => {
    const lot = registerLot({ ...listLotSchema.parse(req.body), farmerId: req.user.sub, channel: 'web' });
    return reply.code(201).send({ lot });
  });

  // Listing photos (D-036): the smartphone seller's card art.
  app.post('/farmer/lots/:id/photos', { preHandler: [app.authFarmer] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const file = await req.file();
    if (!file) throw new DomainError('Attach a photo file', 'NO_FILE', 400);
    const photo = await addLotPhoto({ lotId: id, farmerId: req.user.sub, buffer: await file.toBuffer() });
    return reply.code(201).send({ photo: { id: photo.id, url: `/${photo.path}`, createdAt: photo.createdAt } });
  });

  // Accept/decline an incoming bid — the exact calls USSD "My offers" makes.
  app.post('/farmer/contracts/:id/accept', { preHandler: [app.authFarmer] }, async (req) => {
    const { id } = req.params as { id: string };
    const contract = await acceptOfferAndHold(id, req.user.sub);
    return { contract: { id: contract.id, state: contract.state } };
  });

  app.post('/farmer/contracts/:id/decline', { preHandler: [app.authFarmer] }, async (req) => {
    const { id } = req.params as { id: string };
    const contract = declineOffer(id, req.user.sub);
    return { contract: { id: contract.id, state: contract.state } };
  });

  // "Arrange delivery" (D-037): the farmer asks; the buyer approves and funds.
  app.post('/farmer/contracts/:id/suggest-transport', { preHandler: [app.authFarmer] }, async (req) => {
    const { id } = req.params as { id: string };
    suggestTransport(id, req.user.sub);
    return { ok: true };
  });
}
