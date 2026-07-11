# Phase 04 — App Integration + Verify

**Priority:** P0
**Status:** done
**Est:** 50m
**Depends:** Phase 01, 02, 03

## Context Links

- [plan.md](plan.md)
- Previous phases: [01](phase-01-types-and-i18n.md) · [02](phase-02-ranking-algorithm.md) · [03](phase-03-ui-components.md)
- [ui/src/App.tsx](../../ui/src/App.tsx)

## Overview

Wire everything: vehicle state in App, `localStorage` persist, extend
`reasonText` for the vehicleRange NotFoundReason, verify build + manual
smoke test.

Default vehicle = `motorbike` (per brainstorm — VN reality).

## Key Insights

- App owns `filters` state already; vehicle lives inside filters, but its
  DEFAULT value + persistence pattern mirrors `themeMode`/`accentTheme`
  (localStorage with a reader function).
- Persist strategy: read on mount, seed `filters.vehicle` with stored value.
  On any `handleFiltersChange`, write `filters.vehicle` back to storage.
- `reasonText()` in App.tsx maps NotFoundReason → localized string. Extend
  the switch to handle `"vehicleRange"`.
- Verification is manual (no test infra in project yet). Focus: tsc + build +
  in-app smoke.

## Requirements

- Read vehicle from `localStorage` key `tasco-vehicle`; validate against
  Vehicle union; fallback to `"motorbike"`.
- Initial `filters` includes `vehicle: <read>` (default motorbike).
- All `handleFiltersChange` writes vehicle back to localStorage.
- `reasonText()` handles `"vehicleRange"` case → `t("empty.reason.vehicleRange", {vehicle: t(`vehicle.${r.vehicle}`)})`.
- `tsc --noEmit` clean.
- `vite build` green.
- Manual smoke: 4 scenarios below all pass.

## Related Code Files

**Modify:**
- [ui/src/App.tsx](../../ui/src/App.tsx)

## Implementation Steps

### 1. Add reader function

Near `readAccentTheme`:
```ts
import type { Vehicle } from "./types";

const VEHICLE_IDS: Vehicle[] = ["walk", "bike", "motorbike", "car"];

function readVehicle(): Vehicle {
  const value = window.localStorage.getItem("tasco-vehicle");
  return VEHICLE_IDS.includes(value as Vehicle) ? (value as Vehicle) : "motorbike";
}
```

### 2. Seed filters with vehicle

Replace `useState<SearchFilters>({})`:
```ts
const [filters, setFilters] = useState<SearchFilters>(() => ({
  vehicle: readVehicle(),
}));
```

### 3. Persist vehicle on filters change

Add effect:
```ts
useEffect(() => {
  if (filters.vehicle) {
    window.localStorage.setItem("tasco-vehicle", filters.vehicle);
  }
}, [filters.vehicle]);
```

### 4. Extend `reasonText` for vehicleRange

Insert case before default:
```ts
function reasonText(r: NotFoundReason, t: (k: string, p?: Record<string, string | number>) => string): string {
  switch (r.kind) {
    case "dish":
      return t("empty.reason.dish", { dish: r.dish ?? "" });
    case "dietCity":
      return t("empty.reason.dietCity", { diet: t(`diet.${r.diet}`), city: r.city ?? "" });
    case "segment":
      return t("empty.reason.segment", { segment: t(`segment.${r.segment}`) });
    case "vehicleRange":   // NEW
      return t("empty.reason.vehicleRange", { vehicle: r.vehicle ? t(`vehicle.${r.vehicle}`) : "" });
    default:
      return t("empty.reason.generic");
  }
}
```

### 5. Verify — command sequence

Run in `ui/`:
```bash
npx tsc --noEmit    # exit 0
npx vite build      # exit 0, no new warnings
```

### 6. Manual smoke — 4 scenarios

1. **Default load, no GPS**: vehicle = motorbike, ETA tile shows Distance
   fallback (no location) → OK
2. **Grant GPS + Walk**: switch to Walk chip → ETA appears with 🚶, top
   results ≤ 3km (hard-cap). Ranking prefers closest.
3. **Switch Walk → Car**: same POIs available, ETA numbers drop, order may
   shift (car half-life larger, less penalty for distance).
4. **Walk + very remote city**: force query "Đà Lạt" while GPS in Hà Nội →
   candidates.length === 0 → empty state shows "không có quán nào trong tầm
   đi bộ".

### 7. Reload persistence

Refresh browser → Walk chip should still be active if it was selected last.
Check DevTools → Application → localStorage → `tasco-vehicle` = "walk".

## Todo

- [ ] Add `readVehicle()` function + `VEHICLE_IDS` array
- [ ] Import `Vehicle` type in App.tsx
- [ ] Seed `filters` with `vehicle: readVehicle()`
- [ ] Add effect to persist `filters.vehicle` on change
- [ ] Extend `reasonText` switch with `"vehicleRange"` branch
- [ ] `npx tsc --noEmit` clean
- [ ] `npx vite build` clean (no new warnings)
- [ ] Smoke test scenario 1 (default load)
- [ ] Smoke test scenario 2 (Walk with GPS)
- [ ] Smoke test scenario 3 (Walk → Car swap)
- [ ] Smoke test scenario 4 (empty state message)
- [ ] Verify localStorage persistence across reload

## Success Criteria

- All todo items ✔.
- No console errors in browser DevTools.
- Vehicle chip active state visible in FilterChips row.
- ETA tile refreshes without triggering a search (client rerank).
- Empty state shows vehicleRange message when Walk + no POI in range.

## Risk Assessment

- **Storage schema drift**: if a future refactor changes Vehicle union, old
  stored values might be invalid. `readVehicle()` guards with union check +
  fallback → safe.
- **Effect thrashing**: `useEffect([filters.vehicle])` fires only when the
  value changes. Safe.
- **Empty state UX**: message reads slightly formal; user can tune i18n later.

## Security Considerations

localStorage value is user-controlled but validated against Vehicle union
before use. No injection surface.

## Next Steps

Post-implementation:
- Update [docs/project-changelog.md](../../docs/project-changelog.md) if the
  changelog is tracked (delegate to `docs-manager` per project rules).
- Consider follow-up plan for real vehicle SVG icons (upgrade from emoji).
- Consider backend contract sync when `/v1/recommend` lands — the `vehicle`
  filter becomes a query param.
