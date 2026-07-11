// Quality score tiers + helpers for the enrichment demo.
// Threshold ranges: <70% low (orange), 70-85% mid (yellow), >=85% high (green).

export const QUALITY_THRESHOLDS = { LOW: 0.7, HIGH: 0.85 } as const;

export type QualityTier = "low" | "mid" | "high";

export function qualityTier(score: number): QualityTier {
  if (score < QUALITY_THRESHOLDS.LOW) return "low";
  if (score < QUALITY_THRESHOLDS.HIGH) return "mid";
  return "high";
}

export function qualityPercent(score: number): number {
  return Math.round(Math.max(0, Math.min(1, score)) * 100);
}
