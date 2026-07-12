// Real API layer backed by the Go engine (see lib/http.ts for base URL /
// lib/api-adapters.ts for the Go JSON -> domain type mapping). Falls back to
// the local mock ranker (lib/rank.ts) on any fetch failure, so the app stays
// usable offline or when the engine isn't running — matching this project's
// offline-safe demo ethos (see README.md).
import { recommend as localRecommend, getPoi as localGetPoi } from "./lib/rank";
import { adaptCompareItem, adaptPoiDetail, adaptRecommend, type CompareRow } from "./lib/api-adapters";
import { getJSON, HttpError, postForm, postJSON } from "./lib/http";
import type {
  GoAssistantAnswer,
  GoAssistantNotFound,
  GoCompareResponse,
  GoContributeMenuResponse,
  GoNotFound,
  GoPlaceResult,
  GoPoi,
  GoRecognizeResponse,
  GoRecommendResponse,
} from "./lib/go-types";
import { isGoAssistantNotFound } from "./lib/go-types";
import type { PlaceDetail, SearchFilters, SearchResponse, UserLocation } from "./types";

// filters.time="late_night" has no direct backend equivalent (the engine's
// `time` param evaluates opening-hours at a given clock time rather than
// filtering for overnight-only venues) — approximate by querying at 00:30,
// a time only genuinely overnight places are open at.
function timeParam(filters: SearchFilters): string | undefined {
  if (filters.time === "late_night") return "00:30";
  return undefined;
}

// Backend default is 12 — force 30 so deployed engine doesn't cap us below
// the full benchmark KB (matches what the offline mock rank returns).
const RECOMMEND_LIMIT = 30;

function buildRecommendQuery(query: string, filters: SearchFilters, userLoc?: UserLocation): string {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (userLoc) {
    params.set("lat", String(userLoc.lat));
    params.set("lon", String(userLoc.lon));
  }
  if (filters.segment) params.set("segment", filters.segment);
  if (filters.diet) params.set("diet", filters.diet);
  if (filters.price) params.set("price", filters.price);
  const time = timeParam(filters);
  if (time) params.set("time", time);
  params.set("limit", String(RECOMMEND_LIMIT));
  return params.toString();
}

export async function recommend(
  query: string,
  filters: SearchFilters,
  userLoc?: UserLocation,
): Promise<SearchResponse> {
  try {
    const qs = buildRecommendQuery(query, filters, userLoc);
    const body = await getJSON<GoRecommendResponse | GoNotFound>(`/v1/recommend?${qs}`);
    return adaptRecommend(body, query, filters);
  } catch (err) {
    console.warn("[api] /v1/recommend unavailable, falling back to local mock:", err);
    return localRecommend({ query, filters, userLoc });
  }
}

export type AssistantOutcome =
  | { kind: "answer"; answer: GoAssistantAnswer }
  | { kind: "not_found"; message: string }
  | { kind: "unavailable" }
  | { kind: "error" };

export async function askAssistant(q: string): Promise<AssistantOutcome> {
  try {
    const params = new URLSearchParams({ q });
    const body = await getJSON<GoAssistantAnswer | GoAssistantNotFound>(`/v1/assistant?${params.toString()}`);
    if (isGoAssistantNotFound(body)) return { kind: "not_found", message: body.message };
    return { kind: "answer", answer: body };
  } catch (err) {
    if (err instanceof HttpError && err.status === 503) return { kind: "unavailable" };
    console.warn("[api] /v1/assistant failed:", err);
    return { kind: "error" };
  }
}

export async function getPoi(id: string): Promise<PlaceDetail | null> {
  try {
    const params = new URLSearchParams({ id });
    const poi = await getJSON<GoPoi>(`/v1/poi?${params.toString()}`);
    return adaptPoiDetail(poi);
  } catch (err) {
    console.warn("[api] /v1/poi unavailable, falling back to local mock:", err);
    return localGetPoi(id) ?? null;
  }
}

// ── UGC contribute ──────────────────────────────────────────────────────
export interface UgcSubmitInput {
  name: string;
  address?: string;
  dish?: string;
  dietTags?: string[];
  lat: number;
  lng: number;
}

// The backend contribute request has no dedicated address/dish/dietTags
// fields — fold them into `note` as free text rather than silently dropping
// what the user entered.
function composeUgcNote(input: UgcSubmitInput): string | undefined {
  const parts: string[] = [];
  if (input.address) parts.push(`Địa chỉ: ${input.address}`);
  if (input.dish) parts.push(`Món đề xuất: ${input.dish}`);
  if (input.dietTags?.length) parts.push(`Ăn kiêng: ${input.dietTags.join(", ")}`);
  return parts.length ? parts.join(" · ") : undefined;
}

/** Throws on failure — caller decides the offline-queue fallback. */
export async function contributePoi(input: UgcSubmitInput): Promise<GoPlaceResult> {
  return postJSON<GoPlaceResult>("/v1/contribute", {
    name: input.name,
    lat: input.lat,
    lon: input.lng,
    note: composeUgcNote(input),
  });
}

export async function uploadMenu(poiId: string, image: File): Promise<GoContributeMenuResponse> {
  const form = new FormData();
  form.append("poi_id", poiId);
  form.append("image", image);
  return postForm<GoContributeMenuResponse>("/v1/contribute/menu", form);
}

// ── Dish recognition ────────────────────────────────────────────────────
export async function recognizeDish(image: File, loc?: UserLocation): Promise<GoRecognizeResponse> {
  const params = new URLSearchParams();
  if (loc) {
    params.set("lat", String(loc.lat));
    params.set("lon", String(loc.lon));
  }
  const form = new FormData();
  form.append("image", image);
  const qs = params.toString();
  return postForm<GoRecognizeResponse>(`/v1/dishes/recognize${qs ? `?${qs}` : ""}`, form);
}

// ── Compare ─────────────────────────────────────────────────────────────
export interface CompareOutcome {
  items: CompareRow[];
  notFound: string[];
}

export async function compareRestaurants(ids: string[], loc?: UserLocation): Promise<CompareOutcome> {
  const params = new URLSearchParams({ ids: ids.join(",") });
  if (loc) {
    params.set("lat", String(loc.lat));
    params.set("lon", String(loc.lon));
  }
  const body = await getJSON<GoCompareResponse>(`/v1/compare?${params.toString()}`);
  return { items: body.items.map(adaptCompareItem), notFound: body.not_found };
}
