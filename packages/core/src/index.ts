export { config, REPO_ROOT, type Config } from './config';
export { db, sqlite, type Db } from './db/client';
export { runMigrations } from './db/migrate';
export * as schema from './db/schema';
export {
  CONTRACT_STATES,
  DELIVERY_JOB_STATES,
  LOT_EVENT_TYPES,
  type DeliveryJob,
  type DeliveryJobOffer,
  type DeliveryJobState,
  type Driver,
  type VehicleClass,
  type VoiceCall,
  type Buyer,
  type Commodity,
  type Contract,
  type ContractState,
  type Demand,
  type Farmer,
  type Grading,
  type LedgerEntry,
  type Lot,
  type LotEvent,
  type LotEventType,
  type MarketPrice,
  type Match,
  type Payment,
  type Photo,
  type Region,
  type Rubric,
  type Unit,
  type UssdSession,
} from './db/schema';
export * from './domain/types';
export { generateLotCode } from './domain/ids';
export { DomainError, notFound } from './domain/errors';
export { appendLotEvent, getTrace, type DbLike, type LotEventInput, type TraceEvent } from './domain/trace';
export * from './domain/registries';
export * from './domain/farmers';
export * from './domain/lots';
export * from './domain/demands';
export * from './domain/buyers';
export * from './domain/contracts';
export * from './domain/payments';
export * from './domain/matching';
export * from './domain/geo';
export * from './domain/ledger';
export * from './domain/paymentFlow';
export * from './domain/photos';
export * from './domain/gradingFlow';
export * from './domain/marketPrices';
export * from './domain/notifications';
export * from './domain/buyerNotifications';
export * from './domain/voiceCalls';
export * from './providers/voice/index';
export * from './domain/drivers';
export * from './domain/logistics';
export { transitionJob, type JobActor, type JobTransitionExtra } from './state/deliveryJobMachine';
export * from './providers/notify/index';
export * from './providers/payment/index';
export * from './providers/grading/index';
export { transitionContract, type Actor, type TransitionExtra } from './state/contractMachine';
export { t, resolveText, hasKey, AVAILABLE_LOCALES, type I18nText } from './i18n';
export { seed, DEMO_BUYER } from './db/seed';
