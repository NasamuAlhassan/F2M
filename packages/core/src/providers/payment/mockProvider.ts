import type { PaymentParams, PaymentProvider, PaymentStatusResult } from './types';

/**
 * Deterministic offline payment rail (dev default — D-013).
 * Magic MSISDNs mirror MoMo's sandbox test numbers so failure paths are
 * testable offline: ...0000 fails, ...0001 stays pending forever.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock' as const;
  readonly settlementCurrency = 'GHS';

  private readonly requests = new Map<string, { msisdn: string; createdAt: number }>();

  constructor(private readonly settleDelayMs: number = 2000) {}

  private start(p: PaymentParams): PaymentStatusResult {
    this.requests.set(p.referenceId, { msisdn: p.msisdn, createdAt: Date.now() });
    return { status: 'pending' };
  }

  private check(referenceId: string): PaymentStatusResult {
    const req = this.requests.get(referenceId);
    // Unknown reference (e.g. server restarted mid-dev): assume it completed.
    if (!req) return { status: 'successful', raw: { assumed: true } };
    if (req.msisdn.endsWith('0000')) return { status: 'failed', raw: { reason: 'PAYER_REJECTED' } };
    if (req.msisdn.endsWith('0001')) return { status: 'pending', raw: { reason: 'STUCK' } };
    const done = Date.now() - req.createdAt >= this.settleDelayMs;
    return { status: done ? 'successful' : 'pending' };
  }

  async requestHold(p: PaymentParams): Promise<PaymentStatusResult> {
    return this.start(p);
  }
  async getHoldStatus(referenceId: string): Promise<PaymentStatusResult> {
    return this.check(referenceId);
  }
  async disburse(p: PaymentParams): Promise<PaymentStatusResult> {
    return this.start(p);
  }
  async getDisburseStatus(referenceId: string): Promise<PaymentStatusResult> {
    return this.check(referenceId);
  }
}
