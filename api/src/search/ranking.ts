export interface ScoreComponents {
  semantic: number;
  preference: number;
  distance: number;
  quality: number;
  review: number;
  freshness: number;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function rankCandidate(components: ScoreComponents): number {
  return Number(
    (
      0.5 * clamp(components.semantic) +
      0.15 * clamp(components.preference) +
      0.1 * clamp(components.distance) +
      0.1 * clamp(components.quality) +
      0.1 * clamp(components.review) +
      0.05 * clamp(components.freshness)
    ).toFixed(4),
  );
}

export function distanceScore(
  distanceMeters: number | null,
  radiusMeters: number | null,
): number {
  if (distanceMeters === null || radiusMeters === null || radiusMeters <= 0)
    return 0.5;
  return clamp(1 - distanceMeters / radiusMeters);
}

export function freshnessScore(updatedAt: string): number {
  const ageDays = (Date.now() - new Date(updatedAt).getTime()) / 86_400_000;
  if (ageDays <= 7) return 1;
  if (ageDays <= 30) return 0.85;
  if (ageDays <= 90) return 0.6;
  return 0.3;
}
