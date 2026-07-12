// HTTP client for the Tasco Maps AI Hackathon API.
//
// Base URL resolution (first hit wins):
//   1. `config.baseUrl` passed to the factory
//   2. `import.meta.env.VITE_TASCO_MAPS_BASE_URL` at build time
//   3. Default: mock server at `http://localhost:8787`
//
// Auth (optional, all pluggable):
//   - `config.bearerToken` → `Authorization: Bearer <token>`
//   - `config.apiKey`      → `X-API-Key: <key>`
//   - `config.headerProvider` → async function returning extra headers per call
//                                (use for dynamic tokens fetched from an auth SDK)
//
// Common headers are attached automatically:
//   - X-Request-Id (crypto.randomUUID or timestamp fallback)
//   - X-Locale (default `vi-VN`)
//   - X-Timezone (browser TZ or `Asia/Ho_Chi_Minh`)
//
// Errors: any non-2xx surfaces as a `TascoMapsApiError` carrying the parsed
// `TascoErrorResponse` payload. Network failures also throw the same class
// with `status = 0` and code `internal_error` for a single catch site.
import type {
  AutocompleteParams,
  AutocompleteResponse,
  GeocodingParams,
  GeocodingResponse,
  NearbySearchParams,
  NearbySearchResponse,
  PoiParams,
  PoiResponse,
  ReverseGeocodingParams,
  ReverseGeocodingResponse,
  RouteRequest,
  RouteResponse,
  SearchParams,
  SearchResponse,
  TascoErrorResponse,
} from "./tasco-maps-types";
import { TascoMapsApiError } from "./tasco-maps-types";

// ── Config ────────────────────────────────────────────────────────────

export interface TascoMapsClientConfig {
  /** Overrides env + default. Prefer this at construction time. */
  baseUrl?: string;
  /** Sent as `Authorization: Bearer …`. */
  bearerToken?: string;
  /** Sent as `X-API-Key: …`. Combine with bearerToken only if the backend
   *  supports it — most treat them as alternatives. */
  apiKey?: string;
  /** Default `vi-VN`. */
  locale?: string;
  /** Default: browser TZ, else `Asia/Ho_Chi_Minh`. */
  timezone?: string;
  /** Async provider for extra headers per request (dynamic tokens etc.). */
  headerProvider?: () => Promise<Record<string, string>> | Record<string, string>;
  /** Custom fetch (SSR, tests, retry wrappers). Defaults to global `fetch`. */
  fetchFn?: typeof fetch;
  /** Default request timeout in ms. Default 15000. Pass 0 to disable. */
  timeoutMs?: number;
}

// Relative (same-origin) by default — correct in production, where the Go
// binary serves the map-service surface itself. Only local dev, where this
// client's mock server runs on a separate port, needs an absolute override.
const DEFAULT_BASE_URL = "";
const DEFAULT_LOCALE = "vi-VN";
const DEFAULT_TZ_FALLBACK = "Asia/Ho_Chi_Minh";
const DEFAULT_TIMEOUT_MS = 15000;

// Our own Go engine now serves this exact map-service surface
// (internal/httpserver/mapsapi.go), so VITE_ENGINE_BASE_URL is preferred.
// VITE_TASCO_MAPS_BASE_URL stays as an override for pointing at a different
// facade (e.g. staging/production hackathon endpoints) if ever needed.
function resolveBaseUrl(configured?: string): string {
  if (configured && configured.length) return configured.replace(/\/+$/, "");
  const tascoBase = import.meta.env.VITE_TASCO_MAPS_BASE_URL;
  if (tascoBase && tascoBase.length) return tascoBase.replace(/\/+$/, "");
  const engineBase = import.meta.env.VITE_ENGINE_BASE_URL;
  if (engineBase && engineBase.length) return engineBase.replace(/\/+$/, "");
  return DEFAULT_BASE_URL;
}

function resolveTimezone(configured?: string): string {
  if (configured) return configured;
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) return tz;
  } catch {
    // Node/SSR environments may throw
  }
  return DEFAULT_TZ_FALLBACK;
}

function newRequestId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // ignore
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ── Query serialization ───────────────────────────────────────────────

type QueryValue = string | number | boolean | string[] | undefined | null;

function buildQuery(params: Record<string, QueryValue>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      q.append(key, value.join(","));
      continue;
    }
    q.append(key, String(value));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

// ── Client ────────────────────────────────────────────────────────────

export interface TascoMapsClient {
  readonly baseUrl: string;
  search(params: SearchParams, signal?: AbortSignal): Promise<SearchResponse>;
  autocomplete(params: AutocompleteParams, signal?: AbortSignal): Promise<AutocompleteResponse>;
  poi(id: string, params?: PoiParams, signal?: AbortSignal): Promise<PoiResponse>;
  reverseGeocoding(
    params: ReverseGeocodingParams,
    signal?: AbortSignal,
  ): Promise<ReverseGeocodingResponse>;
  nearbySearch(params: NearbySearchParams, signal?: AbortSignal): Promise<NearbySearchResponse>;
  geocoding(params: GeocodingParams, signal?: AbortSignal): Promise<GeocodingResponse>;
  route(body: RouteRequest, signal?: AbortSignal): Promise<RouteResponse>;
  /** Simple health probe against the mock server. Returns raw text/JSON. */
  health(signal?: AbortSignal): Promise<unknown>;
  /** Returns a NEW client with a different base URL, keeping the rest of
   *  the config. Handy for switching mock ↔ staging ↔ production at runtime. */
  withBaseUrl(nextBaseUrl: string): TascoMapsClient;
}

export function createTascoMapsClient(config: TascoMapsClientConfig = {}): TascoMapsClient {
  const baseUrl = resolveBaseUrl(config.baseUrl);
  const locale = config.locale ?? DEFAULT_LOCALE;
  const timezone = resolveTimezone(config.timezone);
  const fetchFn = config.fetchFn ?? fetch.bind(globalThis);
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function commonHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-Request-Id": newRequestId(),
      "X-Locale": locale,
      "X-Timezone": timezone,
    };
    if (config.bearerToken) headers.Authorization = `Bearer ${config.bearerToken}`;
    if (config.apiKey) headers["X-API-Key"] = config.apiKey;
    if (config.headerProvider) {
      const extra = await config.headerProvider();
      Object.assign(headers, extra);
    }
    return headers;
  }

  async function request<T>(
    method: "GET" | "POST",
    path: string,
    opts: { query?: Record<string, QueryValue>; body?: unknown; signal?: AbortSignal },
  ): Promise<T> {
    const url = `${baseUrl}${path}${buildQuery(opts.query ?? {})}`;
    const headers = await commonHeaders();
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";

    // Chain external signal with timeout signal so either can abort.
    const controller = new AbortController();
    const onAbort = () => controller.abort(opts.signal?.reason);
    if (opts.signal) {
      if (opts.signal.aborted) controller.abort(opts.signal.reason);
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }
    const timeoutHandle = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;

    let response: Response;
    try {
      response = await fetchFn(url, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      // Network failure, timeout, or aborted mid-flight — wrap uniformly.
      throw new TascoMapsApiError(0, {
        error: {
          code: "internal_error",
          message: err instanceof Error ? err.message : "Network request failed",
        },
      });
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      opts.signal?.removeEventListener("abort", onAbort);
    }

    if (!response.ok) {
      let payload: TascoErrorResponse;
      try {
        payload = (await response.json()) as TascoErrorResponse;
      } catch {
        payload = {
          error: {
            code: "internal_error",
            message: `HTTP ${response.status} ${response.statusText || ""}`.trim(),
          },
        };
      }
      throw new TascoMapsApiError(response.status, payload);
    }

    // 204 No Content or empty body — return undefined cast to T
    if (response.status === 204) return undefined as unknown as T;
    return (await response.json()) as T;
  }

  return {
    baseUrl,

    search(params, signal) {
      return request<SearchResponse>("GET", "/v1/search", {
        query: params as unknown as Record<string, QueryValue>,
        signal,
      });
    },

    autocomplete(params, signal) {
      return request<AutocompleteResponse>("GET", "/v1/autocomplete", {
        query: params as unknown as Record<string, QueryValue>,
        signal,
      });
    },

    poi(id, params, signal) {
      // include: string[] serializes to comma list via buildQuery's array branch
      return request<PoiResponse>("GET", `/v1/poi/${encodeURIComponent(id)}`, {
        query: (params ?? {}) as unknown as Record<string, QueryValue>,
        signal,
      });
    },

    reverseGeocoding(params, signal) {
      return request<ReverseGeocodingResponse>("GET", "/v1/reverse-geocoding", {
        query: params as unknown as Record<string, QueryValue>,
        signal,
      });
    },

    nearbySearch(params, signal) {
      return request<NearbySearchResponse>("GET", "/v1/nearby-search", {
        query: params as unknown as Record<string, QueryValue>,
        signal,
      });
    },

    geocoding(params, signal) {
      return request<GeocodingResponse>("GET", "/v1/geocoding", {
        query: params as unknown as Record<string, QueryValue>,
        signal,
      });
    },

    route(body, signal) {
      return request<RouteResponse>("POST", "/v1/route", { body, signal });
    },

    health(signal) {
      return request<unknown>("GET", "/health", { signal });
    },

    withBaseUrl(nextBaseUrl) {
      return createTascoMapsClient({ ...config, baseUrl: nextBaseUrl });
    },
  };
}

// ── Default singleton for quick use ───────────────────────────────────
// For most components: `import { tascoMaps } from "../lib/tasco-maps-client"`
// then call `tascoMaps.search({ q: "coffee" })`. Swap at boot with
// `tascoMaps.withBaseUrl("https://staging.example.com/v1")` if needed.
export const tascoMaps: TascoMapsClient = createTascoMapsClient();

// Re-export the error class so consumers only need one import path.
export { TascoMapsApiError } from "./tasco-maps-types";
