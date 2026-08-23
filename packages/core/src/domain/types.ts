import { z } from 'zod';

/** Per-commodity clock — the storable/perishable split. Stored as JSON on commodities.clock_config. */
export const clockConfigSchema = z.object({
  offerTtlMinutes: z.number().positive(),
  distanceDecayKm: z.number().positive(),
  allowsForward: z.boolean(),
  maxWindowDays: z.number().positive(),
});
export type ClockConfig = z.infer<typeof clockConfigSchema>;

export const GRADE_BANDS = ['A', 'B', 'C', 'REJECT'] as const;
export const gradeBandSchema = z.enum(GRADE_BANDS);
export type GradeBand = z.infer<typeof gradeBandSchema>;

/** Per-band prices in pesewas per kg, frozen onto contracts at offer time (D-015). */
export const priceTermsSchema = z.record(gradeBandSchema, z.number().int().nonnegative());
export type PriceTerms = z.infer<typeof priceTermsSchema>;

/** A versioned grading rubric document. Stored as JSON on rubrics.doc. */
export const rubricDocSchema = z.object({
  gradeBands: z.array(z.string()).min(2),
  aggregation: z.literal('worst_criterion'),
  criteria: z
    .array(
      z.object({
        key: z.string(),
        labelKey: z.string(), // i18n key — criteria names reach the farmer in her language
        visualCues: z.string(),
        bandDescriptors: z.record(z.string(), z.string()),
      }),
    )
    .min(1),
});
export type RubricDoc = z.infer<typeof rubricDocSchema>;

export const scoreBreakdownSchema = z.object({
  quantityFit: z.number(),
  distance: z.number(),
  qualityBand: z.number(),
  windowFit: z.number(),
  farmerHistory: z.number(),
  distanceKm: z.number(),
  weights: z.record(z.string(), z.number()),
});
export type ScoreBreakdown = z.infer<typeof scoreBreakdownSchema>;

export const gradingReasonSchema = z.object({
  criterion: z.string(),
  observation: z.string(),
  bandForCriterion: z.string(),
});
export type GradingReason = z.infer<typeof gradingReasonSchema>;

/** Default per-band price multipliers used to expand a base price into PriceTerms. */
export const DEFAULT_BAND_MULTIPLIERS: Record<GradeBand, number> = {
  A: 1.0,
  B: 0.88,
  C: 0.7,
  REJECT: 0,
};

export function expandPriceTerms(basePricePerKg: number, minBand: GradeBand): PriceTerms {
  // The base price is what the buyer pays for their minimum acceptable band;
  // better bands scale up relative to it, worse acceptable bands scale down.
  const baseMultiplier = DEFAULT_BAND_MULTIPLIERS[minBand] || 1;
  const scale = (band: GradeBand) => Math.round((basePricePerKg * DEFAULT_BAND_MULTIPLIERS[band]) / baseMultiplier);
  return { A: scale('A'), B: scale('B'), C: scale('C'), REJECT: 0 };
}

/** Best (highest-priced) band in a price schedule — used to size the payment hold. */
export function bestBand(terms: PriceTerms): GradeBand {
  let best: GradeBand = 'A';
  let bestPrice = -1;
  for (const band of GRADE_BANDS) {
    const p = terms[band] ?? 0;
    if (p > bestPrice) {
      bestPrice = p;
      best = band;
    }
  }
  return best;
}

export function formatGhs(pesewas: number): string {
  return `GHS ${(pesewas / 100).toFixed(2)}`;
}
