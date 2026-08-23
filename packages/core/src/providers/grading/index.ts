import { config } from '../../config';
import { HfGradingProvider } from './hfProvider';
import { MockGradingProvider } from './mockProvider';
import type { GradingProvider, GradingRequest, GradingResult } from './types';

let provider: GradingProvider | null = null;

export function getGradingProvider(): GradingProvider {
  if (!provider) {
    provider = config.GRADING_PROVIDER === 'hf' ? new HfGradingProvider() : new MockGradingProvider();
  }
  return provider;
}

/** Test hook — swap the provider. */
export function setGradingProvider(p: GradingProvider | null): void {
  provider = p;
}

/**
 * Grade with the configured provider; if it throws (cold model, rate limit,
 * unparseable output after repair), fall back to the deterministic mock with
 * confidence capped low and the failure recorded — the demo never dies (D-006).
 */
export async function gradeWithFallback(req: GradingRequest): Promise<GradingResult> {
  const primary = getGradingProvider();
  try {
    return await primary.grade(req);
  } catch (err) {
    if (primary.name === 'mock') throw err;
    const fallback = await new MockGradingProvider(0.4).grade(req);
    return {
      ...fallback,
      confidence: Math.min(fallback.confidence, 0.4),
      raw: { fallbackFrom: primary.name, error: String(err) },
    };
  }
}

export { extractJson } from './extractJson';
export { HfGradingProvider } from './hfProvider';
export { MockGradingProvider } from './mockProvider';
export { modelOutputSchema } from './types';
export type { GradingImage, GradingProvider, GradingRequest, GradingResult } from './types';
