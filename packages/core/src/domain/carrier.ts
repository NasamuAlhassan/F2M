import { timingSafeEqual } from 'node:crypto';
import { config } from '../config';

/**
 * The carrier boundary (D-047). Africa's Talking calls /ussd and /voice/* on
 * its own; it offers no request signing, so the guard is a secret token in
 * the callback URL. While the phone simulator is on, callbacks also come from
 * the simulator, which cannot know the secret, so the check is off then — the
 * simulator is for a closed test group by definition.
 */

/** An absolute callback URL for the carrier, carrying the token when one is set. */
export function carrierCallbackUrl(pathAndQuery: string): string {
  const url = new URL(pathAndQuery, config.PUBLIC_BASE_URL);
  if (config.CARRIER_WEBHOOK_TOKEN) url.searchParams.set('token', config.CARRIER_WEBHOOK_TOKEN);
  return url.toString();
}

/** Whether a carrier-surface request may proceed, given the `token` it carried. */
export function carrierRequestAllowed(token: unknown): boolean {
  if (config.simulatorEnabled) return true;
  const expected = config.CARRIER_WEBHOOK_TOKEN;
  if (!expected || typeof token !== 'string') return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
