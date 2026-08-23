import { z } from 'zod';
import type { RubricDoc } from '../../domain/types';

export interface GradingImage {
  mime: string;
  base64: string; // pre-resized ≤1024px — sharp does this at upload
}

export interface GradingRequest {
  commodityCode: string;
  rubric: RubricDoc;
  images: GradingImage[];
}

export interface GradingReasonOut {
  criterion: string;
  observation: string;
  bandForCriterion: string;
}

export interface GradingResult {
  gradeBand: string;
  confidence: number; // 0..1
  reasons: GradingReasonOut[];
  provider: 'hf' | 'mock';
  model?: string;
  raw?: unknown;
}

export interface GradingProvider {
  readonly name: 'hf' | 'mock';
  grade(req: GradingRequest): Promise<GradingResult>;
}

/** Schema the model's JSON must satisfy, bound to the rubric it was graded against. */
export function modelOutputSchema(rubric: RubricDoc) {
  const bands = rubric.gradeBands as [string, ...string[]];
  const criteria = rubric.criteria.map((c) => c.key) as [string, ...string[]];
  return z.object({
    gradeBand: z.enum(bands),
    confidence: z.number().min(0).max(1),
    reasons: z
      .array(
        z.object({
          criterion: z.enum(criteria),
          observation: z.string().min(1),
          bandForCriterion: z.enum(bands),
        }),
      )
      .min(1),
  });
}
