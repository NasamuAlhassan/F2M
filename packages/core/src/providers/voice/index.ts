import { config } from '../../config';

export interface InitiateCallParams {
  callId: string; // our voice_calls id — rides the callback URL
  phone: string; // E.164
  callbackUrl: string;
}

export interface InitiateCallResult {
  status: 'queued' | 'failed';
  providerRef?: string;
  raw?: unknown;
}

export interface VoiceProvider {
  readonly name: 'mock' | 'at';
  initiateCall(p: InitiateCallParams): Promise<InitiateCallResult>;
}

/** Offline default (D-013): queues instantly; the IVR tester/tests drive the callback. */
export class MockVoiceProvider implements VoiceProvider {
  readonly name = 'mock' as const;
  readonly placed: InitiateCallParams[] = [];
  async initiateCall(p: InitiateCallParams): Promise<InitiateCallResult> {
    this.placed.push(p);
    return { status: 'queued', providerRef: `mock-${p.callId}` };
  }
}

/**
 * Africa's Talking Voice: places the outbound call; AT then POSTs to the voice
 * callback URL configured on the dashboard (our /voice/answer), and we answer
 * with Say/GetDigits XML. TTS in Ghanaian languages later swaps to Khaya audio.
 */
export class AtVoiceProvider implements VoiceProvider {
  readonly name = 'at' as const;
  async initiateCall(p: InitiateCallParams): Promise<InitiateCallResult> {
    // Same sandbox-host rule the SMS wire proved: sandbox keys only work there.
    const host = config.AT_USERNAME === 'sandbox' ? 'https://voice.sandbox.africastalking.com' : 'https://voice.africastalking.com';
    const res = await fetch(`${host}/call`, {
      method: 'POST',
      headers: {
        apiKey: config.AT_API_KEY ?? '',
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        username: config.AT_USERNAME,
        from: config.AT_VOICE_NUMBER ?? '',
        to: p.phone,
      }).toString(),
    });
    if (!res.ok) return { status: 'failed', raw: { httpStatus: res.status, body: await res.text() } };
    const body = (await res.json()) as { entries?: Array<{ status?: string; sessionId?: string }> };
    const entry = body.entries?.[0];
    if (entry?.status && entry.status !== 'Queued') return { status: 'failed', raw: body };
    return { status: 'queued', providerRef: entry?.sessionId, raw: body };
  }
}

let provider: VoiceProvider | null = null;

export function getVoiceProvider(): VoiceProvider {
  if (!provider) {
    provider = config.VOICE_PROVIDER === 'at' ? new AtVoiceProvider() : new MockVoiceProvider();
  }
  return provider;
}

/** Test hook — swap the provider. */
export function setVoiceProvider(p: VoiceProvider | null): void {
  provider = p;
}
