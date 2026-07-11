// Raw JSON shapes returned by the Go engine (engine/internal/model/types.go,
// mapsapi.go). Field names/casing verified against a live server response,
// not guessed from source alone. Kept separate from ../types.ts (the UI's
// own domain types) — lib/api-adapters.ts converts between the two.

export interface GoCoordinates {
  lat: number;
  lon: number;
}

export interface GoMatchedDish {
  dish: string;
  price_vnd: number;
}

export interface GoWhy {
  semantic: number;
  geo_decay: number;
  quality: number;
  persona: number;
  rating_pop: number;
  localness: number;
  luxury_penalty: number;
  route: number;
  crowd: number;
  behavior: number;
  buzz: number;
  final: number;
}

export interface GoPlaceResult {
  id: string;
  type: string;
  name: string;
  label: string;
  address: string;
  category: string;
  coordinates: GoCoordinates;
  distanceMeters: number | null;
  score: number;
  source: string;
  tags: string[];
  meta: {
    why: GoWhy;
    reasoning: string;
    quality: number;
    matched_dishes: GoMatchedDish[];
    verified: boolean;
  };
}

export interface GoRecommendResponse {
  results: GoPlaceResult[];
  meta: { query: string; filters: unknown; count: number };
  requestId: string;
}

export interface GoNotFound {
  status: "not_found";
  reason: string;
  suggestions: string[];
  query_entity?: string;
}

export function isGoNotFound(body: GoRecommendResponse | GoNotFound): body is GoNotFound {
  return (body as GoNotFound).status === "not_found";
}

// GET /v1/poi?id= — the rich internal record (menu, reviews, sentiment, etc.)
export interface GoPoiDish {
  name: string;
  price_vnd: number;
  tags: string[];
}

export interface GoPoiReview {
  text: string;
  sentiment: "pos" | "neu" | "neg";
  aspects: string[];
}

export interface GoPoi {
  id: string;
  restaurant_id: string;
  name: string;
  category: string;
  cuisine_type: string;
  city: string;
  district: string;
  address: string;
  lat: number;
  lon: number;
  price_level: "budget" | "mid" | "premium";
  avg_price_vnd: number;
  rating: number;
  review_count: number;
  popularity: number;
  opening: { open_min: number; close_min: number; overnight: boolean; raw: string };
  segments: string[];
  amenities: string[];
  diet: string[];
  dishes: GoPoiDish[];
  strengths: string[];
  weaknesses: string[];
  quality: number;
  reviews: GoPoiReview[];
}

// GET /v1/compare
export interface GoCompareItem {
  id: string;
  name: string;
  price_level: string;
  avg_price_vnd: number;
  rating: number;
  quality: number;
  segments: string[];
  diet: string[];
  distanceMeters: number | null;
  top_dishes: GoMatchedDish[];
  source: string;
  verified: boolean;
}

export interface GoCompareResponse {
  items: GoCompareItem[];
  not_found: string[];
  requestId: string;
}

// GET /v1/assistant
export interface GoAssistantAnswer {
  answer: string;
  sources: { field: string; source: string }[];
  poi_id?: string;
}

export interface GoAssistantNotFound {
  answer: "not_found";
  message: string;
}

// `answer` is a plain `string` on GoAssistantAnswer, so an `answer ===
// "not_found"` check alone doesn't let TS exclude it (a wide string type can
// hold that literal too) — discriminate on the `message` field instead,
// which only exists on the not-found shape.
export function isGoAssistantNotFound(
  body: GoAssistantAnswer | GoAssistantNotFound,
): body is GoAssistantNotFound {
  return "message" in body;
}

// POST /v1/dishes/recognize
export interface GoRecognizeResponse {
  recognized: { dish_name: string; cuisine: string; confidence: number; alternatives: string[] };
  matches: { restaurant_id: string; dish: string; price_vnd: number; distanceMeters?: number }[];
}

// POST /v1/contribute/menu
export interface GoContributeMenuResponse {
  poi_id: string;
  dishes: GoPoiDish[];
  needs_confirm: true;
}

// GET /v1/autocomplete
export interface GoAutocompleteResponse {
  query: string;
  suggestions: GoPlaceResult[];
  meta: { limit: number; sessionId?: string };
}

export interface GoErrorResponse {
  error: { code: string; message: string; details?: unknown };
  requestId: string;
}
