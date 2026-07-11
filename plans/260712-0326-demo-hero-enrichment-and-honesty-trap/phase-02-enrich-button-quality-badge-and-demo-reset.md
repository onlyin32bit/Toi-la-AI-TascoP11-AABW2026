---
phase: 02
priority: P0
status: done
depends_on: [01]
est: 45m
---

# Phase 02 — Enrich Button + Quality Score Badge + Demo Reset

## Overview

Add three surfaces to `ResultCard`:
1. **QualityScoreBadge** — always visible, colored by tier
2. **Enrich button** — pulsing CTA when quality low + not enriched
3. **DemoResetButton** — small floating icon, clears mock state

App.tsx handles enrichment lifecycle and applies the mock result to the results array.

## Key Insights

- Demo POI (`poi:res001`) is force-downgraded to `0.61` on client-side hydration so the pitch always starts from the "before" state on first load.
- Once enriched, the badge count-ups from 61 → 90 with an 800ms cubic-out ease; ring turns green.
- Button uses the existing glass/liquid look consistent with command deck. Pulse animation invites the click.
- Reset button lives bottom-left, always visible when there's persisted mock state.

## Requirements

- No layout shift when badge tier changes (fixed width).
- Enrich button hidden if `qualityScore >= HIGH` OR `isEnriched === true`.
- Reset clears both `tasco-enriched-*` and `tasco-ugc-queue`, then reloads.
- Works with existing card mouse-tracking radial glow.

## Related Files

**Create:**
- `ui/src/components/QualityScoreBadge.tsx`
- `ui/src/components/DemoResetButton.tsx`

**Modify:**
- `ui/src/components/ResultCard.tsx`
- `ui/src/App.tsx`
- `ui/src/App.css`
- `ui/src/i18n/translations.ts`

## Implementation Steps

### 1. `QualityScoreBadge.tsx`

```tsx
import { useEffect, useState } from "react";
import { qualityPercent, qualityTier } from "../lib/quality-score";

interface Props {
  score: number;
  targetScore?: number;       // if set, animates from `score` up to `targetScore`
  size?: "sm" | "md";
  label?: string;             // e.g. "CHẤT LƯỢNG"
}

export function QualityScoreBadge({ score, targetScore, size = "md", label }: Props) {
  const [displayScore, setDisplayScore] = useState(score);

  useEffect(() => {
    if (targetScore === undefined || targetScore === score) {
      setDisplayScore(score);
      return;
    }
    const start = score;
    const end = targetScore;
    const duration = 900;
    const startAt = performance.now();
    let rafId = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - startAt) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayScore(start + (end - start) * eased);
      if (t < 1) rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [score, targetScore]);

  const tier = qualityTier(displayScore);
  const pct = qualityPercent(displayScore);
  const animating = targetScore !== undefined && targetScore !== score;

  return (
    <span
      className="quality-badge"
      data-tier={tier}
      data-size={size}
      data-animating={animating || undefined}
      aria-label={`${label ?? "Quality"} ${pct}%`}
    >
      <span className="quality-badge-dot" />
      <span className="quality-badge-value">{pct}%</span>
      {label && <span className="quality-badge-label">{label}</span>}
    </span>
  );
}
```

### 2. `DemoResetButton.tsx`

```tsx
import { resetEnriched } from "../lib/enrichment-runner";
import { clearUgc } from "../lib/ugc-queue";

interface Props {
  onReset: () => void;
}

export function DemoResetButton({ onReset }: Props) {
  const handleClick = () => {
    if (!confirm("Reset demo state?")) return;
    resetEnriched();
    clearUgc();
    onReset();
  };

  return (
    <button
      type="button"
      className="demo-reset-btn"
      onClick={handleClick}
      title="Reset demo state"
      aria-label="Reset demo state"
    >
      ↺
    </button>
  );
}
```

*(Note: `clearUgc` is created in Phase 05 — Phase 02 can start with just `resetEnriched()` and add `clearUgc()` when Phase 05 lands. Or add a `try/catch` around the import.)*

### 3. `ResultCard.tsx` modifications

- Import `QualityScoreBadge`.
- In card header row, add badge (fallback to `result.meta.quality` if `qualityScore` unset).
- After card body, before or after reasoning line, add Enrich button when:
  - `result.id === DEMO_POI_ID` AND `!result.isEnriched`
  - **(Locked decision: only the demo POI gets the button — see plan.md "Locked Decisions")**
- Button props:
  ```tsx
  <button
    type="button"
    className="enrich-btn"
    onClick={() => onEnrich(result.id)}
    disabled={enrichingId === result.id}
  >
    <span className="enrich-btn-sparkle">✨</span>
    <span>{t("enrich.button")}</span>
  </button>
  ```
- Pass `onEnrich` and `enrichingId` as new props.

### 4. `App.tsx` state + handlers

```ts
// New state
const [enrichingId, setEnrichingId] = useState<string | null>(null);
const [terminalOpen, setTerminalOpen] = useState(false);
const [animatingScores, setAnimatingScores] = useState<Record<string, number>>({});

// Force demo POI to low quality on first load
useEffect(() => {
  setResults(prev => prev.map(r =>
    r.id === DEMO_POI_ID && !loadEnriched(r.id)
      ? { ...r, qualityScore: DEMO_QUALITY_BEFORE }
      : r
  ));
  // apply persisted enrichment on hydration
  setResults(prev => prev.map(r => {
    const saved = loadEnriched(r.id);
    return saved ? applyEnrichment(r, saved) : r;
  }));
}, []);

const handleEnrich = (id: string) => {
  setEnrichingId(id);
  setTerminalOpen(true);
};

const handleEnrichComplete = (id: string, res: EnrichmentResult) => {
  saveEnriched(id, res);
  setResults(prev => prev.map(r => r.id === id ? applyEnrichment(r, res) : r));
  setAnimatingScores(a => ({ ...a, [id]: res.qualityAfter }));
  setTimeout(() => setAnimatingScores(a => {
    const { [id]: _, ...rest } = a;
    return rest;
  }), 1200);
};

function applyEnrichment(r: PlaceResult, res: EnrichmentResult): PlaceResult {
  return {
    ...r,
    qualityScore: res.qualityAfter,
    provenance: res.provenance,
    isEnriched: true,
    enrichedMenuItems: res.menuItems,
    enrichedHours: res.hoursOpen,
    enrichedPriceRange: res.priceRange,
    enrichedDietTags: res.dietTags,
  };
}
```

Also render `<DemoResetButton onReset={() => window.location.reload()} />` at app root when `results.some(r => r.isEnriched) || ugcPins.length > 0`.

### 5. CSS (`App.css`)

```css
:root {
  --score-low: #f97316;
  --score-mid: #eab308;
  --score-high: #10b981;
}

/* Quality badge */
.quality-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.04em;
  background: color-mix(in srgb, var(--tier-color) 12%, transparent);
  color: var(--tier-color);
  border: 1px solid color-mix(in srgb, var(--tier-color) 35%, transparent);
  transition: background 300ms ease, color 300ms ease, border-color 300ms ease;
}
.quality-badge[data-tier="low"]  { --tier-color: var(--score-low); }
.quality-badge[data-tier="mid"]  { --tier-color: var(--score-mid); }
.quality-badge[data-tier="high"] { --tier-color: var(--score-high); }
.quality-badge-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--tier-color);
  box-shadow: 0 0 6px var(--tier-color);
}
.quality-badge[data-animating] .quality-badge-dot {
  animation: quality-pulse 1s ease-in-out infinite;
}
@keyframes quality-pulse {
  0%,100% { box-shadow: 0 0 6px var(--tier-color); }
  50%     { box-shadow: 0 0 14px var(--tier-color); }
}

/* Enrich button */
.enrich-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px;
  border-radius: 10px;
  font-weight: 800;
  font-size: 12px;
  letter-spacing: 0.05em;
  background: linear-gradient(135deg,
    color-mix(in srgb, var(--score-high) 30%, transparent),
    color-mix(in srgb, #22d3ee 25%, transparent));
  border: 1px solid color-mix(in srgb, var(--score-high) 50%, transparent);
  color: color-mix(in srgb, var(--score-high) 90%, white);
  cursor: pointer;
  animation: enrich-pulse 2.4s ease-in-out infinite;
}
.enrich-btn:hover { transform: translateY(-1px); }
.enrich-btn:disabled { opacity: 0.6; cursor: default; animation: none; }
.enrich-btn-sparkle { animation: sparkle-spin 3s linear infinite; }
@keyframes enrich-pulse {
  0%,100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--score-high) 45%, transparent); }
  50%     { box-shadow: 0 0 20px 4px color-mix(in srgb, var(--score-high) 30%, transparent); }
}
@keyframes sparkle-spin { to { transform: rotate(360deg); } }

/* Demo reset */
.demo-reset-btn {
  position: fixed; bottom: 12px; left: 12px; z-index: 700;
  width: 36px; height: 36px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--color-card) 85%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-border) 60%, transparent);
  color: var(--color-muted-foreground);
  font-size: 18px; cursor: pointer;
  backdrop-filter: blur(8px);
}
.demo-reset-btn:hover { color: var(--color-foreground); }

@media (prefers-reduced-motion: reduce) {
  .enrich-btn, .quality-badge-dot { animation: none; }
}
```

### 6. i18n additions

```ts
// VI
"enrich.button": "✨ Làm giàu",
"enrich.tooltip": "Tự động điền thông tin còn thiếu",
"quality.label": "CHẤT LƯỢNG",
"demo.reset": "Reset demo",
// EN
"enrich.button": "✨ Enrich",
"enrich.tooltip": "Auto-fill missing info",
"quality.label": "QUALITY",
"demo.reset": "Reset demo",
```

## Todo

- [ ] Create `QualityScoreBadge.tsx`
- [ ] Create `DemoResetButton.tsx`
- [ ] Modify `ResultCard.tsx` — badge + Enrich button
- [ ] Modify `App.tsx` — state, handlers, force downgrade of demo POI, apply enrichment fn
- [ ] Add CSS for badge / button / reset
- [ ] Add i18n strings
- [ ] Verify: demo POI shows 61% on first load; button pulses; click sets `enrichingId`; badge target updates after complete

## Success Criteria

- Demo POI loads with orange `● 61%` badge and pulsing Enrich button
- Click Enrich → button disables, `terminalOpen` = true (Phase 03 completes the visual)
- After `handleEnrichComplete`: badge count-ups to green `● 90%`, Enrich button hidden
- Reload page → persisted enrichment restored
- DemoResetButton (bottom-left) → confirm → reload → back to 61% state

## Risks

- `applyEnrichment` mutating vs replacing → use spread to keep referentially fresh objects
- `enrichingId` race if user clicks another card mid-enrichment → disable other Enrich buttons while active

## Next Steps

Phase 03 builds the Agent Terminal Panel that displays the mock stream.
