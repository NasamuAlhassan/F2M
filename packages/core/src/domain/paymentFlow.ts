import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { buyers, contracts, farmers, payments, type Contract, type Payment } from '../db/schema';
import { getPaymentProvider } from '../providers/payment/index';
import { transitionContract } from '../state/contractMachine';
import { DomainError, notFound } from './errors';
import { ACCOUNTS, postJournal } from './ledger';
import { acceptOffer } from './matching';
import { config } from '../config';

const MAX_FUNDING_ATTEMPTS = 2;

function getContractRow(contractId: string): Contract {
  const contract = db.select().from(contracts).where(eq(contracts.id, contractId)).get();
  if (!contract) throw notFound('contract');
  return contract;
}

/**
 * Start the buyer-side hold (Collections requesttopay) for an ACCEPTED
 * contract. Status lands via pollPaymentsOnce, never via the initiate call.
 */
export async function initiateHold(contractId: string): Promise<Payment> {
  const contract = getContractRow(contractId);
  if (contract.state !== 'ACCEPTED') {
    throw new DomainError(`Cannot fund a contract in ${contract.state}`, 'INVALID_STATE', 409);
  }
  const buyer = db.select().from(buyers).where(eq(buyers.id, contract.buyerId)).get();
  if (!buyer) throw notFound('buyer');

  const provider = getPaymentProvider();
  const referenceId = crypto.randomUUID();
  const payment = db
    .insert(payments)
    .values({
      contractId: contract.id,
      direction: 'collection',
      provider: provider.name,
      providerRef: referenceId,
      amount: contract.holdAmount,
      currency: provider.settlementCurrency,
      counterpartyMsisdn: buyer.momoMsisdn,
      status: 'pending',
    })
    .returning()
    .get();
  db.update(contracts).set({ settlementCurrency: provider.settlementCurrency }).where(eq(contracts.id, contract.id)).run();

  try {
    const result = await provider.requestHold({
      referenceId,
      msisdn: buyer.momoMsisdn,
      amount: contract.holdAmount,
      currency: provider.settlementCurrency,
      externalId: contract.id,
      note: `FTM hold ${contract.id.slice(0, 8)}`,
    });
    if (result.status === 'failed') {
      db.update(payments)
        .set({ status: 'failed', raw: JSON.stringify(result.raw ?? null), updatedAt: Date.now() })
        .where(eq(payments.id, payment.id))
        .run();
      handleCollectionFailure(contract.id);
    }
  } catch (err) {
    // Network error at initiation: leave pending — the poll timeout will resolve it.
    db.update(payments)
      .set({ raw: JSON.stringify({ initiateError: String(err) }), updatedAt: Date.now() })
      .where(eq(payments.id, payment.id))
      .run();
  }
  return payment;
}

/** Disburse the graded final amount to the farmer (Disbursements transfer). */
export async function initiateRelease(contractId: string): Promise<Payment> {
  const contract = getContractRow(contractId);
  if (contract.state !== 'GRADED') {
    throw new DomainError(`Cannot release payment for a contract in ${contract.state}`, 'INVALID_STATE', 409);
  }
  if (!contract.finalAmount || contract.finalAmount <= 0) {
    throw new DomainError('Contract has no positive final amount', 'INVALID_STATE', 409);
  }
  const existing = db
    .select()
    .from(payments)
    .where(and(eq(payments.contractId, contractId), eq(payments.direction, 'disbursement')))
    .all()
    .find((p) => p.status !== 'failed');
  if (existing) return existing; // idempotent — a pending/successful release already exists

  const farmer = db.select().from(farmers).where(eq(farmers.id, contract.farmerId)).get();
  if (!farmer) throw notFound('farmer');

  const provider = getPaymentProvider();
  const referenceId = crypto.randomUUID();
  const payment = db
    .insert(payments)
    .values({
      contractId: contract.id,
      direction: 'disbursement',
      provider: provider.name,
      providerRef: referenceId,
      amount: contract.finalAmount,
      currency: provider.settlementCurrency,
      counterpartyMsisdn: farmer.momoMsisdn,
      status: 'pending',
    })
    .returning()
    .get();

  try {
    const result = await provider.disburse({
      referenceId,
      msisdn: farmer.momoMsisdn,
      amount: contract.finalAmount,
      currency: provider.settlementCurrency,
      externalId: contract.id,
      note: `FTM payout ${contract.id.slice(0, 8)}`,
    });
    if (result.status === 'failed') {
      db.update(payments)
        .set({ status: 'failed', raw: JSON.stringify(result.raw ?? null), updatedAt: Date.now() })
        .where(eq(payments.id, payment.id))
        .run();
    }
  } catch (err) {
    db.update(payments)
      .set({ raw: JSON.stringify({ initiateError: String(err) }), updatedAt: Date.now() })
      .where(eq(payments.id, payment.id))
      .run();
  }
  return payment;
}

/** Full refund of the hold with a balanced journal; ends CANCELLED_REFUNDED. */
export function refundHold(contractId: string, payload?: Record<string, unknown>): Contract {
  const contract = getContractRow(contractId);
  return transitionContract(contractId, 'CANCELLED_REFUNDED', { type: 'system' }, {
    payload,
    also: (tx) => {
      postJournal(tx, contractId, [
        { account: ACCOUNTS.escrow(contractId), debit: contract.holdAmount, memoKey: 'ledger.refund' },
        { account: ACCOUNTS.buyerRefunds(contract.buyerId), credit: contract.holdAmount, memoKey: 'ledger.refund' },
      ]);
    },
  });
}

function handleCollectionFailure(contractId: string): void {
  const contract = getContractRow(contractId);
  if (contract.state !== 'ACCEPTED' && contract.state !== 'FUNDING_FAILED') return;

  if (contract.state === 'ACCEPTED') {
    transitionContract(contractId, 'FUNDING_FAILED', { type: 'system' });
  }
  const attempts = contract.fundingAttempts + 1;
  db.update(contracts).set({ fundingAttempts: attempts }).where(eq(contracts.id, contractId)).run();

  if (attempts < MAX_FUNDING_ATTEMPTS) {
    // One retry with a fresh reference UUID.
    transitionContract(contractId, 'ACCEPTED', { type: 'system' });
    void initiateHold(contractId).catch(() => {});
  } else {
    transitionContract(contractId, 'CANCELLED', { type: 'system' });
  }
}

/**
 * The poll loop — the single place payment statuses change contract state.
 * MoMo callbacks only trigger an immediate call of this for one reference.
 */
export async function pollPaymentsOnce(now = Date.now()): Promise<{ resolved: number }> {
  const provider = getPaymentProvider();
  const pending = db.select().from(payments).where(eq(payments.status, 'pending')).all();
  let resolved = 0;

  for (const payment of pending) {
    let status: 'pending' | 'successful' | 'failed';
    let raw: unknown = null;
    try {
      const result =
        payment.direction === 'collection'
          ? await provider.getHoldStatus(payment.providerRef)
          : await provider.getDisburseStatus(payment.providerRef);
      status = result.status;
      raw = result.raw ?? null;
    } catch (err) {
      status = 'pending';
      raw = { pollError: String(err) };
    }

    // A hold stuck pending past the timeout counts as failed — the farmer
    // cannot wait forever on a buyer who never approves the charge.
    if (status === 'pending' && now - payment.createdAt > config.PAYMENT_TIMEOUT_MS) {
      status = 'failed';
      raw = { timeout: true };
    }
    if (status === 'pending') continue;

    db.update(payments)
      .set({ status, raw: JSON.stringify(raw), updatedAt: now })
      .where(eq(payments.id, payment.id))
      .run();
    resolved += 1;

    const contract = getContractRow(payment.contractId);
    if (payment.direction === 'collection') {
      if (status === 'successful' && contract.state === 'ACCEPTED') {
        transitionContract(contract.id, 'FUNDS_HELD', { type: 'system' }, {
          payload: { paymentId: payment.id, amount: payment.amount },
          also: (tx) => {
            postJournal(tx, contract.id, [
              { account: ACCOUNTS.external, debit: contract.holdAmount, memoKey: 'ledger.hold' },
              { account: ACCOUNTS.escrow(contract.id), credit: contract.holdAmount, memoKey: 'ledger.hold' },
            ]);
          },
        });
      } else if (status === 'failed') {
        handleCollectionFailure(contract.id);
      }
    } else {
      if (status === 'successful' && contract.state === 'GRADED') {
        const finalAmount = contract.finalAmount ?? 0;
        const remainder = contract.holdAmount - finalAmount;
        transitionContract(contract.id, 'SETTLED', { type: 'system' }, {
          payload: { paymentId: payment.id, finalAmount, refunded: remainder },
          also: (tx) => {
            postJournal(tx, contract.id, [
              { account: ACCOUNTS.escrow(contract.id), debit: finalAmount, memoKey: 'ledger.payout' },
              { account: ACCOUNTS.farmerPayable(contract.farmerId), credit: finalAmount, memoKey: 'ledger.payout' },
              ...(remainder > 0
                ? [
                    { account: ACCOUNTS.escrow(contract.id), debit: remainder, memoKey: 'ledger.refundRemainder' },
                    { account: ACCOUNTS.buyerRefunds(contract.buyerId), credit: remainder, memoKey: 'ledger.refundRemainder' },
                  ]
                : []),
            ]);
          },
        });
        // The farmer sees PAYMENT_RELEASED in the trace, distinct from SETTLED.
      }
      // A failed disbursement stays GRADED; the sweep retries via releaseDuePayments.
    }
  }
  return { resolved };
}

/** Poll one reference immediately — what a MoMo callback triggers (D-009). */
export async function pollPaymentByReference(referenceId: string): Promise<void> {
  const payment = db.select().from(payments).where(eq(payments.providerRef, referenceId)).get();
  if (!payment || payment.status !== 'pending') return;
  await pollPaymentsOnce();
}

/** Farmer accepts on USSD → the state transition and the funding hold, together. */
export async function acceptOfferAndHold(contractId: string, farmerId: string): Promise<Contract> {
  const contract = acceptOffer(contractId, farmerId);
  await initiateHold(contractId);
  return contract;
}

/**
 * Release payouts whose dispute window has lapsed (the farmer's USSD "Agree"
 * calls initiateRelease directly instead of waiting). Sweep-driven.
 */
export async function releaseDuePayments(now = Date.now()): Promise<number> {
  const windowMs = config.DISPUTE_WINDOW_MINUTES * 60 * 1000;
  const due = db
    .select()
    .from(contracts)
    .where(eq(contracts.state, 'GRADED'))
    .all()
    .filter(
      (c) =>
        c.finalGrade &&
        c.finalGrade !== 'REJECT' &&
        (c.finalAmount ?? 0) > 0 &&
        c.gradedAt !== null &&
        now - c.gradedAt >= windowMs,
    );
  for (const c of due) await initiateRelease(c.id);
  return due.length;
}
