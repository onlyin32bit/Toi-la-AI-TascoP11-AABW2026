// Converts Go engine JSON (lib/go-types.ts) into this app's domain types
// (../types.ts). Isolated here so drift in the Go contract only needs a
// change in one place.
import type {
  Diet,
  MenuItem,
  NotFoundReason,
  Opening,
  PlaceResult,
  Poi,
  Review,
  Segment,
  SearchFilters,
  SearchResponse,
  Vehicle,
  WhyBreakdown,
} from "../types";
import { computeEtaMinutes } from "./eta";
import type {
  GoCompareItem,
  GoNotFound,
  GoPlaceResult,
  GoPoi,
  GoPoiDish,
  GoRecommendResponse,
} from "./go-types";
import { isGoNotFound } from "./go-types";

const SEGMENT_VALUES: readonly Segment[] = ["family", "romantic", "group", "fastfood", "business"];
const DIET_VALUES: readonly Diet[] = ["vegetarian", "halal"];
const PRICE_VALUES = ["budget", "mid", "premium"] as const;

function pickKnown<T extends string>(tags: string[], known: readonly T[]): T[] {
  const knownSet = new Set<string>(known);
  return tags.filter((t): t is T => knownSet.has(t));
}

// `tags` on a list-view PlaceResult flattens segments + diet + amenities +
// (ambiguously) price-tier tokens into one array with no type discriminator.
// "budget"/"premium" can come from either the price_level taxonomy OR the
// "Tiết kiệm"/"Cao cấp" segment taxonomy (both map to the same token in
// preprocess/taxonomy.py) — we can't disambiguate from tags alone, so
// priceLevel derived this way is best-effort, not authoritative. Prefer
// GoPoi.price_level (from /v1/poi?id=) whenever the real field is available.
function derivePriceLevelFromTags(tags: string[]): PlaceResult["priceLevel"] {
  const found = tags.find((t) => (PRICE_VALUES as readonly string[]).includes(t));
  return (found as PlaceResult["priceLevel"]) ?? "mid";
}

// Best-effort city extraction from a Vietnamese address string ("...,
// Quận 1, TP. Hồ Chí Minh") — the list endpoint doesn't return city directly.
function deriveCityFromAddress(address: string): string {
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : "";
}

function adaptWhy(goWhy: GoPlaceResult["meta"]["why"]): WhyBreakdown {
  return {
    semantic: goWhy.semantic,
    geoDecay: goWhy.geo_decay,
    quality: goWhy.quality,
    persona: goWhy.persona,
    ratingPop: goWhy.rating_pop,
    localness: goWhy.localness,
    luxuryPenalty: goWhy.luxury_penalty,
    final: goWhy.final,
  };
}

export function adaptPlaceResult(g: GoPlaceResult, vehicle?: Vehicle): PlaceResult {
  return {
    id: g.id,
    name: g.name,
    cuisineType: g.category,
    city: deriveCityFromAddress(g.address),
    address: g.address,
    coordinates: g.coordinates,
    distanceMeters: g.distanceMeters,
    etaMinutes: computeEtaMinutes(g.distanceMeters, vehicle),
    score: g.score,
    priceLevel: derivePriceLevelFromTags(g.tags),
    segments: pickKnown(g.tags, SEGMENT_VALUES),
    diet: pickKnown(g.tags, DIET_VALUES),
    meta: {
      why: adaptWhy(g.meta.why),
      quality: g.meta.quality,
      // list view has no numeric opening hours; "late_night" amenity tag is
      // the only signal we have for the overnight badge. closeMin unknown.
      opening: { overnight: g.tags.includes("late_night"), closeMin: 0 },
      matchedDishes: g.meta.matched_dishes.map((d) => ({ dish: d.dish, priceVnd: d.price_vnd })),
    },
  };
}

function adaptNotFoundReason(g: GoNotFound): NotFoundReason {
  return { kind: "generic", raw: g.reason, suggestions: g.suggestions };
}

export function adaptRecommend(
  body: GoRecommendResponse | GoNotFound,
  query: string,
  filters: SearchFilters,
  requestId?: string,
): SearchResponse {
  if (isGoNotFound(body)) {
    return {
      results: [],
      meta: { query, filters, count: 0, notFound: true, notFoundReason: adaptNotFoundReason(body) },
      requestId: requestId ?? "",
    };
  }
  const results = body.results.map((r) => adaptPlaceResult(r, filters.vehicle));
  return {
    results,
    meta: { query, filters, count: body.meta.count, notFound: results.length === 0 },
    requestId: body.requestId,
  };
}

function adaptDish(d: GoPoiDish, index: number, poiId: string): MenuItem {
  return {
    id: `${poiId}-dish-${index}`,
    dishName: d.name,
    category: "",
    priceVnd: d.price_vnd,
    dietaryTags: pickKnown(d.tags, [...DIET_VALUES, "gluten_free"] as const),
    isSignature: d.tags.includes("signature"),
  };
}

const SENTIMENT_MAP: Record<GoPoi["reviews"][number]["sentiment"], Review["sentiment"]> = {
  pos: "positive",
  neu: "neutral",
  neg: "negative",
};
// No per-review numeric rating in the Go payload — approximate from sentiment
// so the UI's star display has something to show. Documented, not exact.
const SENTIMENT_RATING_FALLBACK: Record<Review["sentiment"], number> = {
  positive: 5,
  neutral: 3,
  negative: 1,
};

function adaptReview(r: GoPoi["reviews"][number]): Review {
  const sentiment = SENTIMENT_MAP[r.sentiment];
  return { text: r.text, sentiment, rating: SENTIMENT_RATING_FALLBACK[sentiment], aspects: r.aspects };
}

function adaptOpening(o: GoPoi["opening"]): Opening {
  return { openMin: o.open_min, closeMin: o.close_min, overnight: o.overnight, raw: o.raw };
}

// GET /v1/poi?id= returns the rich internal record (menu/reviews/city/price
// level/segments/diet all present directly) — prefer this over the leaner
// path-form /v1/poi/{id} for the detail view, since it doesn't need any of
// the list-view's best-effort tag-derivation workarounds above.
export function adaptPoiDetail(g: GoPoi): Poi {
  return {
    id: g.id,
    restaurantId: g.restaurant_id,
    name: g.name,
    cuisineType: g.cuisine_type,
    city: g.city,
    district: g.district,
    address: g.address,
    lat: g.lat,
    lon: g.lon,
    priceLevel: g.price_level,
    avgPriceVnd: g.avg_price_vnd,
    rating: g.rating,
    reviewCount: g.review_count,
    popularity: g.popularity,
    opening: adaptOpening(g.opening),
    amenities: g.amenities,
    segments: pickKnown(g.segments, SEGMENT_VALUES),
    diet: pickKnown(g.diet, DIET_VALUES),
    strengths: g.strengths,
    weaknesses: g.weaknesses,
    quality: g.quality,
    menu: g.dishes.map((d, i) => adaptDish(d, i, g.id)),
    reviews: g.reviews.map(adaptReview),
  };
}

export interface CompareRow {
  id: string;
  name: string;
  priceLevel: string;
  avgPriceVnd: number;
  rating: number;
  quality: number;
  segments: string[];
  diet: string[];
  distanceMeters: number | null;
  topDishes: { dish: string; priceVnd: number }[];
  source: string;
  verified: boolean;
}

export function adaptCompareItem(g: GoCompareItem): CompareRow {
  return {
    id: g.id,
    name: g.name,
    priceLevel: g.price_level,
    avgPriceVnd: g.avg_price_vnd,
    rating: g.rating,
    quality: g.quality,
    segments: g.segments,
    diet: g.diet,
    distanceMeters: g.distanceMeters,
    topDishes: g.top_dishes.map((d) => ({ dish: d.dish, priceVnd: d.price_vnd })),
    source: g.source,
    verified: g.verified,
  };
}
