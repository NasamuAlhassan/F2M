import { config } from '../../config';
import { MockPaymentProvider } from './mockProvider';
import type { PaymentProvider } from './types';

let provider: PaymentProvider | null = null;

/** Payments are simulated until Phase 3 adds a licensed payment provider beside the mock. */
export function getPaymentProvider(): PaymentProvider {
  if (!provider) provider = new MockPaymentProvider(config.MOCK_PAYMENT_DELAY_MS);
  return provider;
}

/** Test hook — swap the provider (e.g. a zero-delay mock). */
export function setPaymentProvider(p: PaymentProvider | null): void {
  provider = p;
}

export type { PaymentParams, PaymentProvider, PaymentStatus, PaymentStatusResult } from './types';
export { MockPaymentProvider } from './mockProvider';
