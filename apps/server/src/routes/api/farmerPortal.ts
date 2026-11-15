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
  markLotSold,
  updateFarmerProfile,
  updateLot,
  withdrawLot,
  listOffersForFarmer,
  listOpenOffersForLot,
  answerClaim,
  getClaim,
  listClaimsForFarmer,
  mediaUrl,
} from '@ftm/core';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { offerView } from './offers';

const listLotSchema = z.object({
  commodityCode: z.string(),
  unitCode: z.string(),
  unitQty: z.number().positive(),
  declaredBand: gradeBandSchema,
  askingPricePerKg: z.number().int().positive().optional(), // pesewas
  askingPricePerUnit: z.number().int().positive().optional(), // pesewas per unit (bag…) — preferred (Phase 1)
  readyDate: z.number().optional(),
  harvestedAt: z.number().optional(),
  community: z.string().max(80).optional(),
  landmark: z.string().max(120).optional(),
});

const updateLotSchema = z
  .object({
    units: z.number().positive().optional(),
    askingPricePerUnit: z.number().int().positive().nullable().optional(),
    readyDate: z.number().optional(),
    community: z.string().max(80).optional(),
    landmark: z.string().max(120).optional(),
  })
  .strict();

/**
 * The farmer's web portal (prototype Frame 07): the same actions the USSD tree
 * offers — list a lot, see offers ("incoming bids"), accept or decline, watch
 * payouts — through the same domain calls. Feature parity, third surface.
 */
export async function farmerPortalRoutes(app: FastifyInstance): Promise<void> {
  app.get('/farmer/dashboard', { preHandler: [app.authFarmer] }, async (req) => {
    const farmer = await getFarmerById(req.user.sub);
    if (!farmer) throw new DomainError('Farmer not found', 'NOT_FOUND', 404);

    const lots = await Promise.all((await listLotsByFarmer(farmer.id)).map(async (l) => {
          const commodity = getCommodityById(l.commodityId);
          const unit = (await db.select().from(schema.units).where(eq(schema.units.id, l.unitId)))[0];
          // Open negotiations on it (Phase 1). Matches only exist once a deal is agreed.
          const bids = (await listOpenOffersForLot(l.id)).length;
          const photo = (await listListingPhotos(l.id))[0];
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
            askingPricePerUnit: l.askingPricePerUnit,
            harvestedAt: l.harvestedAt,
            community: l.community,
            landmark: l.landmark,
            expiresAt: l.expiresAt,
            status: l.status,
            channel: l.channel,
            photoUrl: photo ? mediaUrl(photo.path) : null,
            bids,
            createdAt: l.createdAt,
          };
        }));

    const contracts = await Promise.all((await listContractsForFarmer(farmer.id)).map(async (c) => {
          const commodity = getCommodityById(c.commodityId);
          const buyer = (await db.select().from(schema.buyers).where(eq(schema.buyers.id, c.buyerId)))[0];
          const terms = contractPriceTerms(c);
          const match = await getMatch(c.matchId);
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
        }));

    const payouts = await Promise.all((await listPaymentsForFarmer(farmer.id, 50)).map(async (p) => {
          const contract = await getContract(p.contractId);
          const lot = (await db.select().from(schema.lots).where(eq(schema.lots.id, contract.lotId)))[0];
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
        }));

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
      offers: contracts.filter((c) => c.state === 'OFFERED'), // legacy system offers — superseded by offerThreads (Phase 1)
      offerThreads: await Promise.all((await listOffersForFarmer(farmer.id, 'open')).map(offerView)),
      contracts: contracts.filter((c) => c.state !== 'OFFERED').slice(0, 15),
      lots,
      payouts,
    };
  });

  // SMS & call language (D-040) — the one profile field a farmer can change.
  app.patch('/farmer/profile', { preHandler: [app.authFarmer] }, async (req) => {
    const input = z.object({ locale: z.string() }).parse(req.body ?? {});
    const farmer = await updateFarmerProfile(req.user.sub, { locale: input.locale });
    return { profile: { locale: farmer.locale } };
  });

  // "List a New Lot" — same registerLot the USSD tree calls, now with the web
  // form's optional ask price (USSD keeps its shorter flow).
  app.post('/farmer/lots', { preHandler: [app.authFarmer] }, async (req, reply) => {
    const lot = await registerLot({ ...listLotSchema.parse(req.body), farmerId: req.user.sub, channel: 'web' });
    return reply.code(201).send({ lot });
  });

  // Change a listing (Phase 1): quantity, asking price per unit, ready date, place. Renews it too.
  app.patch('/farmer/lots/:id', { preHandler: [app.authFarmer] }, async (req) => {
    const { id } = req.params as { id: string };
    const lot = await updateLot(id, req.user.sub, updateLotSchema.parse(req.body ?? {}));
    return { lot };
  });

  // Sold elsewhere: off the market, open offers on it closed and their buyers told.
  app.post('/farmer/lots/:id/sold', { preHandler: [app.authFarmer] }, async (req) => {
    const { id } = req.params as { id: string };
    const lot = await markLotSold(id, req.user.sub);
    return { lot: { id: lot.id, lotCode: lot.lotCode, status: lot.status } };
  });

  // Take a listing off the market — the same withdrawLot the USSD "My lots" menu calls.
  app.post('/farmer/lots/:id/withdraw', { preHandler: [app.authFarmer] }, async (req) => {
    const { id } = req.params as { id: string };
    const lot = await withdrawLot(id, req.user.sub);
    return { lot: { id: lot.id, lotCode: lot.lotCode, status: lot.status } };
  });

  // Listing photos (D-036): the smartphone seller's card art.
  app.post('/farmer/lots/:id/photos', { preHandler: [app.authFarmer] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const file = await req.file();
    if (!file) throw new DomainError('Attach a photo file', 'NO_FILE', 400);
    const photo = await addLotPhoto({ lotId: id, farmerId: req.user.sub, buffer: await file.toBuffer() });
    return reply.code(201).send({ photo: { id: photo.id, url: mediaUrl(photo.path), createdAt: photo.createdAt } });
  });

  // Accept/decline an incoming bid — the exact calls USSD "My offers" makes.
  // Phase 3: a buyer's claims on this farmer's orders, and the answer (same move as USSD My lots).
  app.get('/farmer/claims', { preHandler: [app.authFarmer] }, async (req) => ({
    claims: (await listClaimsForFarmer(req.user.sub)).map(({ contract, ...claim }) => ({ ...claim, lotId: contract.lotId, contractState: contract.state })),
  }));

  app.post('/farmer/claims/:id/answer', { preHandler: [app.authFarmer] }, async (req) => {
    const { id } = req.params as { id: string };
    const { accept } = z.object({ accept: z.boolean() }).parse(req.body ?? {});
    await getClaim(id); // 404 before 403
    return { claim: await answerClaim(id, req.user.sub, accept) };
  });

  app.post('/farmer/contracts/:id/accept', { preHandler: [app.authFarmer] }, async (req) => {
    const { id } = req.params as { id: string };
    const contract = await acceptOfferAndHold(id, req.user.sub);
    return { contract: { id: contract.id, state: contract.state } };
  });

  app.post('/farmer/contracts/:id/decline', { preHandler: [app.authFarmer] }, async (req) => {
    const { id } = req.params as { id: string };
    const contract = await declineOffer(id, req.user.sub);
    return { contract: { id: contract.id, state: contract.state } };
  });

  // "Arrange delivery" (D-037): the farmer asks; the buyer approves and funds.
  app.post('/farmer/contracts/:id/suggest-transport', { preHandler: [app.authFarmer] }, async (req) => {
    const { id } = req.params as { id: string };
    await suggestTransport(id, req.user.sub);
    return { ok: true };
  });
}
