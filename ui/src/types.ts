// Domain types mirroring the /v1/recommend contract in PLAN.md §8, so swapping
// the mock-backed api.ts for a real fetch() later requires no type changes.

// Matches the `segment` query param enum in PLAN.md §8 exactly
// (family|romantic|business|group|fastfood) — this is the filterable
// vocabulary. Other free-text segment hints from the dataset (e.g. "Du lịch",
// "Tiết kiệm", "Cao cấp") aren't filter dimensions here: "Tiết kiệm"/"Cao cấp"
// already map to the `price` filter, and "Du lịch" has no dedicated filter,
// so both surface only as read-only tags on the result card.
export type Segment = "family" | "romantic" | "group" | "fastfood" | "business";

export type Diet = "vegetarian" | "halal";

export type PriceLevel = "budget" | "mid" | "premium";

export type Vehicle = "walk" | "bike" | "motorbike" | "car";

export interface Opening {
  openMin: number;
  closeMin: number;
  overnight: boolean;
  raw: string;
}

export interface MenuItem {
  id: string;
  dishName: string;
  category: string;
  priceVnd: number;
  dietaryTags: string[];
  isSignature: boolean;
}

export interface Review {
  text: string;
  sentiment: "positive" | "neutral" | "negative";
  rating: number;
  aspects: string[];
}

// Internal knowledge-base shape (one entry per restaurant), used by lib/rank.ts.
export interface Poi {
  id: string; // "poi:res001"
  restaurantId: string; // "RES001"
  name: string;
  cuisineType: string;
  city: string;
  district: string;
  address: string;
  lat: number;
  lon: number;
  priceLevel: PriceLevel;
  avgPriceVnd: number;
  rating: number;
  reviewCount: number;
  popularity: number;
  opening: Opening;
  amenities: string[];
  segments: Segment[];
  diet: Diet[];
  strengths: string[];
  weaknesses: string[];
  quality: number;
  menu: MenuItem[];
  reviews: Review[];
}

export interface WhyBreakdown {
  semantic: number;
  geoDecay: number | null;
  quality: number;
  persona: number;
  ratingPop: number;
  localness: number;
  luxuryPenalty: number;
  final: number;
}

// Response shape for a single result in /v1/recommend (PLAN.md §8).
// Display strings (tags, reasoning) are intentionally NOT baked in here — the
// ranking layer stays language-neutral and returns structured facts
// (priceLevel/segments/diet/opening), which the UI localizes via i18n. This
// keeps the "swap in a real backend later" seam clean and lets the whole app
// re-render on a language toggle without re-running the search.
export interface PlaceResult {
  id: string;
  name: string;
  cuisineType: string;
  city: string;
  address: string;
  coordinates: { lat: number; lon: number };
  distanceMeters: number | null;
  // Estimated travel time in minutes for the current vehicle. null when no
  // userLoc or no filters.vehicle is set — UI falls back to distance display.
  etaMinutes: number | null;
  score: number;
  priceLevel: PriceLevel;
  segments: Segment[];
  diet: Diet[];
  meta: {
    why: WhyBreakdown;
    quality: number;
    opening: { overnight: boolean; closeMin: number };
    matchedDishes: { dish: string; priceVnd: number }[];
  };
  // Enrichment fields — only populated after the demo enrichment agent runs
  // for a POI. qualityScore overrides meta.quality when present so the badge
  // can display the enriched value without touching the ranker's numbers.
  qualityScore?: number;
  provenance?: ProvenanceMap;
  isEnriched?: boolean;
  enrichedMenuItems?: string[];
  enrichedHours?: string;
  enrichedPriceRange?: string;
  enrichedDietTags?: string[];
}

// ── Enrichment agent types ────────────────────────────────────────────
// Agent trace/result types shared by the live path and honest offline refusal.

export type EnrichmentSource =
  | "google"
  | "foody"
  | "tiktok"
  | "shopeefood"
  | "ugc";

export interface ProvenanceField {
  source: EnrichmentSource;
  confidence: number;
  fetchedAt: string;
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
  message: string;
  sourcesFound?: EnrichmentSource[];
  fieldsExtracted?: ProvenanceKey[];
  consensusRate?: number;
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

// Structured reason for an empty result set, localized in the UI. Preserves the
// eval traps (dish-not-found, diet-in-wrong-city) without baking in a language.
export interface NotFoundReason {
  kind: "dish" | "dietCity" | "segment" | "vehicleRange" | "generic";
  dish?: string;
  diet?: Diet;
  city?: string;
  segment?: Segment;
  // Set when kind === "vehicleRange" — user picked a vehicle whose hard-cap
  // filtered every candidate away.
  vehicle?: Vehicle;
  // Real backend's own localized reason (e.g. "Không có quán Halal ở TP. Hồ
  // Chí Minh") and relaxation suggestions — present only for kind === "generic"
  // results that came from the live engine rather than the mock ranker.
  raw?: string;
  suggestions?: string[];
}

export interface SearchFilters {
  segment?: Segment;
  diet?: Diet;
  price?: PriceLevel;
  time?: "now" | "late_night";
  vehicle?: Vehicle;
}

export interface UserLocation {
  lat: number;
  lon: number;
}

export interface SearchResponse {
  results: PlaceResult[];
  meta: {
    query: string;
    filters: SearchFilters;
    count: number;
    notFound: boolean;
    notFoundReason?: NotFoundReason;
  };
  requestId: string;
}

export type PlaceDetail = Poi;
