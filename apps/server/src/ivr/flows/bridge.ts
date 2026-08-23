import type { I18nText } from '@ftm/core';
import type { IvrFlow, IvrResult } from '../machine';

// Call-bridge stub: when Khaya translation + AT Voice bridging land, this flow
// becomes "hold while we connect you to the buyer, translated". For now it
// speaks the promise and completes — the queue, provider, and trace plumbing
// around it are the real deliverable.

const say: I18nText[] = [{ key: 'voice.bridge.stub' }];

export const bridgeFlow: IvrFlow = {
  entry: 'bridge_main',
  nodes: [
    {
      key: 'bridge_main',
      guard: () => say, // say the stub and hang up — nothing to gather yet
      say: () => say,
      onDigits: (): IvrResult => ({ end: say, outcome: { result: 'stub' } }),
    },
  ],
};
