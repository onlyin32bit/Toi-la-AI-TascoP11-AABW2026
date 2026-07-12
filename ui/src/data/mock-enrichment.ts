// Hard-coded enrichment fixture used when the backend is unreachable (offline
// demo / no VITE_ENGINE_BASE_URL). Provenance badges make the "single-source"
// nature transparent to the viewer — the honesty story is "we tell you where
// every field came from", not "we refuse to show anything from one source".
import type { EnrichmentResult } from "../types";

export const DEMO_POI_ID = "poi:res001";

export const MOCK_ENRICHMENT_RESULT: EnrichmentResult = {
  poiId: DEMO_POI_ID,
  qualityBefore: 0.88,
  qualityAfter: 0.98,
  provenance: {
    menu:       { source: "tiktok",     confidence: 0.87, fetchedAt: "2026-07-12T02:30:00Z" },
    hours:      { source: "google",     confidence: 0.94, fetchedAt: "2026-07-12T02:30:01Z" },
    priceRange: { source: "foody",      confidence: 0.79, fetchedAt: "2026-07-12T02:30:02Z" },
    dietTags:   { source: "shopeefood", confidence: 0.72, fetchedAt: "2026-07-12T02:30:03Z" },
    address:    { source: "google",     confidence: 0.98, fetchedAt: "2026-07-12T02:30:04Z" },
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
