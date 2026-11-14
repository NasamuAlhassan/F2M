import {
  cancelStaleJobs,
  expireDemands,
  expireJobOffers,
  expireOffers,
  expireStaleVoiceCalls,
  placePendingVoiceCalls,
  pollPaymentsOnce,
  refundMissedPickups,
  releaseDuePayments,
  runMatching,
  sendPendingNotifications,
  sweepListings,
  sweepOffers,
} from '@ftm/core';
import type { FastifyBaseLogger } from 'fastify';

export interface SweepResult {
  expiredOffers: number;
  expiredDemands: number;
  missedPickupsRefunded: number;
  expiredJobOffers: number;
  staleJobsCancelled: number;
  releasesStarted: number;
  paymentsResolved: number;
  smsDelivered: number;
  /** Offer threads (Phase 1): proposals that lapsed, and farmers reminded that a buyer is waiting. */
  offerThreadsExpired: number;
  offerReminders: number;
  /** Listings warned two days before they lapse, and listings that lapsed. */
  listingsWarned: number;
  listingsExpired: number;
}

/** One full sweep pass: expiries → missed-pickup refunds → job dispatch upkeep → rematch → releases → payment polling. */
export async function sweepOnce(now = Date.now()): Promise<SweepResult> {
  const expiredOffers = expireOffers(now);
  const threads = sweepOffers(now);
  const listings = sweepListings(now);
  const expiredDemands = expireDemands(now);
  const missedPickupsRefunded = refundMissedPickups(now);
  const expiredJobOffers = expireJobOffers(now);
  const staleJobsCancelled = cancelStaleJobs(now);
  runMatching(); // catch demand/lot pairs that appeared between event-driven runs
  const releasesStarted = await releaseDuePayments(now);
  const { resolved: paymentsResolved } = await pollPaymentsOnce(now);
  const smsDelivered = await sendPendingNotifications();
  await placePendingVoiceCalls();
  expireStaleVoiceCalls(now);
  return {
    expiredOffers,
    expiredDemands,
    missedPickupsRefunded,
    expiredJobOffers,
    staleJobsCancelled,
    releasesStarted,
    paymentsResolved,
    smsDelivered,
    offerThreadsExpired: threads.expired,
    offerReminders: threads.reminded,
    listingsWarned: listings.warned,
    listingsExpired: listings.expired,
  };
}

export function startSweepJobs(log: FastifyBaseLogger): NodeJS.Timeout[] {
  // Slow lane: offer expiry + rematch + due releases, every 60s.
  const slow = setInterval(() => {
    sweepOnce().then(
      (r) => {
        const activity =
          r.expiredOffers + r.expiredDemands + r.missedPickupsRefunded + r.expiredJobOffers + r.staleJobsCancelled + r.releasesStarted +
          r.offerThreadsExpired + r.offerReminders + r.listingsWarned + r.listingsExpired;
        if (activity > 0) log.info(r, 'sweep');
      },
      (err) => log.error(err, 'sweep failed'),
    );
  }, 60_000);
  // Fast lane: payment status polling + SMS delivery every 5s — sandbox
  // callbacks are unreliable (D-009), and a farmer's SMS should not wait a minute.
  const fast = setInterval(() => {
    pollPaymentsOnce()
      .then(() => sendPendingNotifications())
      .then(() => placePendingVoiceCalls())
      .catch((err) => log.error(err, 'fast sweep failed'));
  }, 5_000);
  slow.unref();
  fast.unref();
  return [slow, fast];
}
