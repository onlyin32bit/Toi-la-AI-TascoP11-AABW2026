---
status: done
created: 2026-07-12
brainstorm: plans/reports/brainstorm-260712-0112-vehicle-preference-setting.md
---

# Vehicle Preference Setting — Implementation Plan

## Overview

Client-side vehicle picker (walk/bike/motorbike/car) that affects ranking:
lenient hard-filter, geoDecay half-life override, ETA display.
No backend changes. Backwards compat (no vehicle → current behavior).

## Vehicle Profile Params (VN traffic tuned)

| Vehicle    | HardCap (km) | HalfLife (km) | Speed (km/h) | Detour |
|------------|--------------|---------------|--------------|--------|
| walk       | 3            | 0.6           | 4.5          | 1.20   |
| bike       | 10           | 1.5           | 15           | 1.30   |
| motorbike  | 25           | 3.5           | 30           | 1.35   |
| car        | 40           | 6.0           | 22           | 1.40   |

Default = `motorbike`. Persist via `localStorage` key `tasco-vehicle`.

## Phases

| # | Phase | Status | Est |
|---|-------|--------|-----|
| 1 | [Types + i18n keys](phase-01-types-and-i18n.md) | done | 25m |
| 2 | [Ranking algorithm](phase-02-ranking-algorithm.md) | done | 45m |
| 3 | [UI components](phase-03-ui-components.md) | done | 60m |
| 4 | [App integration + verify](phase-04-app-integration-and-verify.md) | done | 50m |

Total: ~3h.

## Dependencies

Phase 1 → Phase 2 (types feed rank.ts).
Phase 1 → Phase 3 (types feed FilterChips props).
Phase 2 → Phase 3 (etaMinutes in PlaceResult drives ResultCard tile).
Phase 3 → Phase 4 (App wires vehicle state through filters).

## Key Files

- [ui/src/types.ts](../../ui/src/types.ts) — add `Vehicle` type, extend
  `SearchFilters`, add `etaMinutes` to `PlaceResult`, extend `NotFoundReason`.
- [ui/src/lib/rank.ts](../../ui/src/lib/rank.ts) — `VEHICLE_PROFILES`,
  hard-filter, half-life override, ETA compute.
- [ui/src/components/FilterChips.tsx](../../ui/src/components/FilterChips.tsx) —
  5th ToggleGroup for vehicle.
- [ui/src/components/ResultCard.tsx](../../ui/src/components/ResultCard.tsx) —
  ETA tile replaces Distance when `etaMinutes !== null`.
- [ui/src/App.tsx](../../ui/src/App.tsx) — persist vehicle in localStorage,
  wire through `runSearch`.
- [ui/src/i18n/translations.ts](../../ui/src/i18n/translations.ts) — vehicle
  labels, ETA label, vehicleRange reason.

## Success Criteria

- Chọn Walk trên phone → top results all <2km (dataset dependent).
- Chọn Car → results spread rộng hơn.
- ETA đổi real-time khi swap vehicle (no re-fetch).
- Reload page → vehicle vẫn giữ (localStorage).
- Không set vehicle → behavior giống hệt hiện tại (fallback halfLife=2, no ETA).
- `npx tsc --noEmit` + `npx vite build` clean.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Empty state khi Walk + dataset thưa | Lenient hard-cap (3km); add `vehicleRange` NotFoundReason with clear message |
| Vehicle set nhưng no GPS | Vehicle inert; ETA shows fallback distance; no crash |
| Icon nucleo-isometric không có vehicle | Fallback emoji (🚶🚲🛵🚗) — simple + universal |
| Ranking regression | Fallback halfLife=2km when no vehicle preserves prior behavior |

## Out of Scope (YAGNI)

- Navigation deep-link (Google Maps intent)
- Route optimization / turn-by-turn
- Live traffic API
- Multi-modal (walk + transit)
- Per-vehicle price sensitivity
