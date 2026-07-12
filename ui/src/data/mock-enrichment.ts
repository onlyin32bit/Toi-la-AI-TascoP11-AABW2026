// Honest offline fallback. It deliberately contains no invented enrichment:
// without two independent source results the UI keeps quality unchanged and
// displays no provenance badges. A recorded demo should use a persisted real
// agent run, not synthesize facts in the browser.
import type { EnrichmentResult } from "../types";

export const DEMO_POI_ID = "poi:res001";

export const MOCK_ENRICHMENT_RESULT: EnrichmentResult = {
  poiId: DEMO_POI_ID,
  qualityBefore: 0.88,
  qualityAfter: 0.88,
  provenance: {},
  menuItems: [],
};
