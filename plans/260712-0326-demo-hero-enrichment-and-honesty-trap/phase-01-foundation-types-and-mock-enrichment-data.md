---
phase: 01
priority: P0
status: done
depends_on: []
est: 30m
---

# Phase 01 — Foundation: Types + Mock Enrichment Data

## Overview

Extend `types.ts` with enrichment/provenance types. Create fixture data for `poi:res001` (Phở Bếp Nhà) with `qualityBefore=0.61` → `qualityAfter=0.90`. Build the mock stage runner and localStorage helpers.

## Key Insights

- Demo POI = `poi:res001`. Its base `quality: 0.88` is overridden to `0.61` client-side on first render (see Phase 02 App.tsx wiring).
- Stage stream: 4 phases, ~5.4s total. Timings tuned for readable pace during pitch.
- Provenance is **per-field**, not global. Each new field (menu, hours, price, diet, address) carries a source badge.
- Runner returns a cancel fn — must be called on unmount to prevent orphan timers.

## Requirements

- All new types compile with `npx tsc --noEmit` — zero errors, zero `any`.
- Mock stage runner emits typed events; consumer can render each event as a terminal line.
- localStorage helpers survive JSON roundtrip; safe if key missing.

## Related Files

**Create:**
- `ui/src/data/mock-enrichment.ts`
- `ui/src/lib/enrichment-runner.ts`
- `ui/src/lib/quality-score.ts`

**Modify:**
- `ui/src/types.ts`

## Implementation Steps

### 1. Extend `types.ts`

Append after the existing `SearchResponse` block:

```ts
export type EnrichmentSource =
  | "google"
  | "foody"
  | "tiktok"
  | "shopeefood"
  | "ugc";

export interface ProvenanceField {
  source: EnrichmentSource;
  confidence: number;   // 0-1
  fetchedAt: string;    // ISO timestamp
}

export type ProvenanceKey =
  | "menu"
  | "hours"
  | "priceRange"
  | "dietTags"
  | "photos"
  | "address";

export type ProvenanceMap = Partial<Record<ProvenanceKey, ProvenanceField>>;

export type EnrichmentStage =
  | "searching"
  | "parsing"
  | "consensus"
  | "quality-update"
  | "done";

export interface EnrichmentStageEvent {
  stage: EnrichmentStage;
  message: string;                        // human-readable terminal line
  sourcesFound?: EnrichmentSource[];
  fieldsExtracted?: ProvenanceKey[];
  consensusRate?: number;                 // 0-1
  qualityBefore?: number;
  qualityAfter?: number;
}

export interface EnrichmentResult {
  poiId: string;
  qualityBefore: number;
  qualityAfter: number;
  provenance: ProvenanceMap;
  menuItems: string[];
  hoursOpen?: string;
  priceRange?: string;
  dietTags?: string[];
}
```

Also extend `PlaceResult` (near top of interface, after `etaMinutes`):

```ts
export interface PlaceResult {
  // ...existing fields...
  qualityScore?: number;         // 0-1; if unset, falls back to meta.quality
  provenance?: ProvenanceMap;
  isEnriched?: boolean;
  enrichedMenuItems?: string[];
  enrichedHours?: string;
  enrichedPriceRange?: string;
  enrichedDietTags?: string[];
}
```

### 2. Create `lib/quality-score.ts`

```ts
export const QUALITY_THRESHOLDS = { LOW: 0.7, HIGH: 0.85 } as const;

export type QualityTier = "low" | "mid" | "high";

export function qualityTier(score: number): QualityTier {
  if (score < QUALITY_THRESHOLDS.LOW) return "low";
  if (score < QUALITY_THRESHOLDS.HIGH) return "mid";
  return "high";
}

export function qualityPercent(score: number): number {
  return Math.round(Math.max(0, Math.min(1, score)) * 100);
}
```

### 3. Create `data/mock-enrichment.ts`

```ts
import type { EnrichmentResult } from "../types";

export const DEMO_POI_ID = "poi:res001";
export const DEMO_QUALITY_BEFORE = 0.61;

export const MOCK_ENRICHMENT_RESULT: EnrichmentResult = {
  poiId: DEMO_POI_ID,
  qualityBefore: DEMO_QUALITY_BEFORE,
  qualityAfter: 0.9,
  provenance: {
    menu:       { source: "tiktok",    confidence: 0.87, fetchedAt: "2026-07-12T02:30:00Z" },
    hours:      { source: "google",    confidence: 0.94, fetchedAt: "2026-07-12T02:30:01Z" },
    priceRange: { source: "foody",     confidence: 0.79, fetchedAt: "2026-07-12T02:30:02Z" },
    dietTags:   { source: "shopeefood",confidence: 0.72, fetchedAt: "2026-07-12T02:30:03Z" },
    address:    { source: "google",    confidence: 0.98, fetchedAt: "2026-07-12T02:30:04Z" },
  },
  menuItems: [
    "Phở bò tái nạm",
    "Bún chả Hà Nội",
    "Gỏi cuốn tôm thịt",
    "Cơm tấm sườn bì chả",
    "Bánh flan caramel",
  ],
  hoursOpen: "09:00 – 23:00 (T2-CN)",
  priceRange: "70k – 120k VND",
  dietTags: ["có-món-chay", "phù-hợp-trẻ-em"],
};
```

### 4. Create `lib/enrichment-runner.ts`

```ts
import type { EnrichmentResult, EnrichmentStageEvent } from "../types";

export type StageListener = (event: EnrichmentStageEvent) => void;

interface RunOptions {
  speed?: "normal" | "fast";
}

interface Stage {
  atMs: number;
  build: (result: EnrichmentResult) => EnrichmentStageEvent;
}

const NORMAL_STAGES: Stage[] = [
  {
    atMs: 250,
    build: () => ({
      stage: "searching",
      message: "🔍 Đang quét Google Places, Foody, TikTok, ShopeeFood…",
    }),
  },
  {
    atMs: 1400,
    build: (r) => ({
      stage: "searching",
      message: `✓ Tìm thấy ${Object.keys(r.provenance).length} nguồn dữ liệu`,
      sourcesFound: Array.from(new Set(Object.values(r.provenance).map((p) => p!.source))),
    }),
  },
  {
    atMs: 2400,
    build: (r) => ({
      stage: "parsing",
      message: `📄 Trích xuất ${r.menuItems.length} mục thực đơn, giờ mở cửa, khoảng giá`,
      fieldsExtracted: Object.keys(r.provenance) as any,
    }),
  },
  {
    atMs: 3600,
    build: () => ({
      stage: "consensus",
      message: "⚖️  Đối chiếu đồng thuận: 87% xác nhận trên các nguồn",
      consensusRate: 0.87,
    }),
  },
  {
    atMs: 4600,
    build: (r) => ({
      stage: "quality-update",
      message: `⚡ Chất lượng: ${(r.qualityBefore * 100).toFixed(0)}% → ${(r.qualityAfter * 100).toFixed(0)}% ✓`,
      qualityBefore: r.qualityBefore,
      qualityAfter: r.qualityAfter,
    }),
  },
  {
    atMs: 5200,
    build: () => ({ stage: "done", message: "Hoàn tất" }),
  },
];

export function runMockEnrichment(
  result: EnrichmentResult,
  onStage: StageListener,
  opts: RunOptions = {},
): () => void {
  const speedFactor = opts.speed === "fast" ? 0.4 : 1;
  const timers: ReturnType<typeof setTimeout>[] = [];

  for (const stage of NORMAL_STAGES) {
    const t = setTimeout(() => onStage(stage.build(result)), stage.atMs * speedFactor);
    timers.push(t);
  }

  return () => timers.forEach(clearTimeout);
}

// ── localStorage persistence ────────────────────────────────────────────

const KEY_PREFIX = "tasco-enriched-";

export function saveEnriched(poiId: string, result: EnrichmentResult): void {
  try {
    localStorage.setItem(KEY_PREFIX + poiId, JSON.stringify(result));
  } catch {
    // storage full or disabled — silent
  }
}

export function loadEnriched(poiId: string): EnrichmentResult | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + poiId);
    if (!raw) return null;
    return JSON.parse(raw) as EnrichmentResult;
  } catch {
    return null;
  }
}

export function resetEnriched(poiId?: string): void {
  try {
    if (poiId) {
      localStorage.removeItem(KEY_PREFIX + poiId);
      return;
    }
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(KEY_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}
```

## Todo

- [ ] Extend `types.ts` with EnrichmentSource/ProvenanceField/ProvenanceMap/EnrichmentStageEvent/EnrichmentResult
- [ ] Extend `PlaceResult` with `qualityScore`, `provenance`, `isEnriched`, enriched fields
- [ ] Create `lib/quality-score.ts`
- [ ] Create `data/mock-enrichment.ts` with DEMO_POI_ID + MOCK_ENRICHMENT_RESULT
- [ ] Create `lib/enrichment-runner.ts` with staged emitter + persistence helpers
- [ ] Run `npx tsc --noEmit` — must exit 0

## Success Criteria

- TypeScript compiles zero errors
- Ad-hoc smoke test: `runMockEnrichment(MOCK_ENRICHMENT_RESULT, e => console.log(e))` prints 6 lines over ~5.2s
- `saveEnriched → loadEnriched → resetEnriched` roundtrip works

## Risks

- Timer leak if consumer forgets to call cancel fn → contract is documented in JSDoc + enforced in Phase 03 via `useEffect` cleanup

## Next Steps

Phase 02 adds the Enrich button, quality badge, and demo reset control on `ResultCard`.
