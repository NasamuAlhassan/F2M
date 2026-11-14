import { describe, expect, it } from 'vitest';
import { MockTtsProvider } from './index';

// The Space voice (the only real TTS provider) is covered in ../space.test.ts.
describe('TTS providers', () => {
  it('mock always answers null (→ <Say> fallback)', async () => {
    expect(await new MockTtsProvider().synthesize()).toBeNull();
  });
});
