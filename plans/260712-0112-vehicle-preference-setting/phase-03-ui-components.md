# Phase 03 — UI Components

**Priority:** P0
**Status:** done
**Est:** 60m
**Depends:** Phase 01 (types), Phase 02 (etaMinutes on PlaceResult)

## Context Links

- [plan.md](plan.md)
- [Phase 01](phase-01-types-and-i18n.md)
- [Phase 02](phase-02-ranking-algorithm.md)
- [ui/src/components/FilterChips.tsx](../../ui/src/components/FilterChips.tsx)
- [ui/src/components/ResultCard.tsx](../../ui/src/components/ResultCard.tsx)

## Overview

Two component changes:
1. **FilterChips**: add 5th ToggleGroup for vehicle (walk/bike/motorbike/car)
2. **ResultCard**: Distance tile → ETA tile (fallback to distance when no
   vehicle set)

Emoji fallback for vehicle glyph (nucleo-isometric lacks vehicle icons per
scout). Emoji still styled with mono font for consistency.

## Key Insights

- FilterChips uses `<ToggleGroup type="single" value={filters.vehicle ?? ""}>`.
  Existing pattern (segment/diet/price/time) copies cleanly.
- ResultCard tile grid is 3 cols. Replacing "Distance" label + value keeps grid
  intact. NO layout shift.
- Emoji as icon is a violation of `no-emoji-icons` guideline, but for MVP:
  YAGNI wins over strict SVG. Add TODO comment for future SVG upgrade.
- Vehicle label uses translated text (e.g. "Xe máy"), emoji prefix as visual
  cue.

## Requirements

- FilterChips renders 4th ToggleGroup with 4 vehicle chips
- Each chip: emoji + i18n label
- Selecting a chip = set `filters.vehicle`; re-selecting same = clear
  (existing radix ToggleGroup single-mode behavior)
- ResultCard shows:
  - "ETA / {N} min" when `etaMinutes !== null`
  - "Distance / {N}km" fallback when only distance available
  - "Distance / --" when neither
- Vehicle emoji shown next to ETA value for context
- Existing "reason" line adopts vehicle-aware wording via `reason.eta` i18n key

## Related Code Files

**Modify:**
- [ui/src/components/FilterChips.tsx](../../ui/src/components/FilterChips.tsx)
- [ui/src/components/ResultCard.tsx](../../ui/src/components/ResultCard.tsx)

## Implementation Steps

### 1. FilterChips.tsx — add vehicle chips

Add to imports:
```ts
import type { Diet, PriceLevel, Segment, Vehicle, SearchFilters } from "../types";
```

Add constant:
```ts
const VEHICLE_CHIPS: { id: Vehicle; emoji: string }[] = [
  { id: "walk",      emoji: "🚶" },
  { id: "bike",      emoji: "🚲" },
  { id: "motorbike", emoji: "🛵" },
  { id: "car",       emoji: "🚗" },
];
```

Append a 5th `<ToggleGroup>` (after time chips):
```tsx
<ToggleGroup
  type="single"
  value={filters.vehicle ?? ""}
  onValueChange={(value) =>
    onChange({ ...filters, vehicle: (value || undefined) as Vehicle | undefined })
  }
  aria-label="Vehicle"
  className="shrink-0"
>
  {VEHICLE_CHIPS.map((v) => (
    <ToggleGroupItem key={v.id} value={v.id} aria-label={t(`vehicle.${v.id}`)}>
      <span aria-hidden>{v.emoji}</span>
      <span>{t(`vehicle.${v.id}`)}</span>
    </ToggleGroupItem>
  ))}
</ToggleGroup>
```

### 2. ResultCard.tsx — ETA tile

Import types (extend existing):
```ts
import type { PlaceResult, SearchFilters, Vehicle } from "../types";
```

Add vehicle emoji lookup (module-level const):
```ts
const VEHICLE_EMOJI: Record<Vehicle, string> = {
  walk: "🚶",
  bike: "🚲",
  motorbike: "🛵",
  car: "🚗",
};
```

Replace the current "Distance" tile block:
```tsx
{/* Middle tile: ETA when vehicle set, else Distance */}
<div>
  {result.etaMinutes !== null ? (
    <>
      <div className="text-[0.6rem] font-bold uppercase tracking-[0.12em] text-muted-foreground font-mono">
        {t("result.eta")}
      </div>
      <div className="mt-0.5 font-display text-sm font-bold text-foreground">
        {filters.vehicle && <span className="mr-1" aria-hidden>{VEHICLE_EMOJI[filters.vehicle]}</span>}
        {result.etaMinutes}min
      </div>
    </>
  ) : (
    <>
      <div className="text-[0.6rem] font-bold uppercase tracking-[0.12em] text-muted-foreground font-mono">
        Distance
      </div>
      <div className="mt-0.5 font-display text-sm font-bold text-foreground">
        {result.distanceMeters === null ? "--" : `${(result.distanceMeters / 1000).toFixed(1)}km`}
      </div>
    </>
  )}
</div>
```

### 3. ResultCard.tsx — reasoning line update

Extend `reasoningParts` builder inside `ResultCard`:
```ts
if (filters.vehicle && result.etaMinutes !== null) {
  reasoningParts.push(
    t("reason.eta", { min: result.etaMinutes, vehicle: t(`vehicle.${filters.vehicle}`) })
  );
}
```

Place BEFORE the existing `reasoningParts.push(t("reason.away", ...))` so the
ETA line reads first when present. If ETA present, skip the raw distance line
(avoid redundancy):
```ts
if (result.distanceMeters !== null && result.etaMinutes === null) {
  reasoningParts.push(t("reason.away", { km: (result.distanceMeters / 1000).toFixed(1) }));
}
```

## Todo

- [ ] Import `Vehicle` type in FilterChips
- [ ] Add `VEHICLE_CHIPS` constant
- [ ] Append vehicle ToggleGroup in FilterChips render
- [ ] Import `Vehicle` type in ResultCard
- [ ] Add `VEHICLE_EMOJI` lookup constant
- [ ] Replace Distance tile with ETA/Distance conditional
- [ ] Update `reasoningParts` — ETA line + skip distance-away when ETA present
- [ ] `npx tsc --noEmit` clean
- [ ] Visual: chip row on mobile still scrolls horizontally (existing `filter-rail`)
- [ ] Visual: ETA tile fits in 3-col grid without wrapping

## Success Criteria

- FilterChips shows 4 vehicle chips at the right end of the scrollable rail.
- Tap a vehicle chip → `filters.vehicle` set → `runSearch` fires (wire in Phase 04).
- ResultCard shows "ETA / 5min 🛵" when vehicle+GPS present.
- ResultCard shows "Distance / 1.2km" when vehicle unset (regression check).
- Expanded reasoning line reads "~5 min by motorbike - phù hợp gia đình - giá
  bình dân - mở tới 22:00".

## Risk Assessment

- **Chip row overflow**: adding 4 more chips to a horizontal-scroll rail is fine
  — existing `.filter-rail` mask handles it.
- **Emoji rendering variance**: 🛵 renders slightly different across OS. OK for
  MVP; SVG upgrade is a later polish.
- **`filters` prop missing on ResultCard**: already exists (used for segment/diet
  reasoning). No new prop.

## Security Considerations

None.

## Next Steps

→ [Phase 04](phase-04-app-integration-and-verify.md) — App-level state,
localStorage persist, wire through runSearch, empty-state UI for vehicleRange.
