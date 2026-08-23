import crypto from 'node:crypto';
import type { GradingProvider, GradingRequest, GradingResult } from './types';

/**
 * Deterministic offline grader (dev default + runtime fallback — D-013).
 * Band comes from a hash of the image bytes (stable per photo, weighted toward
 * B); reasons quote the actual rubric so the UI renders identically to real
 * grading.
 */
export class MockGradingProvider implements GradingProvider {
  readonly name = 'mock' as const;

  constructor(private readonly confidenceCap = 0.85) {}

  async grade(req: GradingRequest): Promise<GradingResult> {
    const hash = crypto
      .createHash('sha256')
      .update(req.images.map((i) => i.base64).join(''))
      .digest();
    // Weighted: A 25%, B 45%, C 25%, REJECT 5% — demos should mostly pass.
    const roll = (hash[0]! / 255) * 100;
    const bands = req.rubric.gradeBands;
    const gradeBand =
      roll < 25 ? (bands[0] ?? 'A') : roll < 70 ? (bands[1] ?? 'B') : roll < 95 ? (bands[2] ?? 'C') : (bands[bands.length - 1] ?? 'REJECT');

    const reasons = req.rubric.criteria.slice(0, 3).map((c, i) => {
      // Vary the per-criterion band a little so the breakdown looks honest.
      const criterionBand = i === 0 ? gradeBand : (bands[Math.max(0, bands.indexOf(gradeBand) - (hash[i]! % 2))] ?? gradeBand);
      return {
        criterion: c.key,
        observation: c.bandDescriptors[criterionBand] ?? c.visualCues,
        bandForCriterion: criterionBand,
      };
    });

    return {
      gradeBand,
      confidence: Math.min(this.confidenceCap, 0.6 + (hash[1]! / 255) * 0.3),
      reasons,
      provider: 'mock',
    };
  }
}
