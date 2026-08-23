import { expireOffers, runMatching } from '@ftm/core';
import type { FastifyBaseLogger } from 'fastify';

export interface SweepResult {
  expiredOffers: number;
}

/** One sweep pass: expire stale offers (which rematches), then re-run open demands. */
export function sweepOnce(now = Date.now()): SweepResult {
  const expiredOffers = expireOffers(now);
  runMatching(); // catch demand/lot pairs that appeared between event-driven runs
  return { expiredOffers };
}

export function startSweepJob(log: FastifyBaseLogger, intervalMs = 60_000): NodeJS.Timeout {
  const timer = setInterval(() => {
    try {
      const result = sweepOnce();
      if (result.expiredOffers > 0) log.info(result, 'sweep');
    } catch (err) {
      log.error(err, 'sweep failed');
    }
  }, intervalMs);
  timer.unref();
  return timer;
}
