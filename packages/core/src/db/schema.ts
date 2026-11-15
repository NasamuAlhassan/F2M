import { bigint, boolean, doublePrecision, index, pgSchema, text, uniqueIndex } from 'drizzle-orm/pg-core';

// Postgres (Supabase in production, PGlite in tests and local dev; docs/HOSTING.md).
// Every whole number is a 64-bit bigint read as a JS number: epoch milliseconds
// (~1.8e12) do not fit Postgres's 32-bit integer.
//
// Every table lives in the `f2m` schema, not `public`: Supabase publishes `public` through its
// REST API to anyone holding the anon key (which the web app ships with), so
// F2M's data stays out of it and only the server's own connection reaches it.
export const f2m = pgSchema('f2m');

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () =>
  bigint('created_at', { mode: 'number' })
    .notNull()
    .$defaultFn(() => Date.now());

// All money columns are integer pesewas (GHS minor units). See D-011.
// All JSON columns are text, parsed through Zod accessors in domain services. See D-004.

export const regions = f2m.table('regions', {
  code: text('code').primaryKey(),
  nameKey: text('name_key').notNull(),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
});

export const farmers = f2m.table(
  'farmers',
  {
    id: id(),
    phone: text('phone').notNull(), // E.164 — the USSD identity
    name: text('name').notNull(),
    regionCode: text('region_code')
      .notNull()
      .references(() => regions.code),
    district: text('district'),
    gpsLat: doublePrecision('gps_lat'),
    gpsLng: doublePrecision('gps_lng'),
    momoMsisdn: text('momo_msisdn').notNull(),
    locale: text('locale').notNull().default('en'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('farmers_phone_idx').on(t.phone)],
);

export const buyers = f2m.table(
  'buyers',
  {
    id: id(),
    email: text('email'), // optional contact; logins are phone + password in Supabase (D-047)
    name: text('name').notNull(),
    company: text('company'),
    phone: text('phone'), // E.164 — the login identity for buyers who signed up on the web
    momoMsisdn: text('momo_msisdn').notNull(),
    regionCode: text('region_code').references(() => regions.code),
    gpsLat: doublePrecision('gps_lat'),
    gpsLng: doublePrecision('gps_lng'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('buyers_email_idx').on(t.email), uniqueIndex('buyers_phone_idx').on(t.phone)],
);

/**
 * One row per web login (D-047): the Supabase user (the JWT `sub`) and the
 * one F2M role that phone holds. Exactly one of farmerId/buyerId/driverId is
 * set, matching `role`. USSD and IVR never need an account — the carrier
 * tells us the caller's number.
 */
export const accounts = f2m.table(
  'accounts',
  {
    id: id(),
    authUserId: text('auth_user_id').notNull(),
    phone: text('phone').notNull(), // E.164
    role: text('role', { enum: ['farmer', 'buyer', 'driver'] }).notNull(),
    farmerId: text('farmer_id').references(() => farmers.id),
    buyerId: text('buyer_id').references(() => buyers.id),
    driverId: text('driver_id').references(() => drivers.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('accounts_auth_user_idx').on(t.authUserId), uniqueIndex('accounts_phone_idx').on(t.phone)],
);

export const commodities = f2m.table(
  'commodities',
  {
    id: id(),
    code: text('code').notNull(),
    nameKey: text('name_key').notNull(),
    category: text('category', { enum: ['grain', 'perishable', 'tuber'] }).notNull(),
    clockType: text('clock_type', { enum: ['storable', 'perishable'] }).notNull(),
    clockConfig: text('clock_config').notNull(), // JSON ClockConfig
    activeRubricVersion: bigint('active_rubric_version', { mode: 'number' }).notNull().default(1),
    sortOrder: bigint('sort_order', { mode: 'number' }).notNull().default(100), // menu position — most-traded first
  },
  (t) => [uniqueIndex('commodities_code_idx').on(t.code)],
);

export const units = f2m.table(
  'units',
  {
    id: id(),
    commodityId: text('commodity_id')
      .notNull()
      .references(() => commodities.id),
    code: text('code').notNull(),
    nameKey: text('name_key').notNull(),
    kgPerUnit: doublePrecision('kg_per_unit').notNull(), // commodity-scoped: maize-olonka ≠ groundnut-olonka
    isInformal: boolean('is_informal').notNull().default(false),
  },
  (t) => [uniqueIndex('units_commodity_code_idx').on(t.commodityId, t.code)],
);

export const rubrics = f2m.table(
  'rubrics',
  {
    id: id(),
    commodityId: text('commodity_id')
      .notNull()
      .references(() => commodities.id),
    version: bigint('version', { mode: 'number' }).notNull(),
    doc: text('doc').notNull(), // JSON RubricDoc
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('rubrics_commodity_version_idx').on(t.commodityId, t.version)],
);

export const lots = f2m.table(
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
    quantityKg: doublePrecision('quantity_kg').notNull(), // canonical — converted once, at intake
    remainingKg: doublePrecision('remaining_kg').notNull(),
    unitId: text('unit_id')
      .notNull()
      .references(() => units.id),
    unitQty: doublePrecision('unit_qty').notNull(),
    declaredBand: text('declared_band').notNull(), // farmer self-assessment, soft signal only
    // How the listing was made (D-036): web sellers upload photos; ussd/ivr
    // sellers may not read SMS, so buyers see their phone and call instead.
    channel: text('channel', { enum: ['web', 'ussd', 'ivr'] }).notNull().default('ussd'),
    readyDate: bigint('ready_date', { mode: 'number' }).notNull(), // ms; future date on a storable = forward listing
    askingPricePerKg: bigint('asking_price_per_kg', { mode: 'number' }), // pesewas, optional — derived from the per-unit price when one is set
    // The farmer's own asking price per unit of the listing (per bag, crate…), pesewas (Phase 1).
    askingPricePerUnit: bigint('asking_price_per_unit', { mode: 'number' }),
    harvestedAt: bigint('harvested_at', { mode: 'number' }), // ms, optional
    community: text('community'), // town/village — finer than the region (vision §5.2)
    landmark: text('landmark'), // "behind the Methodist school" — for the driver
    expiresAt: bigint('expires_at', { mode: 'number' }), // ms; the listing lapses then unless renewed (Phase 1)
    expiryWarnedAt: bigint('expiry_warned_at', { mode: 'number' }), // ms; the warning SMS went out
    regionCode: text('region_code')
      .notNull()
      .references(() => regions.code),
    gpsLat: doublePrecision('gps_lat'),
    gpsLng: doublePrecision('gps_lng'),
    status: text('status', {
      enum: ['registered', 'matched', 'contracted', 'graded', 'settled', 'expired', 'withdrawn', 'sold'],
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

export const demands = f2m.table(
  'demands',
  {
    id: id(),
    buyerId: text('buyer_id')
      .notNull()
      .references(() => buyers.id),
    commodityId: text('commodity_id')
      .notNull()
      .references(() => commodities.id),
    quantityKg: doublePrecision('quantity_kg').notNull(),
    remainingKg: doublePrecision('remaining_kg').notNull(),
    minBand: text('min_band').notNull(),
    priceTerms: text('price_terms').notNull(), // JSON: { band: pesewasPerKg }
    windowStart: bigint('window_start', { mode: 'number' }).notNull(),
    windowEnd: bigint('window_end', { mode: 'number' }).notNull(),
    regionCode: text('region_code')
      .notNull()
      .references(() => regions.code),
    gpsLat: doublePrecision('gps_lat'),
    gpsLng: doublePrecision('gps_lng'),
    status: text('status', {
      enum: ['open', 'partially_matched', 'fulfilled', 'expired', 'cancelled'],
    })
      .notNull()
      .default('open'),
    // 'request' = a buyer's public request; 'deal' = the record behind a negotiated
    // order (Phase 1) — never shown as a request, never re-opened for matching.
    origin: text('origin', { enum: ['request', 'deal'] }).notNull().default('request'),
    createdAt: createdAt(),
  },
  (t) => [index('demands_buyer_idx').on(t.buyerId), index('demands_commodity_status_idx').on(t.commodityId, t.status)],
);

export const matches = f2m.table(
  'matches',
  {
    id: id(),
    demandId: text('demand_id')
      .notNull()
      .references(() => demands.id),
    lotId: text('lot_id')
      .notNull()
      .references(() => lots.id),
    allocatedKg: doublePrecision('allocated_kg').notNull(),
    score: doublePrecision('score').notNull(),
    scoreBreakdown: text('score_breakdown').notNull(), // JSON — rendered in portal, matching is explainable
    status: text('status', {
      enum: ['proposed', 'offered', 'accepted', 'declined', 'expired', 'superseded'],
    })
      .notNull()
      .default('proposed'),
    offeredAt: bigint('offered_at', { mode: 'number' }),
    expiresAt: bigint('expires_at', { mode: 'number' }), // from commodity clock_config.offerTtlMinutes
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
  // Phase 3 (docs/PHASE3.md): the produce has arrived and the buyer's receipt
  // clock runs; the buyer reported a problem; the buyer received it (or the
  // clock did) and the farmer's balance is on its way.
  'DELIVERED',
  'CLAIMED',
  'RECEIVED',
  'CANCELLED_REFUNDED',
  'SETTLED',
] as const;
export type ContractState = (typeof CONTRACT_STATES)[number];

export const contracts = f2m.table(
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
    quantityKg: doublePrecision('quantity_kg').notNull(),
    priceTerms: text('price_terms').notNull(), // JSON, frozen at offer time — D-015
    holdAmount: bigint('hold_amount', { mode: 'number' }).notNull(), // pesewas = qty × best-band price
    displayCurrency: text('display_currency').notNull().default('GHS'),
    settlementCurrency: text('settlement_currency').notNull().default('GHS'), // the currency the payment rail moves
    state: text('state', { enum: CONTRACT_STATES }).notNull().default('OFFERED'),
    finalGrade: text('final_grade'),
    finalAmount: bigint('final_amount', { mode: 'number' }), // pesewas = qty × price_terms[final_grade]
    // A negotiated deal's exact total (units × price per unit), pesewas. Set → the farmer is
    // paid this whatever the grade (REJECT still refunds) until Phase 3 reworks quality.
    agreedTotal: bigint('agreed_total', { mode: 'number' }),
    // Phase 3 money: the advance paid at pickup, the deduction agreed on a claim (pesewas).
    advanceAmount: bigint('advance_amount', { mode: 'number' }),
    deductionAmount: bigint('deduction_amount', { mode: 'number' }),
    declineReasonKey: text('decline_reason_key'),
    disputeNote: text('dispute_note'),
    fundingAttempts: bigint('funding_attempts', { mode: 'number' }).notNull().default(0),
    acceptedAt: bigint('accepted_at', { mode: 'number' }),
    fundedAt: bigint('funded_at', { mode: 'number' }),
    pickupConfirmedAt: bigint('pickup_confirmed_at', { mode: 'number' }),
    gradedAt: bigint('graded_at', { mode: 'number' }),
    deliveredAt: bigint('delivered_at', { mode: 'number' }),
    /** When a silent buyer's delivery confirms itself (Phase 3: delivered + 24 h). */
    receiptDueAt: bigint('receipt_due_at', { mode: 'number' }),
    receivedAt: bigint('received_at', { mode: 'number' }),
    settledAt: bigint('settled_at', { mode: 'number' }),
    closedAt: bigint('closed_at', { mode: 'number' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('contracts_match_idx').on(t.matchId),
    index('contracts_farmer_idx').on(t.farmerId),
    index('contracts_buyer_idx').on(t.buyerId),
    index('contracts_state_idx').on(t.state),
  ],
);

export const gradings = f2m.table(
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
    attempt: bigint('attempt', { mode: 'number' }).notNull().default(1),
    provider: text('provider', { enum: ['hf', 'mock'] }).notNull(),
    model: text('model'),
    gradeBand: text('grade_band'),
    confidence: doublePrecision('confidence'),
    reasons: text('reasons'), // JSON GradingReason[]
    rawResponse: text('raw_response'),
    status: text('status', { enum: ['pending', 'completed', 'failed', 'disputed', 'resolved'] })
      .notNull()
      .default('pending'),
    createdAt: createdAt(),
  },
  (t) => [index('gradings_contract_idx').on(t.contractId)],
);

export const photos = f2m.table(
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
    bytes: bigint('bytes', { mode: 'number' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('photos_lot_idx').on(t.lotId), index('photos_contract_idx').on(t.contractId)],
);

export const payments = f2m.table(
  'payments',
  {
    id: id(),
    contractId: text('contract_id')
      .notNull()
      .references(() => contracts.id),
    jobId: text('job_id').references(() => deliveryJobs.id), // set for transport-fee payments
    direction: text('direction', { enum: ['collection', 'disbursement'] }).notNull(),
    /** What a farmer payout is for (Phase 3): the advance at pickup, or the balance on receipt. Null for holds, driver fees, legacy rows. */
    kind: text('kind', { enum: ['advance', 'balance'] }),
    provider: text('provider', { enum: ['mock'] }).notNull(), // a licensed payment provider joins in Phase 6
    providerRef: text('provider_ref').notNull(), // UUID sent as X-Reference-Id — idempotency key
    amount: bigint('amount', { mode: 'number' }).notNull(), // pesewas
    currency: text('currency').notNull(),
    counterpartyMsisdn: text('counterparty_msisdn').notNull(),
    status: text('status', { enum: ['pending', 'successful', 'failed'] }).notNull().default('pending'),
    raw: text('raw'), // last status/callback payload, JSON
    createdAt: createdAt(),
    updatedAt: bigint('updated_at', { mode: 'number' })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (t) => [uniqueIndex('payments_provider_ref_idx').on(t.providerRef), index('payments_contract_idx').on(t.contractId)],
);

export const ledgerEntries = f2m.table(
  'ledger_entries',
  {
    id: id(),
    journalId: text('journal_id').notNull(), // groups a balanced posting — every journal sums to zero
    account: text('account').notNull(), // external:momo | escrow:contract:{id} | farmer:{id}:payable | buyer:{id}:refunds
    debit: bigint('debit', { mode: 'number' }).notNull().default(0), // pesewas; exactly one of debit/credit is non-zero
    credit: bigint('credit', { mode: 'number' }).notNull().default(0),
    contractId: text('contract_id').references(() => contracts.id),
    jobId: text('job_id').references(() => deliveryJobs.id), // set for transport-fee journals
    memoKey: text('memo_key'),
    createdAt: createdAt(),
  },
  (t) => [index('ledger_journal_idx').on(t.journalId), index('ledger_account_idx').on(t.account)],
);

export const LOT_EVENT_TYPES = [
  'LOT_REGISTERED',
  'LOT_WITHDRAWN',
  'LOT_UPDATED',
  'LOT_SOLD',
  'LOT_EXPIRED',
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
  'TRANSPORT_SUGGESTED', // farmer asked for a driver — buyer approves (D-037)
  'TRANSPORT_REQUESTED',
  'DRIVER_ASSIGNED',
  'TRANSPORT_FUNDED',
  'IN_TRANSIT',
  'TRANSPORT_DELIVERED',
  'DRIVER_PAID',
  'TRANSPORT_CANCELLED',
  'VOICE_CALL',
  // Phase 3: delivery milestones, receipt, claims.
  'DRIVER_AT_PICKUP',
  'DRIVER_DEPARTED',
  'DRIVER_ARRIVED',
  'DELIVERED',
  'RECEIPT_CONFIRMED',
  'CLAIM_RAISED',
  'CLAIM_ANSWERED',
  'CLAIM_RESOLVED',
] as const;
export type LotEventType = (typeof LOT_EVENT_TYPES)[number];

export const lotEvents = f2m.table(
  'lot_events',
  {
    id: id(),
    lotId: text('lot_id')
      .notNull()
      .references(() => lots.id),
    seq: bigint('seq', { mode: 'number' }).notNull(), // per-lot monotonic — append-only, never updated or deleted
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
export const marketPrices = f2m.table(
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
    pricePerKg: bigint('price_per_kg', { mode: 'number' }).notNull(), // pesewas
    recordedAt: bigint('recorded_at', { mode: 'number' }).notNull(),
  },
  (t) => [uniqueIndex('market_prices_commodity_market_idx').on(t.commodityId, t.market)],
);

// ---- Logistics: the middle-mile bridge ----

/**
 * Every price the platform has ever seen, one row each (D-053). `market_prices`
 * keeps only the latest quote per market, so it cannot show a trend; this is
 * the history behind trends, the fair-price range and the alerts.
 *
 * `source` says how much to trust a row: 'deal' is money that changed hands,
 * 'market' is a survey or feed (WFP, FAO, a partner's file), 'ask' and 'offer'
 * are what people hoped for, 'reference' is seed placeholder data.
 */
export const PRICE_SOURCES = ['deal', 'market', 'ask', 'offer', 'request', 'reference'] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

export const priceObservations = f2m.table(
  'price_observations',
  {
    id: id(),
    commodityId: text('commodity_id')
      .notNull()
      .references(() => commodities.id),
    regionCode: text('region_code').references(() => regions.code),
    market: text('market'), // proper noun when the price is a market quote
    pricePerKg: bigint('price_per_kg', { mode: 'number' }).notNull(), // pesewas
    source: text('source', { enum: PRICE_SOURCES }).notNull(),
    /** Where a 'market' row came from: 'wfp', 'fpma', 'feed', 'manual'. */
    dataset: text('dataset'),
    /** The thing this price describes (a lot, an offer, a feed row) — lets a changed listing update its row, and an import run twice add nothing. */
    refId: text('ref_id'),
    observedAt: bigint('observed_at', { mode: 'number' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('price_obs_commodity_time_idx').on(t.commodityId, t.observedAt),
    uniqueIndex('price_obs_source_ref_idx').on(t.source, t.refId),
  ],
);

/**
 * What a buyer or farmer asked to be told (D-055). 'listing': tell me when
 * someone lists this crop at or under the price (per kg, pesewas). 'price_above'
 * / 'price_below': tell me when the market price crosses it.
 */
export const WATCH_KINDS = ['listing', 'price_above', 'price_below'] as const;
export type WatchKind = (typeof WATCH_KINDS)[number];

export const priceWatches = f2m.table(
  'price_watches',
  {
    id: id(),
    role: text('role', { enum: ['buyer', 'farmer'] }).notNull(),
    ownerId: text('owner_id').notNull(), // buyers.id or farmers.id, by role
    commodityId: text('commodity_id')
      .notNull()
      .references(() => commodities.id),
    regionCode: text('region_code').references(() => regions.code), // null = anywhere in Ghana
    kind: text('kind', { enum: WATCH_KINDS }).notNull(),
    thresholdPerKg: bigint('threshold_per_kg', { mode: 'number' }).notNull(), // pesewas
    lastNotifiedAt: bigint('last_notified_at', { mode: 'number' }),
    createdAt: createdAt(),
  },
  (t) => [index('price_watches_owner_idx').on(t.role, t.ownerId), index('price_watches_commodity_idx').on(t.commodityId)],
);

/**
 * Every alert we sent, so the same news never reaches the same person twice
 * and nobody is texted more than a few times a day (D-055).
 */
export const alertLog = f2m.table(
  'alert_log',
  {
    id: id(),
    kind: text('kind').notNull(), // 'lot_match', 'request_nearby', 'price_move', 'watch_price', 'watch_listing'
    recipient: text('recipient').notNull(), // 'buyer:<id>' or 'farmer:<id>'
    subject: text('subject').notNull(), // the lot, request or crop-and-week it was about
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('alert_log_once_idx').on(t.kind, t.recipient, t.subject),
    index('alert_log_recipient_idx').on(t.recipient, t.createdAt),
  ],
);

export const vehicleClasses = f2m.table('vehicle_classes', {
  code: text('code').primaryKey(), // tricycle | van | light_truck
  nameKey: text('name_key').notNull(),
  capacityKg: doublePrecision('capacity_kg').notNull(),
  baseFee: bigint('base_fee', { mode: 'number' }).notNull(), // pesewas
  perKmRate: bigint('per_km_rate', { mode: 'number' }).notNull(), // pesewas per km
  sortOrder: bigint('sort_order', { mode: 'number' }).notNull().default(100),
});

export const drivers = f2m.table(
  'drivers',
  {
    id: id(),
    phone: text('phone').notNull(), // E.164 — the USSD identity, same as farmers
    name: text('name').notNull(),
    regionCode: text('region_code')
      .notNull()
      .references(() => regions.code),
    gpsLat: doublePrecision('gps_lat'), // home base; region centroid fallback
    gpsLng: doublePrecision('gps_lng'),
    momoMsisdn: text('momo_msisdn').notNull(),
    locale: text('locale').notNull().default('en'),
    vehicleClassCode: text('vehicle_class_code')
      .notNull()
      .references(() => vehicleClasses.code),
    pinHash: text('pin_hash'), // 4-digit PIN set at USSD registration; web-registered drivers have none (D-047)
    active: boolean('active').notNull().default(true), // the ONLINE/OFFLINE availability toggle
    routeRegions: text('route_regions').notNull().default('[]'), // JSON region codes served; empty = anywhere
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('drivers_phone_idx').on(t.phone)],
);

export const DELIVERY_JOB_STATES = [
  'REQUESTED',
  'NO_DRIVER',
  'ASSIGNED',
  'FUNDING_FAILED',
  'FUNDS_HELD',
  'PICKED_UP',
  'ARRIVED', // the driver is at the destination (Phase 3) — the buyer confirms receipt next
  'DELIVERED',
  'PAID',
  'CANCELLED',
  'CANCELLED_REFUNDED',
] as const;
export type DeliveryJobState = (typeof DELIVERY_JOB_STATES)[number];

export const deliveryJobs = f2m.table(
  'delivery_jobs',
  {
    id: id(),
    jobCode: text('job_code').notNull(), // human short code read over USSD, e.g. DLV-7Q2K
    contractId: text('contract_id')
      .notNull()
      .references(() => contracts.id),
    lotId: text('lot_id')
      .notNull()
      .references(() => lots.id),
    buyerId: text('buyer_id') // the requester and payer
      .notNull()
      .references(() => buyers.id),
    farmerId: text('farmer_id')
      .notNull()
      .references(() => farmers.id),
    driverId: text('driver_id').references(() => drivers.id),
    vehicleClassCode: text('vehicle_class_code')
      .notNull()
      .references(() => vehicleClasses.code),
    distanceKm: doublePrecision('distance_km').notNull(), // frozen at request time
    quoteAmount: bigint('quote_amount', { mode: 'number' }).notNull(), // pesewas, frozen = base + perKm × km
    pickupLat: doublePrecision('pickup_lat').notNull(),
    pickupLng: doublePrecision('pickup_lng').notNull(),
    dropoffLat: doublePrecision('dropoff_lat').notNull(),
    dropoffLng: doublePrecision('dropoff_lng').notNull(),
    state: text('state', { enum: DELIVERY_JOB_STATES }).notNull().default('REQUESTED'),
    fundingAttempts: bigint('funding_attempts', { mode: 'number' }).notNull().default(0),
    assignedAt: bigint('assigned_at', { mode: 'number' }),
    fundedAt: bigint('funded_at', { mode: 'number' }),
    pickedUpAt: bigint('picked_up_at', { mode: 'number' }),
    deliveredAt: bigint('delivered_at', { mode: 'number' }),
    paidAt: bigint('paid_at', { mode: 'number' }),
    closedAt: bigint('closed_at', { mode: 'number' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('delivery_jobs_code_idx').on(t.jobCode),
    index('delivery_jobs_contract_idx').on(t.contractId),
    index('delivery_jobs_driver_idx').on(t.driverId),
    index('delivery_jobs_state_idx').on(t.state),
  ],
);

// One shot per (job, driver) — mirrors the matches rule (D-016).
export const deliveryJobOffers = f2m.table(
  'delivery_job_offers',
  {
    id: id(),
    jobId: text('job_id')
      .notNull()
      .references(() => deliveryJobs.id),
    driverId: text('driver_id')
      .notNull()
      .references(() => drivers.id),
    offeredAt: bigint('offered_at', { mode: 'number' }).notNull(),
    expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
    status: text('status', { enum: ['offered', 'accepted', 'declined', 'expired'] }).notNull().default('offered'),
  },
  (t) => [uniqueIndex('delivery_job_offers_job_driver_idx').on(t.jobId, t.driverId)],
);

// SMS outbox — "we will text you" made true. Messages are resolved into the
// recipient's locale at queue time; the sweep delivers via the configured
// provider (mock offline, Africa's Talking when the key lands).
export const notifications = f2m.table(
  'notifications',
  {
    id: id(),
    phone: text('phone').notNull(), // E.164
    templateKey: text('template_key').notNull(),
    message: text('message').notNull(),
    contractId: text('contract_id').references(() => contracts.id),
    lotId: text('lot_id').references(() => lots.id),
    status: text('status', { enum: ['pending', 'sent', 'failed'] }).notNull().default('pending'),
    provider: text('provider'),
    error: text('error'),
    createdAt: createdAt(),
    sentAt: bigint('sent_at', { mode: 'number' }),
  },
  (t) => [index('notifications_phone_idx').on(t.phone), index('notifications_status_idx').on(t.status)],
);

// Outbound IVR calls — the deep-accessibility layer. One call = one flow bound
// to one contract; per-call node cursor, no session table needed (D-027).
export const VOICE_CALL_STATUSES = ['pending', 'placing', 'in_progress', 'completed', 'failed', 'no_answer'] as const;
export type VoiceCallStatus = (typeof VOICE_CALL_STATUSES)[number];

export const voiceCalls = f2m.table(
  'voice_calls',
  {
    id: id(),
    phone: text('phone').notNull(),
    locale: text('locale').notNull().default('en'),
    // 'listing' = a guided voice listing (Phase 2), 'line' = a farmer calling
    // the listing line: sell, hear and change listings, answer offers.
    flow: text('flow', { enum: ['offer', 'grade', 'bridge', 'bid', 'listing', 'line', 'claim'] }).notNull(), // 'claim' = a buyer's claim read to the farmer (Phase 3)
    direction: text('direction', { enum: ['outbound', 'inbound'] }).notNull().default('outbound'),
    /** The call's memory between answers (Phase 2): a listing draft, the offer being heard, retries. JSON. */
    state: text('state'),
    contractId: text('contract_id').references(() => contracts.id),
    offerId: text('offer_id').references(() => offers.id), // the 'bid' flow: hear an offer thread's proposal (Phase 1)
    currentNode: text('current_node'),
    status: text('status', { enum: VOICE_CALL_STATUSES }).notNull().default('pending'),
    attempts: bigint('attempts', { mode: 'number' }).notNull().default(0),
    providerRef: text('provider_ref'),
    sessionRef: text('session_ref'), // the gateway's call session id
    outcome: text('outcome'), // JSON: { digits?, result? }
    lastAttemptAt: bigint('last_attempt_at', { mode: 'number' }),
    createdAt: createdAt(),
    updatedAt: bigint('updated_at', { mode: 'number' })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (t) => [index('voice_calls_status_idx').on(t.status), index('voice_calls_phone_idx').on(t.phone)],
);

// Buyer in-app notification center — read/unread semantics, distinct from the
// SMS delivery outbox (D-026). Message resolved at queue time, same archival
// principle as SMS.
export const buyerNotifications = f2m.table(
  'buyer_notifications',
  {
    id: id(),
    buyerId: text('buyer_id')
      .notNull()
      .references(() => buyers.id),
    templateKey: text('template_key').notNull(),
    message: text('message').notNull(),
    contractId: text('contract_id').references(() => contracts.id),
    lotId: text('lot_id').references(() => lots.id),
    demandId: text('demand_id').references(() => demands.id),
    jobId: text('job_id').references(() => deliveryJobs.id),
    readAt: bigint('read_at', { mode: 'number' }),
    createdAt: createdAt(),
  },
  (t) => [index('buyer_notifications_buyer_idx').on(t.buyerId, t.readAt)],
);

// Voice listings (D-038): one open-ended call = one row — the audio ref, what
// ASR heard, what MT made of it, what the parser extracted, and the lot it
// became. The audit trail for "the AI listed this for me".
export const voiceListings = f2m.table(
  'voice_listings',
  {
    id: id(),
    phone: text('phone').notNull(),
    farmerId: text('farmer_id').references(() => farmers.id),
    audioRef: text('audio_ref'), // recording URL from the gateway; null in mock
    transcript: text('transcript'),
    translatedText: text('translated_text'),
    locale: text('locale').notNull().default('en'),
    parsed: text('parsed'), // JSON ParsedListing
    lotId: text('lot_id').references(() => lots.id),
    status: text('status', { enum: ['recorded', 'listed', 'failed'] })
      .notNull()
      .default('recorded'),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [index('voice_listings_phone_idx').on(t.phone)],
);

/**
 * Offer threads (Phase 1): one negotiation between one buyer and one farmer
 * about one listing, whoever started it — a buyer bid, a farmer answering a
 * buyer request, or the matching engine. The current proposal lives on the
 * row; every move is an offer_events row.
 */
export const OFFER_STATUSES = ['open', 'accepted', 'rejected', 'withdrawn', 'expired'] as const;
export const offers = f2m.table(
  'offers',
  {
    id: id(),
    lotId: text('lot_id')
      .notNull()
      .references(() => lots.id),
    buyerId: text('buyer_id')
      .notNull()
      .references(() => buyers.id),
    farmerId: text('farmer_id')
      .notNull()
      .references(() => farmers.id),
    demandId: text('demand_id').references(() => demands.id), // set when it started from a buyer request
    status: text('status', { enum: OFFER_STATUSES }).notNull().default('open'),
    turn: text('turn', { enum: ['buyer', 'farmer'] }), // who must act; null once closed
    units: doublePrecision('units').notNull(), // in the listing's unit
    pricePerUnit: bigint('price_per_unit', { mode: 'number' }).notNull(), // pesewas
    proposedBy: text('proposed_by', { enum: ['buyer', 'farmer'] }).notNull(),
    proposedAt: bigint('proposed_at', { mode: 'number' }).notNull(),
    expiresAt: bigint('expires_at', { mode: 'number' }), // the current proposal lapses then
    // Request-started threads hold this many kg of the request so the engine never over-buys.
    heldDemandKg: doublePrecision('held_demand_kg').notNull().default(0),
    contractId: text('contract_id').references(() => contracts.id),
    reminderSentAt: bigint('reminder_sent_at', { mode: 'number' }), // the "someone is waiting for your answer" SMS for this proposal
    createdAt: createdAt(),
    updatedAt: bigint('updated_at', { mode: 'number' })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (t) => [
    index('offers_lot_idx').on(t.lotId),
    index('offers_buyer_idx').on(t.buyerId),
    index('offers_farmer_idx').on(t.farmerId),
    index('offers_status_idx').on(t.status),
  ],
);

export const offerEvents = f2m.table(
  'offer_events',
  {
    id: id(),
    offerId: text('offer_id')
      .notNull()
      .references(() => offers.id),
    by: text('by', { enum: ['buyer', 'farmer', 'system'] }).notNull(),
    action: text('action', { enum: ['bid', 'counter', 'accept', 'reject', 'withdraw', 'expire'] }).notNull(),
    units: doublePrecision('units'),
    pricePerUnit: bigint('price_per_unit', { mode: 'number' }),
    channel: text('channel', { enum: ['web', 'ussd', 'ivr', 'system'] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('offer_events_offer_idx').on(t.offerId)],
);

export const ussdSessions = f2m.table('ussd_sessions', {
  sessionId: text('session_id').primaryKey(), // the gateway's sessionId
  phone: text('phone').notNull(),
  screen: text('screen').notNull(),
  ctx: text('ctx').notNull().default('{}'), // JSON — partial form data, pagination cursors, selected ids
  updatedAt: bigint('updated_at', { mode: 'number' })
    .notNull()
    .$defaultFn(() => Date.now()),
});

export type Farmer = typeof farmers.$inferSelect;
export type Buyer = typeof buyers.$inferSelect;
export type Account = typeof accounts.$inferSelect;
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
export type PriceObservation = typeof priceObservations.$inferSelect;
export type PriceWatch = typeof priceWatches.$inferSelect;
export type AlertLogRow = typeof alertLog.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type VehicleClass = typeof vehicleClasses.$inferSelect;
export type BuyerNotification = typeof buyerNotifications.$inferSelect;
export type VoiceCall = typeof voiceCalls.$inferSelect;
export type VoiceListing = typeof voiceListings.$inferSelect;
export type Driver = typeof drivers.$inferSelect;
export type DeliveryJob = typeof deliveryJobs.$inferSelect;
export type DeliveryJobOffer = typeof deliveryJobOffers.$inferSelect;
export type Offer = typeof offers.$inferSelect;
export type OfferEvent = typeof offerEvents.$inferSelect;

/**
 * A buyer's claim on a delivered order (Phase 3, vision §20): what is wrong,
 * the deduction the buyer proposes, the farmer's answer, and F2M's review.
 * Every claim is reviewed — an accepted one as an audit, a refused one for a
 * decision on the disputed amount.
 */
export const CLAIM_REASONS = ['short_weight', 'quality', 'damaged', 'late', 'not_delivered', 'other'] as const;
export const CLAIM_STATUSES = ['awaiting_farmer', 'accepted', 'awaiting_review', 'resolved'] as const;
export const orderClaims = f2m.table(
  'order_claims',
  {
    id: id(),
    contractId: text('contract_id')
      .notNull()
      .references(() => contracts.id),
    buyerId: text('buyer_id')
      .notNull()
      .references(() => buyers.id),
    reason: text('reason', { enum: CLAIM_REASONS }).notNull(),
    note: text('note'),
    proposedDeduction: bigint('proposed_deduction', { mode: 'number' }).notNull(), // pesewas, ≤ what was still held
    status: text('status', { enum: CLAIM_STATUSES }).notNull().default('awaiting_farmer'),
    farmerAnswer: text('farmer_answer', { enum: ['accepted', 'refused', 'no_answer'] }),
    answerDueAt: bigint('answer_due_at', { mode: 'number' }).notNull(),
    answeredAt: bigint('answered_at', { mode: 'number' }),
    /** F2M's decision (Phase 4 admin; the simulator route until then). */
    finalDeduction: bigint('final_deduction', { mode: 'number' }),
    reviewStatus: text('review_status', { enum: ['pending', 'reviewed'] }).notNull().default('pending'),
    reviewNote: text('review_note'),
    reviewedBy: text('reviewed_by'),
    reviewedAt: bigint('reviewed_at', { mode: 'number' }),
    createdAt: createdAt(),
  },
  (t) => [index('order_claims_contract_idx').on(t.contractId), index('order_claims_status_idx').on(t.status)],
);
export type OrderClaim = typeof orderClaims.$inferSelect;

/**
 * Small facts the server must remember between requests (docs/HOSTING.md):
 * on serverless no module variable survives from one call to the next, so
 * "when did we last pull the price feed" lives here.
 */
export const settings = f2m.table('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});
