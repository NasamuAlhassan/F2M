import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { ledgerEntries, type LedgerEntry } from '../db/schema';
import { DomainError } from './errors';
import type { DbLike } from './trace';

export interface JournalLine {
  account: string;
  debit?: number; // pesewas — exactly one of debit/credit per line
  credit?: number;
  memoKey?: string;
}

export const ACCOUNTS = {
  external: 'external:momo',
  escrow: (contractId: string) => `escrow:contract:${contractId}`,
  farmerPayable: (farmerId: string) => `farmer:${farmerId}:payable`,
  buyerRefunds: (buyerId: string) => `buyer:${buyerId}:refunds`,
};

/** Post a balanced journal. Every journal MUST sum to zero (D-010). */
export function postJournal(tx: DbLike, contractId: string, lines: JournalLine[]): string {
  const journalId = crypto.randomUUID();
  let debits = 0;
  let credits = 0;
  for (const line of lines) {
    const debit = line.debit ?? 0;
    const credit = line.credit ?? 0;
    if ((debit === 0) === (credit === 0)) {
      throw new DomainError('Each journal line needs exactly one of debit/credit', 'UNBALANCED_JOURNAL', 500);
    }
    debits += debit;
    credits += credit;
  }
  if (debits !== credits || debits === 0) {
    throw new DomainError(`Journal does not balance: ${debits} != ${credits}`, 'UNBALANCED_JOURNAL', 500);
  }
  for (const line of lines) {
    tx.insert(ledgerEntries)
      .values({
        journalId,
        account: line.account,
        debit: line.debit ?? 0,
        credit: line.credit ?? 0,
        contractId,
        memoKey: line.memoKey ?? null,
      })
      .run();
  }
  return journalId;
}

/** Credit-minus-debit balance (escrow and payable accounts are liabilities). */
export function accountBalance(account: string): number {
  return db
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.account, account))
    .all()
    .reduce((sum, e) => sum + e.credit - e.debit, 0);
}

export function contractLedger(contractId: string): LedgerEntry[] {
  return db.select().from(ledgerEntries).where(eq(ledgerEntries.contractId, contractId)).all();
}

export function contractEscrowBalance(contractId: string): number {
  return accountBalance(ACCOUNTS.escrow(contractId));
}

/** Test invariant helper: every journal in the book sums to zero. */
export function allJournalsBalanced(): boolean {
  const byJournal = new Map<string, number>();
  for (const e of db.select().from(ledgerEntries).all()) {
    byJournal.set(e.journalId, (byJournal.get(e.journalId) ?? 0) + e.debit - e.credit);
  }
  return [...byJournal.values()].every((v) => v === 0);
}
