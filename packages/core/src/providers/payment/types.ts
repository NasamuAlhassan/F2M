export type PaymentStatus = 'pending' | 'successful' | 'failed';

export interface PaymentParams {
  referenceId: string; // our UUID — the provider idempotency key (X-Reference-Id)
  msisdn: string; // payer for holds, payee for disbursements
  amount: number; // pesewas — providers convert to their wire format
  currency: string;
  externalId: string; // contract id
  note: string;
}

export interface PaymentStatusResult {
  status: PaymentStatus;
  raw?: unknown;
}

export interface PaymentProvider {
  readonly name: 'momo' | 'mock';
  /** The currency that actually moves on the wire (EUR on the MoMo sandbox). */
  readonly settlementCurrency: string;
  requestHold(p: PaymentParams): Promise<PaymentStatusResult>;
  getHoldStatus(referenceId: string): Promise<PaymentStatusResult>;
  disburse(p: PaymentParams): Promise<PaymentStatusResult>;
  getDisburseStatus(referenceId: string): Promise<PaymentStatusResult>;
}
