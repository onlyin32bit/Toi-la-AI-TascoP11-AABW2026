// DTOs + error types for the Tasco Maps AI Hackathon API (v2026-06-25).
// Kept strictly aligned with resources/data/tasco_maps_hackathon_api_documentation.md
// so the client can round-trip JSON without transformation.

// ── Shared primitives ─────────────────────────────────────────────────

export interface Coordinates {
  lat: number;
  lon: number;
}

export type PlaceKind = "poi" | "address" | "road" | "category" | "coordinate";

export interface TascoPlaceResult {
  id: string;
  type: PlaceKind | string;
  name?: string;
  label?: string;
  address?: string;
  category?: string;
  coordinates: Coordinates;
  distanceMeters?: number;
  score?: number;
  source?: string;
  tags?: string[];
  // Present on POI details endpoint (see include=)
  rating?: number;
  openingHours?: string;
  aiSummary?: string;
  reviews?: unknown[];
  photos?: unknown[];
}

// ── Error envelope ────────────────────────────────────────────────────

export type TascoErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "timeout"
  | "rate_limited"
  | "internal_error"
  | "service_unavailable";

export interface TascoErrorPayload {
  code: TascoErrorCode | string;
  message: string;
  details?: Record<string, unknown>;
}

export interface TascoErrorResponse {
  error: TascoErrorPayload;
  requestId?: string;
}

// Thrown by the client on any non-2xx response or transport failure.
// Preserves the raw payload so callers can branch on the code.
export class TascoMapsApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, payload: TascoErrorResponse) {
    super(payload.error.message);
    this.name = "TascoMapsApiError";
    this.status = status;
    this.code = payload.error.code;
    this.requestId = payload.requestId;
    this.details = payload.error.details;
  }
}

// ── Search ────────────────────────────────────────────────────────────

export interface SearchParams {
  q: string;
  lat?: number;
  lon?: number;
  radiusMeters?: number;
  bbox?: string;
  category?: string;
  limit?: number;
  lang?: string;
}

export interface SearchResponse {
  query: string;
  results: TascoPlaceResult[];
  meta?: Record<string, unknown>;
}

// ── Autocomplete ──────────────────────────────────────────────────────

export interface AutocompleteParams {
  q: string;
  lat?: number;
  lon?: number;
  limit?: number;
  sessionId?: string;
  lang?: string;
}

export interface AutocompleteResponse {
  query: string;
  suggestions: TascoPlaceResult[];
  meta?: Record<string, unknown>;
}

// ── POI details ───────────────────────────────────────────────────────

export type PoiIncludeField = "reviews" | "photos" | "hours" | "ai_summary";

export interface PoiParams {
  lang?: string;
  include?: PoiIncludeField[] | string;
}

export interface PoiResponse {
  poi: TascoPlaceResult;
}

// ── Reverse geocoding ─────────────────────────────────────────────────

export interface ReverseGeocodingParams {
  lat: number;
  lon: number;
  radiusMeters?: number;
  lang?: string;
}

export interface ReverseGeocodingResponse {
  results: TascoPlaceResult[];
  meta?: Record<string, unknown>;
}

// ── Nearby search ─────────────────────────────────────────────────────

export interface NearbySearchParams {
  lat: number;
  lon: number;
  radiusMeters?: number;
  category?: string;
  openNow?: boolean;
  limit?: number;
  lang?: string;
}

export interface NearbySearchResponse {
  center: Coordinates;
  results: TascoPlaceResult[];
  meta?: Record<string, unknown>;
}

// ── Geocoding ─────────────────────────────────────────────────────────

export interface GeocodingParams {
  address: string;
  city?: string;
  district?: string;
  lat?: number;
  lon?: number;
  limit?: number;
  lang?: string;
}

export interface GeocodingResponse {
  query: string;
  results: TascoPlaceResult[];
  meta?: Record<string, unknown>;
}

// ── Route ─────────────────────────────────────────────────────────────

export type RouteMode = "auto" | "pedestrian" | "bicycle";

export interface RouteRequest {
  locations: Coordinates[];
  mode?: RouteMode;
  alternates?: number;
  language?: string;
  units?: "kilometers" | "miles";
  avoidTolls?: boolean;
  avoidHighways?: boolean;
}

export interface RouteManeuver {
  instruction: string;
  distanceMeters: number;
  durationSeconds: number;
  beginShapeIndex?: number;
  endShapeIndex?: number;
  streetNames?: string[];
}

export interface RouteSummary {
  distanceMeters: number;
  durationSeconds: number;
}

export interface RouteGeometry {
  type: "LineString";
  coordinates: [number, number][];
}

export interface TascoRoute {
  routeId: string;
  sourceIndex?: number;
  summary: RouteSummary;
  geometry: RouteGeometry;
  maneuvers?: RouteManeuver[];
}

export interface RouteResponse {
  routes: TascoRoute[];
  meta?: Record<string, unknown>;
}
