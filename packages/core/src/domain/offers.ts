import { and, desc, eq, inArray, isNull, lt } from 'drizzle-orm';
import { config } from '../config';
import { db } from '../db/client';
import {
  buyers,
  contracts,
  demands,
  farmers,
  lots,
  matches,
  offerEvents,
  offers,
  units,
  type Lot,
  type Offer,
  type OfferEvent,
} from '../db/schema';
import { t } from '../i18n';
import { queueBuyerNotification } from './buyerNotifications';
import { DomainError, notFound } from './errors';
import { haversineKm, resolvePoint } from './geo';
import { farmerStats, scoreLotForDemand } from './matching';
import { queueSms } from './notifications';
import { getCommodityById, getRegion } from './registries';
import { appendLotEvent } from './trace';
import { formatGhs } from './types';
import { queueVoiceCall } from './voiceCalls';

/**
 * Offer threads (Phase 1, docs/PHASE1.md): every offer is a negotiation
 * between one buyer and one farmer about one listing. The party whose turn it
 * is accepts, counters or rejects; the waiting party may withdraw; a proposal
 * lapses on the commodity's offer clock, restarted by each counter. Accepting
 * creates the order — a contract in ACCEPTED with the exact agreed total —
 * and every later step (payment, pickup, grading, transport) is unchanged.
 */

export type Party = 'buyer' | 'farmer';
export type Channel = 'web' | 'ussd' | 'ivr' | 'system';

const HOUR_MS = 60 * 60 * 1000;
/** A proposal waiting this long on the farmer gets one reminder SMS. */
export const OFFER_REMINDER_AFTER_MS = 3 * HOUR_MS;

// ── reading ────────────────────────────────────────────────────────────────

interface LotUnit {
  code: string;
  nameKey: string;
  kgPerUnit: number;
}

function lotUnit(lot: Lot): LotUnit {
  const unit = db.select().from(units).where(eq(units.id, lot.unitId)).get();
  if (!unit) throw notFound('unit');
  return { code: unit.code, nameKey: unit.nameKey, kgPerUnit: unit.kgPerUnit };
}

/** Whole units still on the listing (a part-unit left over never sells on its own). */
export function unitsAvailable(lot: Lot): number {
  const { kgPerUnit } = lotUnit(lot);
  return kgPerUnit > 0 ? Math.floor(lot.remainingKg / kgPerUnit + 1e-9) : 0;
}

export function getOffer(id: string): Offer {
  const offer = db.select().from(offers).where(eq(offers.id, id)).get();
  if (!offer) throw notFound('offer');
  return offer;
}

export function listOfferEvents(offerId: string): OfferEvent[] {
  return db.select().from(offerEvents).where(eq(offerEvents.offerId, offerId)).orderBy(offerEvents.createdAt).all();
}

function listOffers(where: ReturnType<typeof eq>, status?: 'open' | 'closed'): Offer[] {
  const rows = db.select().from(offers).where(where).orderBy(desc(offers.updatedAt)).all();
  if (status === 'open') return rows.filter((o) => o.status === 'open');
  if (status === 'closed') return rows.filter((o) => o.status !== 'open');
  return rows;
}

export const listOffersForBuyer = (buyerId: string, status?: 'open' | 'closed') => listOffers(eq(offers.buyerId, buyerId), status);
export const listOffersForFarmer = (farmerId: string, status?: 'open' | 'closed') => listOffers(eq(offers.farmerId, farmerId), status);
/** Every thread a buyer request started or that answers it (engine bids and farmers' offers), newest first. */
export const listOffersForDemand = (demandId: string, status?: 'open' | 'closed') => listOffers(eq(offers.demandId, demandId), status);
export const listOpenOffersForLot = (lotId: string) =>
  db.select().from(offers).where(and(eq(offers.lotId, lotId), eq(offers.status, 'open'))).all();

/** Everything a screen needs to draw one thread — the shape agreed with the web (docs/PHASE1.md). */
export interface OfferView {
  id: string;
  status: Offer['status'];
  turn: Offer['turn'];
  lot: {
    id: string;
    lotCode: string;
    commodityCode: string;
    commodityName: string;
    unitCode: string;
    unitName: string;
    kgPerUnit: number;
    askingPricePerUnit: number | null;
    unitsAvailable: number;
    declaredBand: string;
    community: string | null;
    regionName: string;
  };
  buyer: { id: string; name: string; company: string | null };
  farmer: { id: string; name: string; regionName: string };
  requestId: string | null;
  current: { units: number; pricePerUnit: number; total: number; by: Party; at: number };
  expiresAt: number | null;
  contractId: string | null;
  history: Array<{
    by: OfferEvent['by'];
    action: OfferEvent['action'];
    units: number | null;
    pricePerUnit: number | null;
    total: number | null;
    /** The price before this move, so a screen can say "up GHS 20". */
    previousPricePerUnit: number | null;
    channel: OfferEvent['channel'];
    at: number;
  }>;
  createdAt: number;
}

export function describeOffer(offer: Offer, opts: { photoUrl?: (lotId: string) => string | null } = {}): OfferView & { lot: { photoUrl: string | null } } {
  const lot = db.select().from(lots).where(eq(lots.id, offer.lotId)).get()!;
  const commodity = getCommodityById(lot.commodityId);
  const unit = lotUnit(lot);
  const buyer = db.select().from(buyers).where(eq(buyers.id, offer.buyerId)).get();
  const farmer = db.select().from(farmers).where(eq(farmers.id, offer.farmerId)).get();
  let lastPrice: number | null = null;
  const history = listOfferEvents(offer.id).map((e) => {
    const previous = e.pricePerUnit !== null ? lastPrice : null;
    if (e.pricePerUnit !== null) lastPrice = e.pricePerUnit;
    return {
      by: e.by,
      action: e.action,
      units: e.units,
      pricePerUnit: e.pricePerUnit,
      total: e.units !== null && e.pricePerUnit !== null ? Math.round(e.units * e.pricePerUnit) : null,
      previousPricePerUnit: e.action === 'counter' ? previous : null,
      channel: e.channel,
      at: e.createdAt,
    };
  });
  return {
    id: offer.id,
    status: offer.status,
    turn: offer.turn,
    lot: {
      id: lot.id,
      lotCode: lot.lotCode,
      commodityCode: commodity.code,
      commodityName: t('en', commodity.nameKey),
      unitCode: unit.code,
      unitName: t('en', unit.nameKey),
      kgPerUnit: unit.kgPerUnit,
      askingPricePerUnit: lot.askingPricePerUnit,
      unitsAvailable: ['registered', 'matched'].includes(lot.status) ? unitsAvailable(lot) : 0,
      declaredBand: lot.declaredBand,
      community: lot.community,
      regionName: t('en', getRegion(lot.regionCode).nameKey),
      photoUrl: opts.photoUrl?.(lot.id) ?? null,
    },
    buyer: { id: offer.buyerId, name: buyer?.name ?? 'Buyer', company: buyer?.company ?? null },
    farmer: {
      id: offer.farmerId,
      name: farmer?.name ?? 'Farmer',
      regionName: farmer ? t('en', getRegion(farmer.regionCode).nameKey) : '',
    },
    requestId: offer.demandId,
    current: {
      units: offer.units,
      pricePerUnit: offer.pricePerUnit,
      total: Math.round(offer.units * offer.pricePerUnit),
      by: offer.proposedBy,
      at: offer.proposedAt,
    },
    expiresAt: offer.status === 'open' ? offer.expiresAt : null,
    contractId: offer.contractId,
    history,
    createdAt: offer.createdAt,
  };
}

// ── validation helpers ────────────────────────────────────────────────────

function proposalTtlMs(lot: Lot): number {
  return getCommodityById(lot.commodityId).clock.offerTtlMinutes * 60 * 1000;
}

function assertProposal(lot: Lot, unitsWanted: number, pricePerUnit: number): void {
  if (!Number.isFinite(unitsWanted) || unitsWanted <= 0 || !Number.isInteger(unitsWanted)) {
    throw new DomainError('Offer a whole number of units — at least 1', 'INVALID_UNITS');
  }
  if (!Number.isInteger(pricePerUnit) || pricePerUnit <= 0) {
    throw new DomainError('Enter a price above zero', 'INVALID_PRICE');
  }
  if (lot.status !== 'registered' && lot.status !== 'matched') {
    throw new DomainError('This listing is no longer on the market', 'LOT_CLOSED', 409);
  }
  const left = unitsAvailable(lot);
  if (unitsWanted > left) {
    const unit = lotUnit(lot);
    throw new DomainError(
      left > 0 ? `Only ${left} ${t('en', unit.nameKey)}${left === 1 ? '' : 's'} left on this listing now` : 'Nothing is left on this listing now',
      'NOT_ENOUGH_LEFT',
      409,
    );
  }
}

function record(offerId: string, by: OfferEvent['by'], action: OfferEvent['action'], channel: Channel, units?: number, price?: number): void {
  db.insert(offerEvents)
    .values({ offerId, by, action, channel, units: units ?? null, pricePerUnit: price ?? null })
    .run();
}

/** Give back request kilograms a thread was holding (reject, withdraw, expire). */
function releaseHeldDemand(offer: Offer): void {
  if (!offer.demandId || offer.heldDemandKg <= 0) return;
  const demand = db.select().from(demands).where(eq(demands.id, offer.demandId)).get();
  if (!demand || demand.status === 'expired' || demand.status === 'cancelled') return;
  const remaining = Math.min(demand.quantityKg, demand.remainingKg + offer.heldDemandKg);
  db.update(demands)
    .set({ remainingKg: remaining, status: remaining >= demand.quantityKg ? 'open' : 'partially_matched' })
    .where(eq(demands.id, demand.id))
    .run();
}

// ── notifications ─────────────────────────────────────────────────────────

function sayUnits(locale: string, offer: Pick<Offer, 'units'>, lot: Lot): { units: number; unit: string } {
  return { units: offer.units, unit: t(locale, lotUnit(lot).nameKey) };
}

/** Tell the farmer it is their turn: SMS always, and a call they can answer by keypad. */
function notifyFarmerTurn(offer: Offer, templateKey: 'sms.bidReceived' | 'sms.counterReceived'): void {
  const farmer = db.select().from(farmers).where(eq(farmers.id, offer.farmerId)).get();
  const lot = db.select().from(lots).where(eq(lots.id, offer.lotId)).get();
  const buyer = db.select().from(buyers).where(eq(buyers.id, offer.buyerId)).get();
  if (!farmer || !lot) return;
  const commodity = getCommodityById(lot.commodityId);
  queueSms({
    phone: farmer.phone,
    locale: farmer.locale,
    templateKey,
    params: {
      buyer: buyer?.company ?? buyer?.name ?? 'A buyer',
      ...sayUnits(farmer.locale, offer, lot),
      commodity: t(farmer.locale, commodity.nameKey),
      price: formatGhs(offer.pricePerUnit),
      total: formatGhs(Math.round(offer.units * offer.pricePerUnit)),
      code: config.USSD_SHORTCODE,
    },
    lotId: lot.id,
  });
  queueVoiceCall({ phone: farmer.phone, locale: farmer.locale, flow: 'bid', offerId: offer.id });
}

function notifyBuyer(offer: Offer, templateKey: string, extra: Record<string, string | number> = {}): void {
  const farmer = db.select().from(farmers).where(eq(farmers.id, offer.farmerId)).get();
  const lot = db.select().from(lots).where(eq(lots.id, offer.lotId)).get();
  if (!lot) return;
  const commodity = getCommodityById(lot.commodityId);
  queueBuyerNotification({
    buyerId: offer.buyerId,
    templateKey,
    params: {
      farmer: farmer?.name ?? 'The farmer',
      ...sayUnits('en', offer, lot),
      commodity: t('en', commodity.nameKey),
      price: formatGhs(offer.pricePerUnit),
      total: formatGhs(Math.round(offer.units * offer.pricePerUnit)),
      ...extra,
    },
    lotId: lot.id,
    contractId: offer.contractId ?? undefined,
  });
}

function notifyFarmerSms(offer: Offer, templateKey: string): void {
  const farmer = db.select().from(farmers).where(eq(farmers.id, offer.farmerId)).get();
  const lot = db.select().from(lots).where(eq(lots.id, offer.lotId)).get();
  const buyer = db.select().from(buyers).where(eq(buyers.id, offer.buyerId)).get();
  if (!farmer || !lot) return;
  const commodity = getCommodityById(lot.commodityId);
  queueSms({
    phone: farmer.phone,
    locale: farmer.locale,
    templateKey,
    params: {
      buyer: buyer?.company ?? buyer?.name ?? 'The buyer',
      ...sayUnits(farmer.locale, offer, lot),
      commodity: t(farmer.locale, commodity.nameKey),
      price: formatGhs(offer.pricePerUnit),
      total: formatGhs(Math.round(offer.units * offer.pricePerUnit)),
      code: config.USSD_SHORTCODE,
    },
    lotId: lot.id,
    contractId: offer.contractId ?? undefined,
  });
}

// ── starting a thread ─────────────────────────────────────────────────────

export interface BidInput {
  buyerId: string;
  lotId: string;
  units: number;
  pricePerUnit: number;
  channel?: Channel;
}

/** A buyer bids on a listing. Nothing is reserved: many buyers may bid; the first acceptance wins. */
export function placeBid(input: BidInput): Offer {
  const lot = db.select().from(lots).where(eq(lots.id, input.lotId)).get();
  if (!lot) throw notFound('lot');
  assertProposal(lot, input.units, input.pricePerUnit);
  const open = db
    .select()
    .from(offers)
    .where(and(eq(offers.lotId, lot.id), eq(offers.buyerId, input.buyerId), eq(offers.status, 'open')))
    .get();
  if (open) throw new DomainError('You already have an open offer on this listing — answer or change that one', 'OFFER_EXISTS', 409);

  const now = Date.now();
  const offer = db
    .insert(offers)
    .values({
      lotId: lot.id,
      buyerId: input.buyerId,
      farmerId: lot.farmerId,
      turn: 'farmer',
      units: input.units,
      pricePerUnit: input.pricePerUnit,
      proposedBy: 'buyer',
      proposedAt: now,
      expiresAt: now + proposalTtlMs(lot),
    })
    .returning()
    .get();
  record(offer.id, 'buyer', 'bid', input.channel ?? 'web', input.units, input.pricePerUnit);
  notifyFarmerTurn(offer, 'sms.bidReceived');
  return offer;
}

export interface RequestOfferInput {
  farmerId: string;
  demandId: string;
  lotId: string;
  units: number;
  pricePerUnit: number;
  channel?: Channel;
}

/** A farmer answers a buyer request with one of their listings. Holds that many kg of the request. */
export function offerOnRequest(input: RequestOfferInput): Offer {
  const lot = db.select().from(lots).where(eq(lots.id, input.lotId)).get();
  if (!lot) throw notFound('lot');
  if (lot.farmerId !== input.farmerId) throw new DomainError('Not your listing', 'FORBIDDEN', 403);
  const demand = db.select().from(demands).where(eq(demands.id, input.demandId)).get();
  if (!demand || demand.origin !== 'request') throw notFound('request');
  if (demand.status !== 'open' && demand.status !== 'partially_matched') {
    throw new DomainError('This request is no longer open', 'REQUEST_CLOSED', 409);
  }
  if (demand.commodityId !== lot.commodityId) throw new DomainError('That listing is a different crop from the request', 'WRONG_CROP');
  assertProposal(lot, input.units, input.pricePerUnit);
  const kg = input.units * lotUnit(lot).kgPerUnit;
  if (kg > demand.remainingKg + 1e-9) {
    throw new DomainError(`The buyer needs only ${Math.floor(demand.remainingKg)}kg more`, 'MORE_THAN_NEEDED', 409);
  }
  const already = db
    .select()
    .from(offers)
    .where(and(eq(offers.lotId, lot.id), eq(offers.demandId, demand.id), eq(offers.status, 'open')))
    .get();
  if (already) throw new DomainError('You already have an open offer on this request — answer or change that one', 'OFFER_EXISTS', 409);

  const now = Date.now();
  const offer = db.transaction((tx) => {
    const row = tx
      .insert(offers)
      .values({
        lotId: lot.id,
        buyerId: demand.buyerId,
        farmerId: lot.farmerId,
        demandId: demand.id,
        turn: 'buyer',
        units: input.units,
        pricePerUnit: input.pricePerUnit,
        proposedBy: 'farmer',
        proposedAt: now,
        expiresAt: now + proposalTtlMs(lot),
        heldDemandKg: kg,
      })
      .returning()
      .get();
    const remaining = Math.max(0, demand.remainingKg - kg);
    tx.update(demands)
      .set({ remainingKg: remaining, status: remaining <= 0 ? 'fulfilled' : 'partially_matched' })
      .where(eq(demands.id, demand.id))
      .run();
    return row;
  });
  record(offer.id, 'farmer', 'bid', input.channel ?? 'web', input.units, input.pricePerUnit);
  notifyBuyer(offer, 'notif.farmerOffered');
  return offer;
}

/**
 * The matching engine's suggestion (D-016 one shot per lot+request kept): a
 * request that fits a listing becomes a buyer bid at the request's price for
 * the listing's declared grade, holding that many kg of the request.
 */
export function engineBid(args: { demandId: string; lot: Lot; units: number; pricePerUnit: number }): Offer {
  const { lot } = args;
  const demand = db.select().from(demands).where(eq(demands.id, args.demandId)).get()!;
  const kg = args.units * lotUnit(lot).kgPerUnit;
  const now = Date.now();
  const offer = db.transaction((tx) => {
    const row = tx
      .insert(offers)
      .values({
        lotId: lot.id,
        buyerId: demand.buyerId,
        farmerId: lot.farmerId,
        demandId: demand.id,
        turn: 'farmer',
        units: args.units,
        pricePerUnit: args.pricePerUnit,
        proposedBy: 'buyer',
        proposedAt: now,
        expiresAt: now + proposalTtlMs(lot),
        heldDemandKg: kg,
      })
      .returning()
      .get();
    const remaining = Math.max(0, demand.remainingKg - kg);
    tx.update(demands)
      .set({ remainingKg: remaining, status: remaining <= 0 ? 'fulfilled' : 'partially_matched' })
      .where(eq(demands.id, demand.id))
      .run();
    demand.remainingKg = remaining;
    appendLotEvent(tx, {
      lotId: lot.id,
      type: 'MATCHED',
      actorType: 'system',
      payload: { demandId: demand.id, offerId: row.id, allocatedKg: kg },
    });
    return row;
  });
  record(offer.id, 'system', 'bid', 'system', args.units, args.pricePerUnit);
  notifyFarmerTurn(offer, 'sms.bidReceived');
  return offer;
}

// ── moves ─────────────────────────────────────────────────────────────────

function partyId(offer: Offer, party: Party): string {
  return party === 'buyer' ? offer.buyerId : offer.farmerId;
}

function loadForMove(offerId: string, party: Party, actorId: string): Offer {
  const offer = getOffer(offerId);
  if (partyId(offer, party) !== actorId) throw new DomainError('Not your offer', 'FORBIDDEN', 403);
  if (offer.status !== 'open') throw new DomainError(`This offer is already ${offer.status}`, 'OFFER_CLOSED', 409);
  if (offer.expiresAt !== null && offer.expiresAt < Date.now()) {
    expireOffer(offer);
    throw new DomainError('This offer has lapsed — make a new one', 'OFFER_EXPIRED', 409);
  }
  return offer;
}

function assertTurn(offer: Offer, party: Party): void {
  if (offer.turn !== party) throw new DomainError('It is the other side’s turn to answer', 'NOT_YOUR_TURN', 409);
}

export function counterOffer(
  offerId: string,
  party: Party,
  actorId: string,
  input: { units?: number; pricePerUnit: number },
  channel: Channel = 'web',
): Offer {
  const offer = loadForMove(offerId, party, actorId);
  assertTurn(offer, party);
  const lot = db.select().from(lots).where(eq(lots.id, offer.lotId)).get()!;
  const unitsNext = input.units ?? offer.units;
  assertProposal(lot, unitsNext, input.pricePerUnit);
  if (offer.demandId) {
    // A request-held thread may shrink, never grow past what it already holds.
    const kgNext = unitsNext * lotUnit(lot).kgPerUnit;
    if (kgNext > offer.heldDemandKg + 1e-9) {
      throw new DomainError(`The buyer's request covers only ${offer.units} ${t('en', lotUnit(lot).nameKey)}s here`, 'MORE_THAN_NEEDED', 409);
    }
  }
  const now = Date.now();
  const next = party === 'buyer' ? 'farmer' : 'buyer';
  const updated = db
    .update(offers)
    .set({
      units: unitsNext,
      pricePerUnit: input.pricePerUnit,
      proposedBy: party,
      proposedAt: now,
      turn: next,
      expiresAt: now + proposalTtlMs(lot),
      reminderSentAt: null,
      updatedAt: now,
    })
    .where(eq(offers.id, offer.id))
    .returning()
    .get()!;
  record(offer.id, party, 'counter', channel, unitsNext, input.pricePerUnit);
  if (next === 'farmer') notifyFarmerTurn(updated, 'sms.counterReceived');
  else notifyBuyer(updated, 'notif.farmerCountered');
  return updated;
}

function close(offer: Offer, status: 'rejected' | 'withdrawn' | 'expired'): Offer {
  const updated = db
    .update(offers)
    .set({ status, turn: null, updatedAt: Date.now() })
    .where(eq(offers.id, offer.id))
    .returning()
    .get()!;
  releaseHeldDemand(offer);
  return updated;
}

export function rejectOffer(offerId: string, party: Party, actorId: string, channel: Channel = 'web'): Offer {
  const offer = loadForMove(offerId, party, actorId);
  assertTurn(offer, party);
  const closed = close(offer, 'rejected');
  record(offer.id, party, 'reject', channel);
  if (party === 'farmer') notifyBuyer(closed, 'notif.offerRejected');
  else notifyFarmerSms(closed, 'sms.offerEnded');
  return closed;
}

/** The waiting party takes back their proposal. */
export function withdrawOffer(offerId: string, party: Party, actorId: string, channel: Channel = 'web'): Offer {
  const offer = loadForMove(offerId, party, actorId);
  if (offer.turn === party) throw new DomainError('It is your turn — reject the offer instead', 'USE_REJECT', 409);
  const closed = close(offer, 'withdrawn');
  record(offer.id, party, 'withdraw', channel);
  if (party === 'buyer') notifyFarmerSms(closed, 'sms.offerEnded');
  else notifyBuyer(closed, 'notif.offerWithdrawn');
  return closed;
}

function expireOffer(offer: Offer): Offer {
  const closed = close(offer, 'expired');
  record(offer.id, 'system', 'expire', 'system');
  // Both sides hear about every move (PHASE1.md), and the wording depends on
  // who let the clock run out: the side whose turn it was.
  const farmerMissedIt = offer.turn === 'farmer';
  notifyBuyer(closed, farmerMissedIt ? 'notif.offerLapsed' : 'notif.proposalLapsed');
  notifyFarmerSms(closed, farmerMissedIt ? 'sms.offerLapsed' : 'sms.proposalLapsed');
  return closed;
}

// ── accepting: the order ──────────────────────────────────────────────────

/**
 * The party whose turn it is accepts the current proposal: one transaction
 * creates the order (demand → match → contract in ACCEPTED, exact agreed
 * total), takes the units off the listing and closes the thread. The caller
 * then starts the payment hold (acceptOfferThread in paymentFlow does both).
 */
export function acceptProposal(offerId: string, party: Party, actorId: string, channel: Channel = 'web'): { offer: Offer; contractId: string } {
  const offer = loadForMove(offerId, party, actorId);
  assertTurn(offer, party);
  const now = Date.now();

  const result = db.transaction((tx) => {
    const lot = tx.select().from(lots).where(eq(lots.id, offer.lotId)).get()!;
    assertProposal(lot, offer.units, offer.pricePerUnit); // still on the market, still enough left
    const unit = lotUnit(lot);
    const kg = offer.units * unit.kgPerUnit;
    const total = Math.round(offer.units * offer.pricePerUnit);
    const perKg = Math.round(offer.pricePerUnit / unit.kgPerUnit);
    const priceTerms = JSON.stringify({ A: perKg, B: perKg, C: perKg, REJECT: 0 });
    const commodity = getCommodityById(lot.commodityId);
    const buyer = tx.select().from(buyers).where(eq(buyers.id, offer.buyerId)).get()!;

    // Every order rides a demand and a match, as orders always have.
    let demandId = offer.demandId;
    if (demandId) {
      const demand = tx.select().from(demands).where(eq(demands.id, demandId)).get()!;
      // The held kg become the order; any shrink in the haggle goes back to the request.
      const giveBack = Math.max(0, offer.heldDemandKg - kg);
      if (giveBack > 0) {
        const remaining = Math.min(demand.quantityKg, demand.remainingKg + giveBack);
        tx.update(demands)
          .set({ remainingKg: remaining, status: remaining > 0 ? 'partially_matched' : 'fulfilled' })
          .where(eq(demands.id, demandId))
          .run();
      }
    } else {
      demandId = tx
        .insert(demands)
        .values({
          buyerId: offer.buyerId,
          commodityId: lot.commodityId,
          quantityKg: kg,
          remainingKg: 0,
          minBand: lot.declaredBand,
          priceTerms,
          windowStart: Math.max(now, lot.readyDate),
          windowEnd: Math.max(now, lot.readyDate) + commodity.clock.maxWindowDays * 24 * HOUR_MS,
          regionCode: buyer.regionCode ?? lot.regionCode,
          gpsLat: buyer.gpsLat,
          gpsLng: buyer.gpsLng,
          status: 'fulfilled',
          origin: 'deal',
        })
        .returning()
        .get().id;
    }
    const demand = tx.select().from(demands).where(eq(demands.id, demandId)).get()!;
    const { score, breakdown } = scoreLotForDemand({
      lot,
      demand: { ...demand, remainingKg: kg },
      clockType: commodity.clockType,
      clock: commodity.clock,
      distanceKm: haversineKm(resolvePoint(lot.gpsLat, lot.gpsLng, lot.regionCode), resolvePoint(demand.gpsLat, demand.gpsLng, demand.regionCode)),
      stats: farmerStats(lot.farmerId),
    });
    const match = tx
      .insert(matches)
      .values({ demandId, lotId: lot.id, allocatedKg: kg, score, scoreBreakdown: JSON.stringify(breakdown), status: 'accepted', offeredAt: now })
      .returning()
      .get();
    const contract = tx
      .insert(contracts)
      .values({
        matchId: match.id,
        demandId,
        lotId: lot.id,
        buyerId: offer.buyerId,
        farmerId: offer.farmerId,
        commodityId: lot.commodityId,
        quantityKg: kg,
        priceTerms,
        holdAmount: total,
        agreedTotal: total,
        state: 'ACCEPTED',
        acceptedAt: now,
      })
      .returning()
      .get();

    const remainingKg = Math.max(0, lot.remainingKg - kg);
    tx.update(lots)
      .set({ remainingKg, status: remainingKg > 1e-9 ? lot.status : 'contracted' })
      .where(eq(lots.id, lot.id))
      .run();
    tx.update(offers)
      .set({ status: 'accepted', turn: null, contractId: contract.id, heldDemandKg: 0, updatedAt: now })
      .where(eq(offers.id, offer.id))
      .run();
    appendLotEvent(tx, {
      lotId: lot.id,
      type: 'CONTRACT_ACCEPTED',
      actorType: party,
      actorId,
      payload: { contractId: contract.id, offerId: offer.id, allocatedKg: kg, units: offer.units },
    });
    return { contractId: contract.id, soldOut: remainingKg <= 1e-9 };
  });

  record(offer.id, party, 'accept', channel, offer.units, offer.pricePerUnit);
  const closed = getOffer(offer.id);
  notifyFarmerSms(closed, 'sms.offerAgreed');
  notifyBuyer(closed, 'notif.dealAgreed');
  // Nothing left to sell: the other bids end now, not hours later on their own
  // clock, so those buyers can look elsewhere and any request kg they held free up.
  if (result.soldOut) closeOffersForLot(offer.lotId, 'withdrawn');
  return { offer: closed, contractId: result.contractId };
}

// ── the sweep ─────────────────────────────────────────────────────────────

/** Close proposals past their clock; nudge farmers who have kept a buyer waiting. */
export function sweepOffers(now = Date.now()): { expired: number; reminded: number } {
  const lapsed = db
    .select()
    .from(offers)
    .where(and(eq(offers.status, 'open'), lt(offers.expiresAt, now)))
    .all();
  for (const offer of lapsed) expireOffer(offer);

  const waiting = db
    .select()
    .from(offers)
    .where(
      and(
        eq(offers.status, 'open'),
        eq(offers.turn, 'farmer'),
        isNull(offers.reminderSentAt),
        lt(offers.proposedAt, now - OFFER_REMINDER_AFTER_MS),
      ),
    )
    .all()
    .filter((o) => o.expiresAt === null || o.expiresAt > now);
  for (const offer of waiting) {
    notifyFarmerSms(offer, 'sms.offerReminder');
    db.update(offers).set({ reminderSentAt: now }).where(eq(offers.id, offer.id)).run();
  }
  return { expired: lapsed.length, reminded: waiting.length };
}

/** Open threads on a listing that is leaving the market are closed with it. */
export function closeOffersForLot(lotId: string, reason: 'withdrawn' | 'expired'): number {
  const open = db
    .select()
    .from(offers)
    .where(and(eq(offers.lotId, lotId), inArray(offers.status, ['open'])))
    .all();
  for (const offer of open) {
    const closed = close(offer, reason);
    record(offer.id, 'system', reason === 'withdrawn' ? 'withdraw' : 'expire', 'system');
    notifyBuyer(closed, 'notif.listingClosed');
  }
  return open.length;
}
