import { config } from '../../config';

export interface NotifyProvider {
  readonly name: 'mock' | 'at';
  /** Deliver one SMS. Throws on failure — the outbox records the error. */
  send(phone: string, message: string): Promise<void>;
}

/** Offline default (D-013): always delivers, keeps a transcript for tests. */
export class MockNotifyProvider implements NotifyProvider {
  readonly name = 'mock' as const;
  readonly sent: Array<{ phone: string; message: string }> = [];
  async send(phone: string, message: string): Promise<void> {
    this.sent.push({ phone, message });
  }
}

/** Africa's Talking SMS (sandbox works with the sandbox username + API key). */
export class AtNotifyProvider implements NotifyProvider {
  readonly name = 'at' as const;
  async send(phone: string, message: string): Promise<void> {
    const res = await fetch('https://api.africastalking.com/version1/messaging', {
      method: 'POST',
      headers: {
        apiKey: config.AT_API_KEY ?? '',
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ username: config.AT_USERNAME, to: phone, message }).toString(),
    });
    if (!res.ok) throw new Error(`AT SMS failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { SMSMessageData?: { Recipients?: Array<{ status?: string }> } };
    const status = body.SMSMessageData?.Recipients?.[0]?.status;
    if (status && status !== 'Success') throw new Error(`AT SMS recipient status: ${status}`);
  }
}

let provider: NotifyProvider | null = null;

export function getNotifyProvider(): NotifyProvider {
  if (!provider) {
    provider = config.NOTIFY_PROVIDER === 'at' ? new AtNotifyProvider() : new MockNotifyProvider();
  }
  return provider;
}

/** Test hook — swap the provider. */
export function setNotifyProvider(p: NotifyProvider | null): void {
  provider = p;
}
