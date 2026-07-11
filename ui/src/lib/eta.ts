// Vehicle-tuned distance/ETA model (VN traffic), shared by the mock ranker
// (lib/rank.ts) and the real-backend adapter (lib/api-adapters.ts) so ETA
// display behaves identically regardless of which data source is active.
import type { Vehicle } from "../types";

export const VEHICLE_PROFILES: Record<Vehicle, {
  hardCapKm: number;
  halfLifeKm: number;
  speedKmh: number;
  detour: number;
}> = {
  walk:      { hardCapKm: 3,  halfLifeKm: 0.6, speedKmh: 4.5, detour: 1.20 },
  bike:      { hardCapKm: 10, halfLifeKm: 1.5, speedKmh: 15,  detour: 1.30 },
  motorbike: { hardCapKm: 25, halfLifeKm: 3.5, speedKmh: 30,  detour: 1.35 },
  car:       { hardCapKm: 40, halfLifeKm: 6.0, speedKmh: 22,  detour: 1.40 },
};

// Fallback half-life when no vehicle preference is set.
export const DEFAULT_HALF_LIFE_KM = 2;

/** Estimated travel time in minutes; null when distance or vehicle is unknown. */
export function computeEtaMinutes(distanceMeters: number | null, vehicle?: Vehicle): number | null {
  if (distanceMeters === null || !vehicle) return null;
  const p = VEHICLE_PROFILES[vehicle];
  return Math.round(((distanceMeters / 1000) * p.detour) / p.speedKmh * 60);
}
