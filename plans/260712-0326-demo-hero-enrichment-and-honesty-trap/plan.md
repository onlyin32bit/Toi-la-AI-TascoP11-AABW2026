---
status: in_progress
created: 2026-07-12
mode: auto
scope: ui-only
---

# Demo Hero: AI Enrichment Agent + Honesty Trap (UI Only)

60-second pitch storyline. **No backend changes** — entire enrichment stream is mocked in front-end (timed setTimeout stages, hard-coded fixture, localStorage persistence).

## Storyline (60s)

| Beat | Time | On-screen |
|------|------|-----------|
| 1. Goal | 0-10s | POI card with `Quality: 61%` badge (orange), missing menu/hours |
| 2. Trigger | 10-20s | User clicks pulsing `✨ Enrich` button → Agent Terminal opens |
| 3. Agent Acts | 20-45s | Cyan neon terminal streams: `SEARCHING → PARSING → CONSENSUS → QUALITY_UPDATE` |
| 4. Outcome | 45-55s | Card fields fill in with provenance badges (Google/Foody/TikTok), quality bumps 61 → 90 with green glow |
| 5. Proof | 55-60s | Trap query in assistant → "Không tìm thấy" → pulsing UGC chip → contribution form → purple pending pin on map |

## Phases

| # | Title | Priority | Status | Est |
|---|-------|----------|--------|-----|
| 01 | Foundation — Types + Mock Enrichment Data | P0 | done | 30m |
| 02 | Enrich Button + Quality Score Badge + Demo Reset | P0 | done | 45m |
| 03 | Agent Terminal Panel (Cyberpunk typing effect) | P0 | done | 90m |
| 04 | Provenance Badges + Field Attribution Reveal | P0 | done | 45m |
| 05 | Honesty Trap → UGC Contribution Flow | P0 | done | 60m |
| 06 | Stretch — Dish Radar Scan | P2 | skipped | 60m |

**Core (P0):** ~4h 30m — **With stretch:** ~5h 30m

## Files (UI only)

**New:**
- `ui/src/types.ts` (extend) — `EnrichmentSource`, `ProvenanceField`, `ProvenanceMap`, `EnrichmentStageEvent`, `EnrichmentResult`
- `ui/src/data/mock-enrichment.ts` — hard-coded fixture (menu items, hours, provenance map)
- `ui/src/lib/enrichment-runner.ts` — staged event emitter + localStorage persistence
- `ui/src/lib/quality-score.ts` — tier thresholds + color helpers
- `ui/src/lib/ugc-queue.ts` — mock UGC storage
- `ui/src/components/EnrichmentTerminal.tsx`
- `ui/src/components/QualityScoreBadge.tsx`
- `ui/src/components/ProvenanceBadge.tsx`
- `ui/src/components/source-icons.tsx` — inline SVGs (Google, Foody, TikTok, ShopeeFood, UGC)
- `ui/src/components/UgcSuggestChip.tsx`
- `ui/src/components/UgcContributeForm.tsx`
- `ui/src/components/DemoResetButton.tsx`

**Modify:**
- `ui/src/components/ResultCard.tsx` — Enrich button, quality badge, provenance-tagged detail fields
- `ui/src/components/AssistantBox.tsx` — inject UGC chip on not-found reply
- `ui/src/components/MapView.tsx` — UGC pending pins layer
- `ui/src/App.tsx` — enrichment / UGC state wiring, apply mock enrichment to results
- `ui/src/App.css` — terminal neon, badge pulse, provenance stagger, UGC pin, chip pulse
- `ui/src/i18n/translations.ts` — new strings (~15 keys VI+EN)

**Demo POI:** `poi:res001` (Phở Bếp Nhà) — override its `quality` to 0.61 client-side for the demo, mock enrichment brings it to 0.90.

## Locked Decisions (from validation Q&A)

1. **Enrich scope:** Only the demo POI (`poi:res001`) shows the Enrich button. All other POIs render normally without the button — keeps the pitch focused, avoids visual clutter. In `ResultCard.tsx`, gate the button on `result.id === DEMO_POI_ID`, not on quality threshold.
2. **Terminal aesthetic:** Cyan neon (#22d3ee) + JetBrains Mono, dark navy panel. Already spec'd in Phase 03.
3. **Outcome visual:** In-place count-up on the card + staggered field fade-in with provenance badges. No split-slider — Phase 06 stretch drops Part B.
4. **Dish Radar Scan:** P2 stretch. Skip unless P0 phases finish with time to spare.

## Constraints

- UI only. Zero Go backend changes.
- No new dependencies (React 19 + Radix + Leaflet + Tailwind stack unchanged).
- Icons: inline SVG for brand logos; keep emoji fallback pattern for utility icons.
- Persist mock state in `localStorage`:
  - `tasco-enriched-{poiId}` — enriched fixture
  - `tasco-ugc-queue` — UGC entries
- Respect `prefers-reduced-motion` throughout (no glow pulses, instant reveals).
- Demo reset button clears both keys → repeatable pitch.

## Success Criteria

- Demo runs end-to-end in a browser, no server needed
- 60s script hits every beat with visible transitions (verified in Chrome + mobile viewport)
- Reset control returns app to pre-enrichment state
- Honesty Trap → UGC modal → pending pin reaches map in ≤2 clicks
- TypeScript compiles clean (`npx tsc --noEmit`)
- No console errors or warnings on the demo path

## Non-Goals

- Real enrichment agent (no scraping, no LLM calls)
- Real UGC persistence beyond localStorage
- Real dish image recognition
- Backend integration
- Auth on UGC submissions

## Phase Dependencies

```
01 ── 02 ── 03 ── 04
         └── 05
         └── 06 (stretch)
```

Phase 05 depends only on 01 (types) — can run in parallel with 03/04 if implementer wants.
