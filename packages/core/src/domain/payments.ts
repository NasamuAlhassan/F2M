import { desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { contracts, payments, type Payment } from '../db/schema';

// Payment orchestration (hold/release + ledger) arrives in M4; these queries serve every surface.

export function listPaymentsForFarmer(farmerId: string, limit = 3): Payment[] {
  const farmerContracts = db
    .select({ id: contracts.id })
    .from(contracts)
    .where(eq(contracts.farmerId, farmerId))
    .all();
  if (farmerContracts.length === 0) return [];
  return db
    .select()
    .from(payments)
    .where(
      inArray(
        payments.contractId,
        farmerContracts.map((c) => c.id),
      ),
    )
    .orderBy(desc(payments.createdAt))
    .all()
    .filter((p) => p.direction === 'disbursement')
    .slice(0, limit);
}

export function listPaymentsForContract(contractId: string): Payment[] {
  return db.select().from(payments).where(eq(payments.contractId, contractId)).orderBy(desc(payments.createdAt)).all();
}
