import {
  expireDemands,
  expireOffers,
  pollPaymentsOnce,
  refundMissedPickups,
  releaseDuePayments,
  runMatching,
} from '@ftm/core';
import type { FastifyBaseLogger } from 'fastify';

export interface SweepResult {
  expiredOffers: number;
  expiredDemands: number;
  missedPickupsRefunded: number;
  releasesStarted: number;
  paymentsResolved: number;
}

/** One full sweep pass: expiries → missed-pickup refunds → rematch → due releases → payment polling. */
export async function sweepOnce(now = Date.now()): Promise<SweepResult> {
  const expiredOffers = expireOffers(now);
  const expiredDemands = expireDemands(now);
  const missedPickupsRefunded = refundMissedPickups(now);
  runMatching(); // catch demand/lot pairs that appeared between event-driven runs
  const releasesStarted = await releaseDuePayments(now);
  const { resolved: paymentsResolved } = await pollPaymentsOnce(now);
  return { expiredOffers, expiredDemands, missedPickupsRefunded, releasesStarted, paymentsResolved };
}

export function startSweepJobs(log: FastifyBaseLogger): NodeJS.Timeout[] {
  // Slow lane: offer expiry + rematch + due releases, every 60s.
  const slow = setInterval(() => {
    sweepOnce().then(
      (r) => {
        if (r.expiredOffers + r.expiredDemands + r.missedPickupsRefunded + r.releasesStarted > 0) log.info(r, 'sweep');
      },
      (err) => log.error(err, 'sweep failed'),
    );
  }, 60_000);
  // Fast lane: payment status polling every 5s — sandbox callbacks are unreliable (D-009).
  const fast = setInterval(() => {
    pollPaymentsOnce().catch((err) => log.error(err, 'payment poll failed'));
  }, 5_000);
  slow.unref();
  fast.unref();
  return [slow, fast];
}
