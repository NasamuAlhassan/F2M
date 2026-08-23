import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { contracts, type Contract, type ContractState } from '../db/schema';
import { notFound } from './errors';
import { priceTermsSchema, type PriceTerms } from './types';

// The full contract state machine arrives in M3; these queries serve every surface.

export function getContract(id: string): Contract {
  const contract = db.select().from(contracts).where(eq(contracts.id, id)).get();
  if (!contract) throw notFound('contract');
  return contract;
}

export function getContractByMatchId(matchId: string): Contract | undefined {
  return db.select().from(contracts).where(eq(contracts.matchId, matchId)).get();
}

export function listContractsForFarmer(farmerId: string, states?: ContractState[]): Contract[] {
  const where = states
    ? and(eq(contracts.farmerId, farmerId), inArray(contracts.state, states))
    : eq(contracts.farmerId, farmerId);
  return db.select().from(contracts).where(where).orderBy(desc(contracts.createdAt)).all();
}

export function listContractsForBuyer(buyerId: string): Contract[] {
  return db.select().from(contracts).where(eq(contracts.buyerId, buyerId)).orderBy(desc(contracts.createdAt)).all();
}

export function listContractsForLot(lotId: string): Contract[] {
  return db.select().from(contracts).where(eq(contracts.lotId, lotId)).orderBy(desc(contracts.createdAt)).all();
}

export function contractPriceTerms(contract: Contract): PriceTerms {
  return priceTermsSchema.parse(JSON.parse(contract.priceTerms));
}
