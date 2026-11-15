import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { contracts, type Contract, type ContractState } from '../db/schema';
import { notFound } from './errors';
import { priceTermsSchema, type PriceTerms } from './types';

// The full contract state machine arrives in M3; these queries serve every surface.

export async function getContract(id: string): Promise<Contract> {
  const contract = (await db.select().from(contracts).where(eq(contracts.id, id)))[0];
  if (!contract) throw notFound('contract');
  return contract;
}

export async function getContractByMatchId(matchId: string): Promise<Contract | undefined> {
  return (await db.select().from(contracts).where(eq(contracts.matchId, matchId)))[0];
}

export async function listContractsForFarmer(farmerId: string, states?: ContractState[]): Promise<Contract[]> {
  const where = states
    ? and(eq(contracts.farmerId, farmerId), inArray(contracts.state, states))
    : eq(contracts.farmerId, farmerId);
  return (await db.select().from(contracts).where(where).orderBy(desc(contracts.createdAt)));
}

export async function listContractsForBuyer(buyerId: string): Promise<Contract[]> {
  return (await db.select().from(contracts).where(eq(contracts.buyerId, buyerId)).orderBy(desc(contracts.createdAt)));
}

export async function listContractsForLot(lotId: string): Promise<Contract[]> {
  return (await db.select().from(contracts).where(eq(contracts.lotId, lotId)).orderBy(desc(contracts.createdAt)));
}

export function contractPriceTerms(contract: Contract): PriceTerms {
  return priceTermsSchema.parse(JSON.parse(contract.priceTerms));
}
