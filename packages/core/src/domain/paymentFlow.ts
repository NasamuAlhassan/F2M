import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { buyers, contracts, demands, farmers, payments, type Contract, type Offer, type Payment } from '../db/schema';
import { getPaymentProvider } from '../providers/payment/index';
import { transitionContract } from '../state/contractMachine';
import { DomainError, notFound } from './errors';
import { ACCOUNTS, postJournal } from './ledger';
import { acceptOffer } from './matching';
import { acceptProposal, type Channel, type Party } from './offers';
import { queueBuyerNotification } from './buyerNotifications';
import { contractsWithGoodsInTransit, resolveJobPayment } from './logistics';
import { farmerPaid, onFarmerPayout, retryFarmerPayouts } from './settlement';
import { queueSms } from './notifications';
import { getCommodityById } from './registries';
import { appendLotEvent } from './trace';
import { formatGhs } from './types';
import { t } from '../i18n';
import { config } from '../config';

function smsDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

const MAX_FUNDING_ATTEMPTS = 2;

async function getContractRow(contractId: string): Promise<Contract> {
  const contract = (await db.select().from(contracts).where(eq(contracts.id, contractId)))[0];
  if (!contract) throw notFound('contract');
  return contract;
}

/**
 * Start the buyer-side hold (Collections requesttopay) for an ACCEPTED
 * contract. Status lands via pollPaymentsOnce, never via the initiate call.
 */
export async function initiateHold(contractId: string): Promise<Payment> {
  const contract = await getContractRow(contractId);
  if (contract.state !== 'ACCEPTED') {
    throw new DomainError(`Cannot fund a contract in ${contract.state}`, 'INVALID_STATE', 409);
  }
  const buyer = (await db.select().from(buyers).where(eq(buyers.id, contract.buyerId)))[0];
  if (!buyer) throw notFound('buyer');

  const provider = getPaymentProvider();
  const referenceId = crypto.randomUUID();
  const payment = (await db
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
        .returning())[0]!;
  (await db.update(contracts).set({ settlementCurrency: provider.settlementCurrency }).where(eq(contracts.id, contract.id)));

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
      (await db.update(payments)
                .set({ status: 'failed', raw: JSON.stringify(result.raw ?? null), updatedAt: Date.now() })
                .where(eq(payments.id, payment.id)));
      await handleCollectionFailure(contract.id);
    }
  } catch (err) {
    // Network error at initiation: leave pending — the poll timeout will resolve it.
    (await db.update(payments)
            .set({ raw: JSON.stringify({ initiateError: String(err) }), updatedAt: Date.now() })
            .where(eq(payments.id, payment.id)));
  }
  return payment;
}

/**
 * Refund what is still held, with a balanced journal; ends CANCELLED_REFUNDED.
 * Normally the whole hold. If the farmer's advance already went out (a
 * disputed re-grade that came back REJECT), it is not pulled back (Phase 3,
 * the same rule as a claim): the buyer gets the rest.
 */
export async function refundHold(contractId: string, payload?: Record<string, unknown>): Promise<Contract> {
  const contract = await getContractRow(contractId);
  const { landed, pending } = await farmerPaid(contractId);
  const refund = contract.holdAmount - landed - pending;
  return transitionContract(contractId, 'CANCELLED_REFUNDED', { type: 'system' }, {
    payload: { ...payload, ...(landed + pending > 0 ? { advanceKept: landed + pending } : {}) },
    also: async (tx) => {
      await postJournal(tx, contractId, [
                { account: ACCOUNTS.escrow(contractId), debit: refund, memoKey: 'ledger.refund' },
                { account: ACCOUNTS.buyerRefunds(contract.buyerId), credit: refund, memoKey: 'ledger.refund' },
              ]);
    },
  });
}

async function handleCollectionFailure(contractId: string): Promise<void> {
  const contract = await getContractRow(contractId);
  if (contract.state !== 'ACCEPTED' && contract.state !== 'FUNDING_FAILED') return;

  if (contract.state === 'ACCEPTED') {
    await transitionContract(contractId, 'FUNDING_FAILED', { type: 'system' });
  }
  const attempts = contract.fundingAttempts + 1;
  (await db.update(contracts).set({ fundingAttempts: attempts }).where(eq(contracts.id, contractId)));

  if (attempts < MAX_FUNDING_ATTEMPTS) {
    // One retry with a fresh reference UUID.
    await transitionContract(contractId, 'ACCEPTED', { type: 'system' });
    // Awaited: on serverless a function may stop the moment it answers, taking unawaited work with it.
    await initiateHold(contractId).catch(() => {});
  } else {
    await transitionContract(contractId, 'CANCELLED', { type: 'system' });
  }
}

/**
 * The poll loop — the single place payment statuses change contract state.
 * MoMo callbacks only trigger an immediate call of this for one reference.
 */
export async function pollPaymentsOnce(now = Date.now()): Promise<{ resolved: number }> {
  const provider = getPaymentProvider();
  const pending = (await db.select().from(payments).where(eq(payments.status, 'pending')));
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

    (await db.update(payments)
            .set({ status, raw: JSON.stringify(raw), updatedAt: now })
            .where(eq(payments.id, payment.id)));
    resolved += 1;

    // Transport-fee payments resolve through the delivery-job machine.
    if (payment.jobId) {
      await resolveJobPayment({ ...payment, status }, status);
      continue;
    }

    const contract = await getContractRow(payment.contractId);
    if (payment.direction === 'collection') {
      if (status === 'successful' && contract.state === 'ACCEPTED') {
        await transitionContract(contract.id, 'FUNDS_HELD', { type: 'system' }, {
                    payload: { paymentId: payment.id, amount: payment.amount },
                    also: async (tx) => {
                      await postJournal(tx, contract.id, [
                                      { account: ACCOUNTS.external, debit: contract.holdAmount, memoKey: 'ledger.hold' },
                                      { account: ACCOUNTS.escrow(contract.id), credit: contract.holdAmount, memoKey: 'ledger.hold' },
                                    ]);
                    },
                  });
        const farmer = (await db.select().from(farmers).where(eq(farmers.id, contract.farmerId)))[0];
        const demand = (await db.select().from(demands).where(eq(demands.id, contract.demandId)))[0];
        if (farmer && demand) {
          await queueSms({
                        phone: farmer.phone,
                        locale: farmer.locale,
                        templateKey: 'sms.funded',
                        params: {
                          amount: formatGhs(contract.holdAmount),
                          commodity: t(farmer.locale, getCommodityById(contract.commodityId).nameKey),
                          start: smsDate(demand.windowStart),
                          end: smsDate(demand.windowEnd),
                        },
                        contractId: contract.id,
                        lotId: contract.lotId,
                      });
        }
        await queueBuyerNotification({
                    buyerId: contract.buyerId,
                    templateKey: 'notif.fundsHeld',
                    params: {
                      amount: formatGhs(contract.holdAmount),
                      kg: contract.quantityKg,
                      commodity: t('en', getCommodityById(contract.commodityId).nameKey),
                    },
                    contractId: contract.id,
                    lotId: contract.lotId,
                  });
      } else if (status === 'failed') {
        await handleCollectionFailure(contract.id);
      }
    } else {
      // A farmer payout (Phase 3: the advance at pickup or the balance on
      // receipt). Settlement records it in the ledger and settles the order
      // once the last one lands. A failed one is retried by the sweep.
      await onFarmerPayout({ ...payment, status }, status);
    }
  }
  return { resolved };
}

/** Poll one reference immediately — what a MoMo callback triggers (D-009). */
export async function pollPaymentByReference(referenceId: string): Promise<void> {
  const payment = (await db.select().from(payments).where(eq(payments.providerRef, referenceId)))[0];
  if (!payment || payment.status !== 'pending') return;
  await pollPaymentsOnce();
}

/**
 * Either side accepts the other's proposal in an offer thread (Phase 1): the
 * order is created and the buyer's payment hold starts, exactly as accepting
 * a system offer always has.
 */
export async function acceptOfferThread(
  offerId: string,
  party: Party,
  actorId: string,
  channel: Channel = 'web',
): Promise<{ offer: Offer; contract: Contract }> {
  const { offer, contractId } = await acceptProposal(offerId, party, actorId, channel);
  await initiateHold(contractId);
  return { offer, contract: await getContractRow(contractId) };
}

/** Farmer accepts on USSD → the state transition and the funding hold, together. */
export async function acceptOfferAndHold(contractId: string, farmerId: string): Promise<Contract> {
  const contract = await acceptOffer(contractId, farmerId);
  await initiateHold(contractId);
  return contract;
}

const PICKUP_GRACE_MS = 24 * 60 * 60 * 1000; // one day beyond the delivery window

/**
 * Refund funded contracts whose pickup never happened — the delivery window
 * plus a day of grace has passed with no pickup confirmation. Sweep-driven.
 * Lands CANCELLED_REFUNDED, which also counts against the farmer's history.
 */
export async function refundMissedPickups(now = Date.now()): Promise<number> {
  const held = (await db.select().from(contracts).where(eq(contracts.state, 'FUNDS_HELD')));
  // Defensive (D-025): goods already on a truck are not a missed pickup, even
  // if the contract's own pickup confirmation hasn't landed yet.
  const inTransit = await contractsWithGoodsInTransit();
  let refunded = 0;
  for (const contract of held) {
    if (inTransit.has(contract.id)) continue;
    const demand = (await db.select().from(demands).where(eq(demands.id, contract.demandId)))[0];
    if (demand && now > demand.windowEnd + PICKUP_GRACE_MS) {
      await refundHold(contract.id, { reason: 'pickup_window_missed' });
      refunded += 1;
    }
  }
  return refunded;
}

/**
 * Sweep: farmer payouts that failed are sent again (Phase 3 — advances at
 * pickup, balances on receipt). Kept under its old name for the sweep job.
 */
export async function releaseDuePayments(): Promise<number> {
  return retryFarmerPayouts();
}
