import { desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { contracts, payments, type Payment } from '../db/schema';

// Payment orchestration (hold/release + ledger) arrives in M4; these queries serve every surface.

export async function listPaymentsForFarmer(farmerId: string, limit = 3): Promise<Payment[]> {
  const farmerContracts = (await db
      .select({ id: contracts.id })
      .from(contracts)
      .where(eq(contracts.farmerId, farmerId)));
  if (farmerContracts.length === 0) return [];
  return (await db
      .select()
      .from(payments)
      .where(
        inArray(
          payments.contractId,
          farmerContracts.map((c) => c.id),
        ),
      )
      .orderBy(desc(payments.createdAt)))
    // Exclude jobId payments — driver payouts share the contractId but are not the farmer's money.
    .filter((p) => p.direction === 'disbursement' && p.jobId === null)
    .slice(0, limit);
}

export async function listPaymentsForContract(contractId: string): Promise<Payment[]> {
  return (await db.select().from(payments).where(eq(payments.contractId, contractId)).orderBy(desc(payments.createdAt)));
}
