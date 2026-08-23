export { config, REPO_ROOT, type Config } from './config';
export { db, sqlite, type Db } from './db/client';
export { runMigrations } from './db/migrate';
export * as schema from './db/schema';
export {
  CONTRACT_STATES,
  LOT_EVENT_TYPES,
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
export { t, resolveText, hasKey, type I18nText } from './i18n';
export { seed, DEMO_BUYER } from './db/seed';
