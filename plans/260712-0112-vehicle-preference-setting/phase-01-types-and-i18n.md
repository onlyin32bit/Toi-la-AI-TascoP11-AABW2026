# Phase 01 — Types + i18n Keys

**Priority:** P0 (foundation for all other phases)
**Status:** done
**Est:** 25m

## Context Links

- [plan.md](plan.md)
- [brainstorm](../reports/brainstorm-260712-0112-vehicle-preference-setting.md)
- Existing types: [ui/src/types.ts](../../ui/src/types.ts)
- i18n: [ui/src/i18n/translations.ts](../../ui/src/i18n/translations.ts)

## Overview

Foundation phase. Add `Vehicle` type + extend contracts + add i18n keys.
Zero behavior change. Compiles clean but nothing wired yet.

## Key Insights

- Contract fields must be OPTIONAL to preserve backwards compat:
  `SearchFilters.vehicle?`, `PlaceResult.etaMinutes` = `number | null`.
- `NotFoundReason` currently union of 4 kinds — add "vehicleRange" as 5th.
- i18n dict is flat with `{param}` interpolation. Keep vehicle keys grouped.

## Requirements

- `Vehicle` = "walk" | "bike" | "motorbike" | "car"
- `SearchFilters.vehicle?: Vehicle`
- `PlaceResult.etaMinutes: number | null`
- `NotFoundReason.kind: "dish" | "dietCity" | "segment" | "vehicleRange" | "generic"`
- `NotFoundReason.vehicle?: Vehicle` (for vehicleRange variant)
- i18n VI + EN for: `vehicle.walk`, `vehicle.bike`, `vehicle.motorbike`,
  `vehicle.car`, `result.eta`, `reason.eta`, `empty.reason.vehicleRange`

## Related Code Files

**Modify:**
- [ui/src/types.ts](../../ui/src/types.ts)
- [ui/src/i18n/translations.ts](../../ui/src/i18n/translations.ts)

**Create:** none.

**Delete:** none.

## Implementation Steps

### 1. types.ts

Insert after `Diet` type:
```ts
export type Vehicle = "walk" | "bike" | "motorbike" | "car";
```

Extend `SearchFilters`:
```ts
export interface SearchFilters {
  segment?: Segment;
  diet?: Diet;
  price?: PriceLevel;
  time?: "now" | "late_night";
  vehicle?: Vehicle;   // NEW
}
```

Extend `PlaceResult`:
```ts
export interface PlaceResult {
  // ...existing fields...
  distanceMeters: number | null;
  etaMinutes: number | null;   // NEW; null if no userLoc OR no vehicle
  // ...
}
```

Extend `NotFoundReason`:
```ts
export interface NotFoundReason {
  kind: "dish" | "dietCity" | "segment" | "vehicleRange" | "generic";
  dish?: string;
  diet?: Diet;
  city?: string;
  segment?: Segment;
  vehicle?: Vehicle;   // NEW; set when kind === "vehicleRange"
}
```

### 2. translations.ts

Add to `vi` dict (after `time.lateNight`):
```ts
"vehicle.walk": "Đi bộ",
"vehicle.bike": "Xe đạp",
"vehicle.motorbike": "Xe máy",
"vehicle.car": "Ô tô",
```

Add to `result.matchedDishes` group:
```ts
"result.eta": "ETA",
```

Add to `reason.*` group:
```ts
"reason.eta": "khoảng {min} phút bằng {vehicle}",
```

Add to `empty.reason.*` group:
```ts
"empty.reason.vehicleRange": "không có quán nào trong tầm {vehicle}",
```

Mirror all to `en` dict:
```ts
"vehicle.walk": "Walk",
"vehicle.bike": "Bike",
"vehicle.motorbike": "Motorbike",
"vehicle.car": "Car",
"result.eta": "ETA",
"reason.eta": "~{min} min by {vehicle}",
"empty.reason.vehicleRange": "no places within {vehicle} range",
```

## Todo

- [ ] Add `Vehicle` type to types.ts
- [ ] Extend `SearchFilters` with `vehicle?`
- [ ] Extend `PlaceResult` with `etaMinutes: number | null`
- [ ] Extend `NotFoundReason.kind` union + optional `vehicle?`
- [ ] Add 4 vehicle labels VI + EN
- [ ] Add `result.eta` VI + EN
- [ ] Add `reason.eta` VI + EN
- [ ] Add `empty.reason.vehicleRange` VI + EN
- [ ] Run `npx tsc --noEmit` in `ui/` — expect breaking errors in `rank.ts`
      (returns PlaceResult without etaMinutes) — that's OK, Phase 02 fixes.

## Success Criteria

- Types file exports `Vehicle`.
- i18n has all 8 new keys in both langs.
- `tsc --noEmit` reports errors ONLY in rank.ts (missing etaMinutes) —
  confirms new types are wired correctly and rank.ts breaks as expected.

## Risk Assessment

- Low risk. Type-only + string additions.
- Only "risk": forgetting a key in either VI or EN dict → t() falls back to key
  literal, ugly but not crashy.

## Security Considerations

None. String literals + type aliases.

## Next Steps

→ [Phase 02](phase-02-ranking-algorithm.md) — implement rank.ts changes so
compile passes.
