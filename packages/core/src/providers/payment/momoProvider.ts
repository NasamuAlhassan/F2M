import { config } from '../../config';
import type { PaymentParams, PaymentProvider, PaymentStatusResult } from './types';

type Product = 'collection' | 'disbursement';

interface TokenCache {
  token: string;
  expiresAt: number;
}

/**
 * MTN MoMo sandbox provider. Two separately-subscribed products with separate
 * subscription keys and token endpoints (a Collections token 401s on a
 * Disbursements call). Poll-first: statuses come from GET, never from callback
 * payloads (D-009).
 */
export class MomoPaymentProvider implements PaymentProvider {
  readonly name = 'momo' as const;
  readonly settlementCurrency = config.MOMO_CURRENCY;

  private tokens: Partial<Record<Product, TokenCache>> = {};

  private subKey(product: Product): string {
    const key = product === 'collection' ? config.MOMO_SUB_KEY_COLLECTIONS : config.MOMO_SUB_KEY_DISBURSEMENTS;
    if (!key) throw new Error(`Missing MoMo subscription key for ${product}`);
    return key;
  }

  private async token(product: Product): Promise<string> {
    const cached = this.tokens[product];
    if (cached && cached.expiresAt > Date.now()) return cached.token;
    const basic = Buffer.from(`${config.MOMO_API_USER}:${config.MOMO_API_KEY}`).toString('base64');
    const res = await fetch(`${config.MOMO_BASE_URL}/${product}/token/`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Ocp-Apim-Subscription-Key': this.subKey(product),
      },
    });
    if (!res.ok) throw new Error(`MoMo ${product} token failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    // Cache to ~55min of the 3600s lifetime.
    this.tokens[product] = { token: body.access_token, expiresAt: Date.now() + (body.expires_in - 300) * 1000 };
    return body.access_token;
  }

  /** Pesewas → MoMo's major-unit decimal string. */
  private wireAmount(pesewas: number): string {
    return (pesewas / 100).toFixed(2);
  }

  private async initiate(product: Product, path: string, p: PaymentParams, partyRole: 'payer' | 'payee'): Promise<PaymentStatusResult> {
    const token = await this.token(product);
    const res = await fetch(`${config.MOMO_BASE_URL}/${product}/v1_0/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Reference-Id': p.referenceId,
        'X-Target-Environment': config.MOMO_TARGET_ENV,
        'Ocp-Apim-Subscription-Key': this.subKey(product),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: this.wireAmount(p.amount),
        currency: p.currency,
        externalId: p.externalId,
        [partyRole]: { partyIdType: 'MSISDN', partyId: p.msisdn },
        payerMessage: p.note,
        payeeNote: p.note,
      }),
    });
    if (res.status === 202 || res.status === 200) return { status: 'pending' };
    // 409 = duplicate reference — the request already exists, poll will resolve it.
    if (res.status === 409) return { status: 'pending', raw: { duplicate: true } };
    return { status: 'failed', raw: { httpStatus: res.status, body: await res.text() } };
  }

  private async queryStatus(product: Product, path: string, referenceId: string): Promise<PaymentStatusResult> {
    const token = await this.token(product);
    const res = await fetch(`${config.MOMO_BASE_URL}/${product}/v1_0/${path}/${referenceId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Target-Environment': config.MOMO_TARGET_ENV,
        'Ocp-Apim-Subscription-Key': this.subKey(product),
      },
    });
    if (!res.ok) return { status: 'pending', raw: { httpStatus: res.status, body: await res.text() } };
    const body = (await res.json()) as { status?: string; reason?: unknown };
    const status =
      body.status === 'SUCCESSFUL' ? 'successful' : body.status === 'FAILED' || body.status === 'REJECTED' ? 'failed' : 'pending';
    return { status, raw: body };
  }

  requestHold(p: PaymentParams): Promise<PaymentStatusResult> {
    return this.initiate('collection', 'requesttopay', { ...p, currency: this.settlementCurrency }, 'payer');
  }
  getHoldStatus(referenceId: string): Promise<PaymentStatusResult> {
    return this.queryStatus('collection', 'requesttopay', referenceId);
  }
  disburse(p: PaymentParams): Promise<PaymentStatusResult> {
    return this.initiate('disbursement', 'transfer', { ...p, currency: this.settlementCurrency }, 'payee');
  }
  getDisburseStatus(referenceId: string): Promise<PaymentStatusResult> {
    return this.queryStatus('disbursement', 'transfer', referenceId);
  }
}
