// Client-side stand-in for the future /v1/recommend backend. Implements the
// HARD-gate → SOFT-score algorithm from PLAN.md §7 exactly, so swapping this
// out for a real backend later changes nothing about observed ranking
// behavior. Operates over the fixture POIs in data/mockPlaces.ts.
import { mockPlaces } from "../data/mockPlaces";
import type {
  Poi,
  PlaceResult,
  NotFoundReason,
  SearchFilters,
  SearchResponse,
  UserLocation,
  WhyBreakdown,
} from "../types";
import { VEHICLE_PROFILES, DEFAULT_HALF_LIFE_KM, computeEtaMinutes } from "./eta";

function stripDiacritics(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

function norm(s: string): string {
  return stripDiacritics(s).toLowerCase().trim();
}

function tokenize(s: string): string[] {
  return norm(s)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function haversineMeters(a: UserLocation, b: { lat: number; lon: number }): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function isOpenAt(poi: Poi, minuteOfDay: number): boolean {
  const { openMin, closeMin, overnight } = poi.opening;
  return overnight ? minuteOfDay >= openMin || minuteOfDay <= closeMin : minuteOfDay >= openMin && minuteOfDay <= closeMin;
}

const CITY_ALIASES: Record<string, string> = {
  "ha noi": "Hà Nội",
  hanoi: "Hà Nội",
  "tp hcm": "TP. Hồ Chí Minh",
  "tp. hcm": "TP. Hồ Chí Minh",
  hcm: "TP. Hồ Chí Minh",
  "sai gon": "TP. Hồ Chí Minh",
  "ho chi minh": "TP. Hồ Chí Minh",
  "da nang": "Đà Nẵng",
  "nha trang": "Nha Trang",
  "ha long": "Hạ Long",
  "da lat": "Đà Lạt",
  hue: "Huế",
};

function detectCity(query: string): string | null {
  const q = norm(query);
  if (!q) return null;
  for (const [alias, city] of Object.entries(CITY_ALIASES)) {
    if (q.includes(alias)) return city;
  }
  return null;
}

function allDishNames(): string[] {
  const names = new Set<string>();
  for (const poi of mockPlaces) for (const item of poi.menu) names.add(item.dishName);
  return [...names];
}

function detectDish(query: string): string | null {
  const q = norm(query);
  if (!q) return null;
  let best: string | null = null;
  for (const dish of allDishNames()) {
    if (q.includes(norm(dish)) && (!best || dish.length > best.length)) best = dish;
  }
  return best;
}

// Structured (language-neutral) reason for an empty result set; the UI
// localizes it. Priority mirrors the old suggestion string's ordering, with
// vehicleRange slotted before the generic fallback so the user learns their
// vehicle pick was the culprit (only when a userLoc was available to filter).
function buildNotFoundReason(
  filters: SearchFilters,
  city: string | null,
  dish: string | null,
  hasUserLoc: boolean,
): NotFoundReason {
  if (dish) return { kind: "dish", dish };
  if (filters.diet && city) return { kind: "dietCity", diet: filters.diet, city };
  if (filters.segment) return { kind: "segment", segment: filters.segment };
  if (filters.vehicle && hasUserLoc) return { kind: "vehicleRange", vehicle: filters.vehicle };
  return { kind: "generic" };
}

function scorePoi(
  poi: Poi,
  queryTokens: string[],
  filters: SearchFilters,
  userLoc: UserLocation | undefined,
): PlaceResult {
  // semantic: token overlap between the query and (name + dish names + strengths)
  const haystack = tokenize([poi.name, ...poi.menu.map((m) => m.dishName), ...poi.strengths].join(" "));
  const haystackSet = new Set(haystack);
  const semantic =
    queryTokens.length === 0
      ? 0.5
      : queryTokens.filter((t) => haystackSet.has(t)).length / queryTokens.length;

  let distanceMeters: number | null = null;
  let geoDecay: number | null = null;
  let etaMinutes: number | null = null;
  if (userLoc) {
    distanceMeters = Math.round(haversineMeters(userLoc, poi));
    const halfLifeKm = filters.vehicle
      ? VEHICLE_PROFILES[filters.vehicle].halfLifeKm
      : DEFAULT_HALF_LIFE_KM;
    geoDecay = Math.exp(-(distanceMeters / 1000) / halfLifeKm);
    etaMinutes = computeEtaMinutes(distanceMeters, filters.vehicle);
  }

  const quality = poi.quality;
  // Persona: the HARD gate already guarantees any explicitly-requested
  // segment/diet/price matches, so persona reflects "was a preference stated
  // and satisfied" rather than re-deriving a match fraction.
  const persona = filters.segment || filters.diet || filters.price ? 1 : 0.6;
  const ratingPop = (poi.rating / 5 + poi.popularity / 100) / 2;
  const localness = poi.priceLevel === "budget" && poi.quality >= 0.9 ? 1 : 0;
  const luxuryPenalty = poi.priceLevel === "premium" ? 1 : 0;

  // Missing-signal renormalization (PLAN.md §7.2): drop geo_decay's weight
  // entirely when there's no user location, rescale the rest — never
  // zero-fill a factor we don't have data for.
  const baseWeights = { semantic: 0.3, geo: 0.2, quality: 0.15, persona: 0.15, ratingPop: 0.1, localness: 0.1 };
  const presentWeightSum = geoDecay === null ? 1 - baseWeights.geo : 1;
  const scale = 1 / presentWeightSum;

  const weighted =
    baseWeights.semantic * scale * semantic +
    (geoDecay === null ? 0 : baseWeights.geo * scale * geoDecay) +
    baseWeights.quality * scale * quality +
    baseWeights.persona * scale * persona +
    baseWeights.ratingPop * scale * ratingPop +
    baseWeights.localness * scale * localness;

  const final = Math.max(0, Math.min(1, weighted - 0.25 * luxuryPenalty));

  const why: WhyBreakdown = {
    semantic: round2(semantic),
    geoDecay: geoDecay === null ? null : round2(geoDecay),
    quality: round2(quality),
    persona: round2(persona),
    ratingPop: round2(ratingPop),
    localness: round2(localness),
    luxuryPenalty: round2(luxuryPenalty),
    final: round2(final),
  };

  const matchedDishes = poi.menu
    .filter((m) => queryTokens.length > 0 && tokenize(m.dishName).some((t) => queryTokens.includes(t)))
    .slice(0, 3)
    .map((m) => ({ dish: m.dishName, priceVnd: m.priceVnd }));

  return {
    id: poi.id,
    name: poi.name,
    cuisineType: poi.cuisineType,
    city: poi.city,
    address: poi.address,
    coordinates: { lat: poi.lat, lon: poi.lon },
    distanceMeters,
    etaMinutes,
    score: why.final,
    priceLevel: poi.priceLevel,
    segments: poi.segments,
    diet: poi.diet,
    meta: {
      why,
      quality: poi.quality,
      opening: { overnight: poi.opening.overnight, closeMin: poi.opening.closeMin },
      matchedDishes,
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface RecommendParams {
  query?: string;
  filters: SearchFilters;
  userLoc?: UserLocation;
  /** Minute-of-day override for the "time=now" filter; defaults to the real current time. */
  nowMinute?: number;
}

export function recommend(params: RecommendParams): SearchResponse {
  const { query = "", filters, userLoc } = params;
  const nowMinute = params.nowMinute ?? new Date().getHours() * 60 + new Date().getMinutes();
  const requestedCity = detectCity(query);
  const requestedDish = detectDish(query);

  const candidates = mockPlaces.filter((poi) => {
    if (requestedCity && poi.city !== requestedCity) return false;
    if (requestedDish && !poi.menu.some((m) => m.dishName === requestedDish)) return false;
    if (filters.diet && !poi.diet.includes(filters.diet)) return false;
    if (filters.price && poi.priceLevel !== filters.price) return false;
    if (filters.segment && !poi.segments.includes(filters.segment)) return false;
    if (filters.time === "late_night" && !poi.opening.overnight) return false;
    if (filters.time === "now" && !isOpenAt(poi, nowMinute)) return false;
    // Lenient vehicle range gate — only meaningful with a userLoc.
    if (filters.vehicle && userLoc) {
      const distKm = haversineMeters(userLoc, poi) / 1000;
      if (distKm > VEHICLE_PROFILES[filters.vehicle].hardCapKm) return false;
    }
    return true;
  });

  const requestId = `mock-${Date.now().toString(36)}`;

  if (candidates.length === 0) {
    return {
      results: [],
      meta: {
        query,
        filters,
        count: 0,
        notFound: true,
        notFoundReason: buildNotFoundReason(filters, requestedCity, requestedDish, Boolean(userLoc)),
      },
      requestId,
    };
  }

  const queryTokens = tokenize(query);
  const results = candidates
    .map((poi) => scorePoi(poi, queryTokens, filters, userLoc))
    .sort((a, b) => b.score - a.score);

  return {
    results,
    meta: { query, filters, count: results.length, notFound: false },
    requestId,
  };
}

export function getPoi(id: string): Poi | undefined {
  return mockPlaces.find((p) => p.id === id || p.restaurantId === id);
}
