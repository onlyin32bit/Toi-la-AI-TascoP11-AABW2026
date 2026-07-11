# Phase 02 — Ranking Algorithm

**Priority:** P0
**Status:** done
**Est:** 45m
**Depends:** Phase 01

## Context Links

- [plan.md](plan.md)
- [Phase 01](phase-01-types-and-i18n.md)
- Existing rank: [ui/src/lib/rank.ts](../../ui/src/lib/rank.ts)

## Overview

Wire the `Vehicle` param through ranking. `VEHICLE_PROFILES` const drives
hard-filter, geoDecay half-life, and ETA calc. When `filters.vehicle` unset,
behavior is IDENTICAL to current (fallback halfLife=2, no hard-cap, no ETA).

## Key Insights

- Hard-filter belongs in the candidate loop (before scoring) — same layer as
  city/dish/segment gates. Requires `userLoc` present to compute distance.
- Half-life override lives inside `scorePoi` (existing geoDecay math).
- ETA = pure function of distance × detour ÷ speed. Only meaningful with GPS.
- `NotFoundReason` "vehicleRange" fires only when candidates.length === 0 AND
  the reason was vehicle-cap (not diet/city). Preserve existing priority order.

## Requirements

- `VEHICLE_PROFILES: Record<Vehicle, {hardCapKm, halfLifeKm, speedKmh, detour}>`
- Hard-filter integrated in `recommend()` candidate filter loop
- `scorePoi()`: half-life honors `filters.vehicle` (fallback 2km)
- `scorePoi()`: compute `etaMinutes` from distance × detour × speed
- Fallback: `etaMinutes = null` if no `userLoc` OR no `filters.vehicle`
- `buildNotFoundReason()`: emit `vehicleRange` when vehicle filter caused empty
- Backwards compat: existing callers without `vehicle` behave identically

## Related Code Files

**Modify:**
- [ui/src/lib/rank.ts](../../ui/src/lib/rank.ts)

## Implementation Steps

### 1. Add `VEHICLE_PROFILES` constant

After imports, before `stripDiacritics`:
```ts
import type { Vehicle, ... } from "../types";

const VEHICLE_PROFILES: Record<Vehicle, {
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
```

### 2. Update `scorePoi()` — half-life + ETA

Replace the current geoDecay block:
```ts
let distanceMeters: number | null = null;
let geoDecay: number | null = null;
let etaMinutes: number | null = null;
if (userLoc) {
  distanceMeters = Math.round(haversineMeters(userLoc, poi));
  const halfLifeKm = filters.vehicle
    ? VEHICLE_PROFILES[filters.vehicle].halfLifeKm
    : 2;
  geoDecay = Math.exp(-(distanceMeters / 1000) / halfLifeKm);
  if (filters.vehicle) {
    const p = VEHICLE_PROFILES[filters.vehicle];
    etaMinutes = Math.round((distanceMeters / 1000) * p.detour / p.speedKmh * 60);
  }
}
```

Add `etaMinutes` to returned `PlaceResult`:
```ts
return {
  id: poi.id,
  // ...
  distanceMeters,
  etaMinutes,   // NEW
  // ...
};
```

### 3. Update `recommend()` — hard-filter

Extend candidate filter:
```ts
const candidates = mockPlaces.filter((poi) => {
  if (requestedCity && poi.city !== requestedCity) return false;
  if (requestedDish && !poi.menu.some((m) => m.dishName === requestedDish)) return false;
  if (filters.diet && !poi.diet.includes(filters.diet)) return false;
  if (filters.price && poi.priceLevel !== filters.price) return false;
  if (filters.segment && !poi.segments.includes(filters.segment)) return false;
  if (filters.time === "late_night" && !poi.opening.overnight) return false;
  if (filters.time === "now" && !isOpenAt(poi, nowMinute)) return false;
  // NEW: lenient vehicle range gate
  if (filters.vehicle && userLoc) {
    const distKm = haversineMeters(userLoc, poi) / 1000;
    if (distKm > VEHICLE_PROFILES[filters.vehicle].hardCapKm) return false;
  }
  return true;
});
```

### 4. Update `buildNotFoundReason()`

Add vehicleRange branch (place BEFORE generic; AFTER dish/dietCity/segment):
```ts
function buildNotFoundReason(
  filters: SearchFilters,
  city: string | null,
  dish: string | null,
  hasUserLoc: boolean,   // NEW param
): NotFoundReason {
  if (dish) return { kind: "dish", dish };
  if (filters.diet && city) return { kind: "dietCity", diet: filters.diet, city };
  if (filters.segment) return { kind: "segment", segment: filters.segment };
  if (filters.vehicle && hasUserLoc) return { kind: "vehicleRange", vehicle: filters.vehicle };
  return { kind: "generic" };
}
```

Update caller in `recommend()` to pass `Boolean(userLoc)`.

## Todo

- [ ] Import `Vehicle` type
- [ ] Add `VEHICLE_PROFILES` const
- [ ] Update `scorePoi` — halfLife override + etaMinutes
- [ ] Add `etaMinutes` to PlaceResult return
- [ ] Add vehicle hard-cap to candidate filter
- [ ] Add `hasUserLoc` param to `buildNotFoundReason` + vehicleRange branch
- [ ] Update `buildNotFoundReason` caller
- [ ] `npx tsc --noEmit` → clean
- [ ] Sanity check: without `filters.vehicle`, geoDecay math unchanged (halfLife=2)

## Success Criteria

- `tsc --noEmit` in `ui/` clean.
- Manual unit trace (in-head):
  - Distance 500m, walk → geoDecay = exp(-0.5/0.6) ≈ 0.435 (strong penalty ok
    for walk far).
  - Distance 500m, car → geoDecay = exp(-0.5/6) ≈ 0.920 (near irrelevant).
  - Same distance, no vehicle → geoDecay = exp(-0.5/2) ≈ 0.779 (current).
- ETA sample: 2km × 1.35 detour / 30 kmh × 60 = 5.4 min → rounded 5 for motorbike.

## Risk Assessment

- **Regression risk**: fallback halfLife=2 preserves existing math. Verify by
  comparing scores of a fixture POI with vs without vehicle unset.
- **Hard-cap too aggressive**: chose lenient (3km walk, 40km car). Should be
  fine for VN dataset. Can loosen if 0-results appear common.
- **NaN/Inf**: divisions safe (speedKmh > 0, halfLife > 0).

## Security Considerations

None.

## Next Steps

→ [Phase 03](phase-03-ui-components.md) — surface `etaMinutes` in ResultCard,
add vehicle chip to FilterChips.
