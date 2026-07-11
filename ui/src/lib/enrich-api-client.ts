// Fetch wrapper for the Go engine's POST /v1/enrich endpoint.
// Handles snake_case ↔ camelCase mapping so callers keep talking in the
// UI's EnrichmentResult shape.
//
// Base URL resolution (first hit wins):
//   1. `opts.baseUrl` passed to fetchEnrich()
//   2. `import.meta.env.VITE_ENGINE_BASE_URL` at build time
//   3. Default: `http://localhost:8000` (matches engine/cmd/server default)
import type { EnrichmentResult, EnrichmentSource, ProvenanceField, ProvenanceKey } from "../types";

const DEFAULT_BASE_URL = "http://localhost:8000";

// Backend request/response shapes (snake_case, matches engine/internal/enrich).
export interface EnrichApiRequest {
  poiId: string;
  name: string;
  address?: string;
  city?: string;
  qualityBefore?: number;
}

interface EnrichApiResponseProvenance {
  source: string;
  confidence: number;
  fetched_at: string;
}

interface EnrichApiResponse {
  poi_id: string;
  quality_before: number;
  quality_after: number;
  provenance: Record<string, EnrichApiResponseProvenance>;
  menu_items?: string[];
  hours_open?: string;
  price_range?: string;
  diet_tags?: string[];
  rating?: number;
  source_url?: string;
}

interface EnrichApiError {
  error: { code: string; message: string; details?: unknown };
  requestId?: string;
}

export class EnrichApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;

  constructor(status: number, code: string, message: string, requestId?: string) {
    super(message);
    this.name = "EnrichApiFailure";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

function resolveBaseUrl(configured?: string): string {
  if (configured) return configured.replace(/\/+$/, "");
  const envBase = import.meta.env.VITE_ENGINE_BASE_URL;
  if (envBase) return envBase.replace(/\/+$/, "");
  return DEFAULT_BASE_URL;
}

// Guards against unexpected source strings from the backend so the UI's
// ProvenanceBadge lookup (SOURCE_META) never returns undefined.
const KNOWN_SOURCES: readonly EnrichmentSource[] = [
  "google",
  "foody",
  "tiktok",
  "shopeefood",
  "ugc",
];

function toKnownSource(raw: string): EnrichmentSource {
  return (KNOWN_SOURCES as readonly string[]).includes(raw) ? (raw as EnrichmentSource) : "google";
}

// Backend provenance keys already match the UI's ProvenanceKey union.
const KNOWN_KEYS: readonly ProvenanceKey[] = [
  "menu",
  "hours",
  "priceRange",
  "dietTags",
  "photos",
  "address",
];

function toKnownKey(raw: string): ProvenanceKey | null {
  return (KNOWN_KEYS as readonly string[]).includes(raw) ? (raw as ProvenanceKey) : null;
}

export function mapEnrichResponseToResult(res: EnrichApiResponse): EnrichmentResult {
  const provenance: Partial<Record<ProvenanceKey, ProvenanceField>> = {};
  for (const [rawKey, raw] of Object.entries(res.provenance ?? {})) {
    const key = toKnownKey(rawKey);
    if (!key) continue;
    provenance[key] = {
      source: toKnownSource(raw.source),
      confidence: raw.confidence,
      fetchedAt: raw.fetched_at,
    };
  }
  return {
    poiId: res.poi_id,
    qualityBefore: res.quality_before,
    qualityAfter: res.quality_after,
    provenance,
    menuItems: res.menu_items ?? [],
    hoursOpen: res.hours_open,
    priceRange: res.price_range,
    dietTags: res.diet_tags,
  };
}

interface FetchEnrichOpts {
  baseUrl?: string;
  signal?: AbortSignal;
}

// POST /v1/enrich. Throws EnrichApiFailure on non-2xx (parses the
// engine's ErrorResponse envelope). Throws a generic Error on network faults.
export async function fetchEnrich(
  request: EnrichApiRequest,
  opts: FetchEnrichOpts = {},
): Promise<EnrichmentResult> {
  const url = `${resolveBaseUrl(opts.baseUrl)}/v1/enrich`;
  const body = JSON.stringify({
    poi_id: request.poiId,
    name: request.name,
    address: request.address,
    city: request.city,
    quality_before: request.qualityBefore,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body,
    signal: opts.signal,
  });

  if (!res.ok) {
    let code = "internal_error";
    let message = `HTTP ${res.status} ${res.statusText || ""}`.trim();
    let requestId: string | undefined;
    try {
      const err = (await res.json()) as EnrichApiError;
      code = err.error?.code ?? code;
      message = err.error?.message ?? message;
      requestId = err.requestId;
    } catch {
      /* body wasn't JSON — keep defaults */
    }
    throw new EnrichApiFailure(res.status, code, message, requestId);
  }

  const raw = (await res.json()) as EnrichApiResponse;
  return mapEnrichResponseToResult(raw);
}
