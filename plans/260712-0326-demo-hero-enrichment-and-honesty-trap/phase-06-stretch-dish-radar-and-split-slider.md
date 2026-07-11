---
phase: 06
priority: P2
status: skipped
depends_on: [02, 03]
tag: stretch
est: 60m
---

# Phase 06 (Stretch) — Dish Radar Scan

> **Optional polish.** Only implement if all P0 phases pass and time remains before the pitch. Cut ruthlessly if slipping.
>
> **Split-slider dropped** per locked decision in plan.md — Beat 4 uses in-place bump only.

## Part A — Dish Radar Scan

### Overview

User drops a dish photo onto the search bar (or map). A radar sweep animation expands from the user's current location. After the sweep, matching POI pins glow and highlight.

### Key Insights

- No real image recognition — mock returns a hard-coded dish name (`"phở"`, `"bún chả"`, etc.) based on filename hint OR round-robin.
- Radar = SVG circle inside a Leaflet DivOverlay (or fixed-position overlay on top of map with pointer coords translated).
- Simpler: use CSS radial gradient overlay above the map layer (`position: absolute; inset: 0; pointer-events: none;`) — no coordinate math, animates from center.

### Files

**Create:**
- `ui/src/components/DishDropZone.tsx`
- `ui/src/components/MapRadarLayer.tsx` (or inline in MapView)

**Modify:**
- `ui/src/components/SearchBar.tsx` — add drop target overlay
- `ui/src/components/MapView.tsx` — radar overlay wrapper
- `ui/src/App.tsx` — state for `radarActive`, `matchedDish`

### Steps

1. **DishDropZone** — wraps SearchBar; handles `onDragOver` / `onDrop`:
   ```tsx
   const handleDrop = (e: React.DragEvent) => {
     e.preventDefault();
     const file = e.dataTransfer.files[0];
     if (!file?.type.startsWith("image/")) return;
     const dish = mockRecognize(file.name); // returns "phở" etc.
     onRecognized(dish);
   };
   ```
2. **mockRecognize** — filename map:
   ```ts
   const map: Record<string, string> = {
     "pho": "phở", "phở": "phở",
     "bun": "bún chả", "bunchả": "bún chả",
     "banh": "bánh mì",
   };
   const key = filename.toLowerCase().replace(/[^a-z]/g, "");
   return Object.entries(map).find(([k]) => key.includes(k))?.[1] ?? "phở";
   ```
3. **Radar overlay** — mounted in MapView when `radarActive`:
   ```tsx
   {radarActive && (
     <div className="map-radar-overlay">
       <div className="map-radar-ring" />
       <div className="map-radar-ring" style={{ animationDelay: "0.3s" }} />
       <div className="map-radar-ring" style={{ animationDelay: "0.6s" }} />
     </div>
   )}
   ```
4. **CSS**:
   ```css
   .map-radar-overlay {
     position: absolute; inset: 0;
     pointer-events: none;
     display: grid; place-items: center;
     z-index: 500;
   }
   .map-radar-ring {
     width: 40px; height: 40px;
     border-radius: 50%;
     border: 2px solid #22d3ee;
     animation: radar-expand 1.8s ease-out forwards;
   }
   @keyframes radar-expand {
     0%   { transform: scale(0.5); opacity: 1; }
     100% { transform: scale(10); opacity: 0; }
   }
   ```
5. After 1.8s: clear radar, auto-fill search input with `matchedDish`, trigger search. Matching pins get a `data-matched="true"` and glow via CSS.

### Success

- Drop image on search bar → radar sweeps for 1.8s → search auto-triggers with dish name → matching pins glow
- No crashes on non-image drops
- Reduced motion: skip radar animation, jump straight to search

### Risks

- Drag-drop UX on mobile = poor → also accept file input via a hidden `<input type="file" accept="image/*" capture>` button

---

## Todo

- [ ] DishDropZone + mockRecognize
- [ ] MapRadarLayer + CSS
- [ ] Wire search trigger post-radar
- [ ] Reduced motion checks
- [ ] Manual demo test

## Risks

- Radar overlay covering map controls → z-index below map buttons, pointer-events: none
- Feature creep → **cut entirely** if P0 phases slipping

## Non-Goals

- Real image recognition (ML model)
- Real routing to matched pins
- Multi-select comparison of multiple POIs
