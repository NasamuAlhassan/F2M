import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () =>
  integer('created_at')
    .notNull()
    .$defaultFn(() => Date.now());

// All money columns are integer pesewas (GHS minor units). See D-011.
// All JSON columns are text, parsed through Zod accessors in domain services. See D-004.

export const regions = sqliteTable('regions', {
  code: text('code').primaryKey(),
  nameKey: text('name_key').notNull(),
  lat: real('lat').notNull(),
  lng: real('lng').notNull(),
});

export const farmers = sqliteTable(
  'farmers',
  {
    id: id(),
    phone: text('phone').notNull(), // E.164 — the USSD identity
    name: text('name').notNull(),
    regionCode: text('region_code')
      .notNull()
      .references(() => regions.code),
    district: text('district'),
    gpsLat: real('gps_lat'),
    gpsLng: real('gps_lng'),
    momoMsisdn: text('momo_msisdn').notNull(),
    locale: text('locale').notNull().default('en'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('farmers_phone_idx').on(t.phone)],
);

export const buyers = sqliteTable(
  'buyers',
  {
    id: id(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    name: text('name').notNull(),
    company: text('company'),
    phone: text('phone'),
    momoMsisdn: text('momo_msisdn').notNull(),
    regionCode: text('region_code').references(() => regions.code),
    gpsLat: real('gps_lat'),
    gpsLng: real('gps_lng'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('buyers_email_idx').on(t.email)],
);

export const commodities = sqliteTable(
  'commodities',
  {
    id: id(),
    code: text('code').notNull(),
    nameKey: text('name_key').notNull(),
    category: text('category', { enum: ['grain', 'perishable', 'tuber'] }).notNull(),
    clockType: text('clock_type', { enum: ['storable', 'perishable'] }).notNull(),
    clockConfig: text('clock_config').notNull(), // JSON ClockConfig
    activeRubricVersion: integer('active_rubric_version').notNull().default(1),
    sortOrder: integer('sort_order').notNull().default(100), // menu position — most-traded first
  },
  (t) => [uniqueIndex('commodities_code_idx').on(t.code)],
);

export const units = sqliteTable(
  'units',
  {
    id: id(),
    commodityId: text('commodity_id')
      .notNull()
      .references(() => commodities.id),
    code: text('code').notNull(),
    nameKey: text('name_key').notNull(),
    kgPerUnit: real('kg_per_unit').notNull(), // commodity-scoped: maize-olonka ≠ groundnut-olonka
    isInformal: integer('is_informal', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [uniqueIndex('units_commodity_code_idx').on(t.commodityId, t.code)],
);

export const rubrics = sqliteTable(
  'rubrics',
  {
    id: id(),
    commodityId: text('commodity_id')
      .notNull()
      .references(() => commodities.id),
    version: integer('version').notNull(),
    doc: text('doc').notNull(), // JSON RubricDoc
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('rubrics_commodity_version_idx').on(t.commodityId, t.version)],
);

export const lots = sqliteTable(
  'lots',
  {
    id: id(),
    lotCode: text('lot_code').notNull(), // short human code read back over USSD, e.g. FTM-7Q2K
    farmerId: text('farmer_id')
      .notNull()
      .references(() => farmers.id),
    commodityId: text('commodity_id')
      .notNull()
      .references(() => commodities.id),
    quantityKg: real('quantity_kg').notNull(), // canonical — converted once, at intake
    remainingKg: real('remaining_kg').notNull(),
    unitId: text('unit_id')
      .notNull()
      .references(() => units.id),
    unitQty: real('unit_qty').notNull(),
    declaredBand: text('declared_band').notNull(), // farmer self-assessment, soft signal only
    readyDate: integer('ready_date').notNull(), // ms; future date on a storable = forward listing
    askingPricePerKg: integer('asking_price_per_kg'), // pesewas, optional
    regionCode: text('region_code')
      .notNull()
      .references(() => regions.code),
    gpsLat: real('gps_lat'),
    gpsLng: real('gps_lng'),
    status: text('status', {
      enum: ['registered', 'matched', 'contracted', 'graded', 'settled', 'expired', 'withdrawn'],
    })
      .notNull()
      .default('registered'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('lots_code_idx').on(t.lotCode),
    index('lots_farmer_idx').on(t.farmerId),
    index('lots_commodity_status_idx').on(t.commodityId, t.status),
  ],
);

export const demands = sqliteTable(
  'demands',
  {
    id: id(),
    buyerId: text('buyer_id')
      .notNull()
      .references(() => buyers.id),
    commodityId: text('commodity_id')
      .notNull()
      .references(() => commodities.id),
    quantityKg: real('quantity_kg').notNull(),
    remainingKg: real('remaining_kg').notNull(),
    minBand: text('min_band').notNull(),
    priceTerms: text('price_terms').notNull(), // JSON: { band: pesewasPerKg }
    windowStart: integer('window_start').notNull(),
    windowEnd: integer('window_end').notNull(),
    regionCode: text('region_code')
      .notNull()
      .references(() => regions.code),
    gpsLat: real('gps_lat'),
    gpsLng: real('gps_lng'),
    status: text('status', {
      enum: ['open', 'partially_matched', 'fulfilled', 'expired', 'cancelled'],
    })
      .notNull()
      .default('open'),
    createdAt: createdAt(),
  },
  (t) => [index('demands_buyer_idx').on(t.buyerId), index('demands_commodity_status_idx').on(t.commodityId, t.status)],
);

export const matches = sqliteTable(
  'matches',
  {
    id: id(),
    demandId: text('demand_id')
      .notNull()
      .references(() => demands.id),
    lotId: text('lot_id')
      .notNull()
      .references(() => lots.id),
    allocatedKg: real('allocated_kg').notNull(),
    score: real('score').notNull(),
    scoreBreakdown: text('score_breakdown').notNull(), // JSON — rendered in portal, matching is explainable
    status: text('status', {
      enum: ['proposed', 'offered', 'accepted', 'declined', 'expired', 'superseded'],
    })
      .notNull()
      .default('proposed'),
    offeredAt: integer('offered_at'),
    expiresAt: integer('expires_at'), // from commodity clock_config.offerTtlMinutes
    createdAt: createdAt(),
  },
  (t) => [index('matches_demand_idx').on(t.demandId), index('matches_lot_idx').on(t.lotId)],
);

export const CONTRACT_STATES = [
  'OFFERED',
  'DECLINED',
  'EXPIRED',
  'ACCEPTED',
  'FUNDING_FAILED',
  'CANCELLED',
  'FUNDS_HELD',
  'PICKUP_CONFIRMED',
  'GRADED',
  'DISPUTED',
  'CANCELLED_REFUNDED',
  'SETTLED',
] as const;
export type ContractState = (typeof CONTRACT_STATES)[number];

export const contracts = sqliteTable(
  'contracts',
  {
    id: id(),
    matchId: text('match_id')
      .notNull()
      .references(() => matches.id),
    demandId: text('demand_id')
      .notNull()
      .references(() => demands.id),
    lotId: text('lot_id')
      .notNull()
      .references(() => lots.id),
    buyerId: text('buyer_id')
      .notNull()
      .references(() => buyers.id),
    farmerId: text('farmer_id')
      .notNull()
      .references(() => farmers.id),
    commodityId: text('commodity_id')
      .notNull()
      .references(() => commodities.id),
    quantityKg: real('quantity_kg').notNull(),
    priceTerms: text('price_terms').notNull(), // JSON, frozen at offer time — D-015
    holdAmount: integer('hold_amount').notNull(), // pesewas = qty × best-band price
    displayCurrency: text('display_currency').notNull().default('GHS'),
    settlementCurrency: text('settlement_currency').notNull().default('GHS'), // EUR on the MoMo sandbox wire
    state: text('state', { enum: CONTRACT_STATES }).notNull().default('OFFERED'),
    finalGrade: text('final_grade'),
    finalAmount: integer('final_amount'), // pesewas = qty × price_terms[final_grade]
    declineReasonKey: text('decline_reason_key'),
    disputeNote: text('dispute_note'),
    fundingAttempts: integer('funding_attempts').notNull().default(0),
    acceptedAt: integer('accepted_at'),
    fundedAt: integer('funded_at'),
    pickupConfirmedAt: integer('pickup_confirmed_at'),
    gradedAt: integer('graded_at'),
    settledAt: integer('settled_at'),
    closedAt: integer('closed_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('contracts_match_idx').on(t.matchId),
    index('contracts_farmer_idx').on(t.farmerId),
    index('contracts_buyer_idx').on(t.buyerId),
    index('contracts_state_idx').on(t.state),
  ],
);

export const gradings = sqliteTable(
  'gradings',
  {
    id: id(),
    contractId: text('contract_id')
      .notNull()
      .references(() => contracts.id),
    lotId: text('lot_id')
      .notNull()
      .references(() => lots.id),
    rubricId: text('rubric_id')
      .notNull()
      .references(() => rubrics.id), // pinned version — disputes re-grade under the same rubric
    attempt: integer('attempt').notNull().default(1),
    provider: text('provider', { enum: ['hf', 'mock'] }).notNull(),
    model: text('model'),
    gradeBand: text('grade_band'),
    confidence: real('confidence'),
    reasons: text('reasons'), // JSON GradingReason[]
    rawResponse: text('raw_response'),
    status: text('status', { enum: ['pending', 'completed', 'failed', 'disputed', 'resolved'] })
      .notNull()
      .default('pending'),
    createdAt: createdAt(),
  },
  (t) => [index('gradings_contract_idx').on(t.contractId)],
);

export const photos = sqliteTable(
  'photos',
  {
    id: id(),
    lotId: text('lot_id')
      .notNull()
      .references(() => lots.id),
    contractId: text('contract_id').references(() => contracts.id),
    gradingId: text('grading_id').references(() => gradings.id),
    path: text('path').notNull(), // relative, posix separators — becomes a URL
    mime: text('mime').notNull(),
    bytes: integer('bytes').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('photos_lot_idx').on(t.lotId), index('photos_contract_idx').on(t.contractId)],
);

export const payments = sqliteTable(
  'payments',
  {
    id: id(),
    contractId: text('contract_id')
      .notNull()
      .references(() => contracts.id),
    direction: text('direction', { enum: ['collection', 'disbursement'] }).notNull(),
    provider: text('provider', { enum: ['momo', 'mock'] }).notNull(),
    providerRef: text('provider_ref').notNull(), // UUID sent as X-Reference-Id — idempotency key
    amount: integer('amount').notNull(), // pesewas
    currency: text('currency').notNull(),
    counterpartyMsisdn: text('counterparty_msisdn').notNull(),
    status: text('status', { enum: ['pending', 'successful', 'failed'] }).notNull().default('pending'),
    raw: text('raw'), // last status/callback payload, JSON
    createdAt: createdAt(),
    updatedAt: integer('updated_at')
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (t) => [uniqueIndex('payments_provider_ref_idx').on(t.providerRef), index('payments_contract_idx').on(t.contractId)],
);

export const ledgerEntries = sqliteTable(
  'ledger_entries',
  {
    id: id(),
    journalId: text('journal_id').notNull(), // groups a balanced posting — every journal sums to zero
    account: text('account').notNull(), // external:momo | escrow:contract:{id} | farmer:{id}:payable | buyer:{id}:refunds
    debit: integer('debit').notNull().default(0), // pesewas; exactly one of debit/credit is non-zero
    credit: integer('credit').notNull().default(0),
    contractId: text('contract_id').references(() => contracts.id),
    memoKey: text('memo_key'),
    createdAt: createdAt(),
  },
  (t) => [index('ledger_journal_idx').on(t.journalId), index('ledger_account_idx').on(t.account)],
);

export const LOT_EVENT_TYPES = [
  'LOT_REGISTERED',
  'MATCHED',
  'CONTRACT_OFFERED',
  'CONTRACT_ACCEPTED',
  'CONTRACT_DECLINED',
  'OFFER_EXPIRED',
  'FUNDING_FAILED',
  'FUNDS_HELD',
  'PICKUP_CONFIRMED',
  'PHOTO_ADDED',
  'GRADED',
  'DISPUTE_OPENED',
  'DISPUTE_RESOLVED',
  'PAYMENT_RELEASED',
  'REFUNDED',
  'CANCELLED',
  'SETTLED',
] as const;
export type LotEventType = (typeof LOT_EVENT_TYPES)[number];

export const lotEvents = sqliteTable(
  'lot_events',
  {
    id: id(),
    lotId: text('lot_id')
      .notNull()
      .references(() => lots.id),
    seq: integer('seq').notNull(), // per-lot monotonic — append-only, never updated or deleted
    type: text('type', { enum: LOT_EVENT_TYPES }).notNull(),
    actorType: text('actor_type', { enum: ['farmer', 'buyer', 'system'] }).notNull(),
    actorId: text('actor_id'),
    payload: text('payload'), // JSON
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('lot_events_lot_seq_idx').on(t.lotId, t.seq)],
);

// Published reference prices — what her onions fetch in Techiman before she
// agrees to a number at her gate. Latest-only per (commodity, market); real
// feeds can relax this later.
export const marketPrices = sqliteTable(
  'market_prices',
  {
    id: id(),
    commodityId: text('commodity_id')
      .notNull()
      .references(() => commodities.id),
    market: text('market').notNull(), // proper noun, e.g. 'Techiman', 'Agbogbloshie'
    regionCode: text('region_code')
      .notNull()
      .references(() => regions.code),
    pricePerKg: integer('price_per_kg').notNull(), // pesewas
    recordedAt: integer('recorded_at').notNull(),
  },
  (t) => [uniqueIndex('market_prices_commodity_market_idx').on(t.commodityId, t.market)],
);

export const ussdSessions = sqliteTable('ussd_sessions', {
  sessionId: text('session_id').primaryKey(), // the gateway's sessionId
  phone: text('phone').notNull(),
  screen: text('screen').notNull(),
  ctx: text('ctx').notNull().default('{}'), // JSON — partial form data, pagination cursors, selected ids
  updatedAt: integer('updated_at')
    .notNull()
    .$defaultFn(() => Date.now()),
});

export type Farmer = typeof farmers.$inferSelect;
export type Buyer = typeof buyers.$inferSelect;
export type Commodity = typeof commodities.$inferSelect;
export type Unit = typeof units.$inferSelect;
export type Rubric = typeof rubrics.$inferSelect;
export type Lot = typeof lots.$inferSelect;
export type Demand = typeof demands.$inferSelect;
export type Match = typeof matches.$inferSelect;
export type Contract = typeof contracts.$inferSelect;
export type Grading = typeof gradings.$inferSelect;
export type Photo = typeof photos.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type LotEvent = typeof lotEvents.$inferSelect;
export type UssdSession = typeof ussdSessions.$inferSelect;
export type Region = typeof regions.$inferSelect;
export type MarketPrice = typeof marketPrices.$inferSelect;
