# Tasco P11 — AI-Powered Restaurant & Menu Intelligence

Cold-start restaurant recommender + menu intelligence for the Tasco P11 track.
The system pairs a **Go online engine** (retrieval, ranking, serving, UGC) with a
**Python offline pipeline** (CSV → knowledge base). The engine core uses only the
Go standard library — zero external dependencies, one static binary, offline-safe.

## Overview

Given a natural-language Vietnamese query plus optional user context (location,
segment, diet, price, time), the engine returns ranked restaurants with a
transparent **"why"** breakdown. It follows the **retrieve-then-rerank cold-start
paradigm**: rule-based recall → a HARD constraint gate that rejects rather than
silently relaxes → a SOFT linear score with personalization, geo-localization and
an anti-luxury term. Honesty is a first-class feature: a restaurant that is not in
the knowledge base returns `not_found`, never a fabrication.

## Architecture

```
[Python OFFLINE — run once]                 [Go ONLINE — every request]
 5 CSV (data/)                               HTTP :8000
   │ preprocess/build_kb.py                     │ main.go   (routing, CORS, errors)
   ▼                                            ▼
 engine/build/kb.json ───────►  kb.go  ──►  retrieve.go  (ParseQuery + HARD gate)
                                             │
                                             ▼
                                          rerank.go   (SOFT score + why{})
                                             │
                                             ▼
                                          JSON response
```

- **Offline (Python):** `preprocess/build_kb.py` + `preprocess/taxonomy.py` join the
  5 CSVs, normalize Vietnamese taxonomy (segments/diet/price/opening hours), tokenize
  names/dishes, compute a quality-completeness score, and emit `engine/build/kb.json`
  (an array of POI objects). This is **not** modified by the engine.
- **Agentic enrichment (Python):** `preprocess/agent_loop.py` inspects each
  Thu Đức POI, plans source calls by unresolved field, invokes cached or live
  Google Places/Foody tools, retries another independent source, and publishes
  only facts with two-source agreement. Refused fields remain absent and are
  written to a review report with the attempted sources.
- **Online (Go):** loads `kb.json` once at start, indexes it, and serves requests with
  no ML runtime and no database.

## Directory layout

```
engine/                  Go online engine (this deliverable)
  go.mod                 module tascop11/engine (go 1.21, stdlib only)
  types.go               API DTOs (PlaceResult, RecommendResponse, NotFound, ErrorResponse, CompareResponse, Why)
  kb.go                  KB loader + norm()/tokenize()/isOpenAt()/haversine()
  retrieve.go            ParseQuery + DetectDish + NamedEntities + Recall (HARD gate)
  rerank.go              SOFT score + weight renormalization + why{} + VN reasoning
  compare.go             side-by-side comparison
  contribute.go          UGC write path (contributions.json) + menu-OCR seam
  main.go                HTTP server, CORS, request-id, panic recovery, routing
  build/                 kb.json (+ contributions.json at runtime) — git-ignored
preprocess/              Python offline pipeline (owned by DEV2)
  build_kb.py            CSV → engine/build/kb.json
  taxonomy.py            VN normalization + taxonomy maps
  data/                  5 source CSVs
```

## Setup & run

Prerequisites: Go 1.21+ and Python 3.

```bash
# 1) Build the knowledge base (offline, run once)
cd preprocess
python3 build_kb.py            # writes ../engine/build/kb.json

# 2) Build and run the engine
cd ../engine
go build ./...
go run ./cmd/server             # or: go build -o engine ./cmd/server && ./engine
```

Configuration is env-only (see `.env.example`):

| Env var   | Default   | Meaning                                            |
|-----------|-----------|----------------------------------------------------|
| `PORT`    | `8000`    | HTTP listen port                                   |
| `KB_DIR`  | `build`   | Directory holding `kb.json` / `contributions.json` |
| `UI_DIST` | *(unset)* | If set, serve this static dir at `/` (same-origin) |

### Demo data & test accounts

```bash
make demo           # kb + demo UGC contributions + run — no Postgres/Qdrant needed
```

- `make seed-contrib` writes 2 sample UGC restaurants to `engine/build/contributions.json`:
  one is a near-duplicate of an existing benchmark POI (~15m away, same name) to
  demo `preprocess/resolver.py`'s entity-resolution dedup; the other is a
  genuinely new restaurant that just shows up in `/v1/recommend` as
  `source:"user_contributed", verified:false`.
- `make docker-up` (see `docker-compose.yml`) starts local Postgres + Qdrant, then
  `make seed-db` inserts 3 demo accounts (all password `demo1234`):
  `demo.family@tascomaps.vn` (has a saved trip context feeding §5.3's `S_behavior`
  factor), `demo.contributor@tascomaps.vn` (owns the seeded UGC above),
  `demo.admin@tascomaps.vn`. Login via `POST /v1/auth/login`. Both seed commands
  are idempotent — safe to rerun.

## API reference

All responses set `X-Request-Id`, `X-Locale: vi-VN`, `X-Timezone: Asia/Ho_Chi_Minh`,
and permissive CORS. Vietnamese diacritics are preserved in JSON output.

### `GET /health`

```bash
curl -s http://localhost:8000/health
# {"pois":30,"status":"ok","ugc":0}
```

### `GET /v1/recommend`

Query params: `q` (natural language, optional — empty = "nearby"), `lat`, `lon`,
`segment` (`family|romantic|business|group|fastfood`), `diet` (`vegetarian|halal`),
`price` (`budget|mid|premium`), `time` (`HH:MM`, defaults to now in `Asia/Ho_Chi_Minh`),
`limit` (default 12), `eval` (`1` excludes user-contributed POIs from scoring).

```bash
curl -s "http://localhost:8000/v1/recommend?q=quán%20chay&lat=21.03&lon=105.85&limit=3"
```

```json
{
  "results": [{
    "id": "poi:res022", "type": "poi", "name": "Curry Garden",
    "label": "Nhà hàng", "category": "Chay",
    "coordinates": {"lat": 21.024511, "lon": 105.845931},
    "distanceMeters": 742, "score": 0.907, "source": "tasco_csv",
    "tags": ["business", "family", "vegetarian", "parking"],
    "meta": {
      "why": {"semantic":1,"geo_decay":0.69,"quality":0.97,"persona":0,
              "rating_pop":0.875,"localness":1,"luxury_penalty":0,"final":0.907},
      "reasoning": "cách bạn 0.7km · giá bình dân",
      "quality": 0.97, "matched_dishes": [], "verified": true
    }
  }],
  "meta": {"query": "quán chay", "filters": {"...": "..."}, "count": 3},
  "requestId": "…"
}
```

Honest empty result (anti-hallucination):

```bash
curl -s "http://localhost:8000/v1/recommend?q=Crystal%20BBQ"
# {"status":"not_found","reason":"Không tìm thấy “Crystal BBQ” trong dữ liệu",
#  "query_entity":"Crystal BBQ","suggestions":[...]}

curl -s "http://localhost:8000/v1/recommend?q=quán%20Halal%20ở%20TP.HCM"
# {"status":"not_found","reason":"Không có quán Halal ở TP. Hồ Chí Minh",
#  "suggestions":["Bỏ lọc Halal","Mở rộng sang khu vực khác (ví dụ Đà Lạt)"]}
```

### `GET /v1/poi?id=RES001`

Full POI record (all fields incl. `ai_summary`, `sentiment`, `dining_occasions`).
Returns `404` `ErrorResponse` if the id is unknown.

### `GET /v1/compare?ids=RES001,RES002`

Side-by-side price / rating / quality / segments / diet / top-3 dishes, plus
`distanceMeters` when `lat`/`lon` are provided. Unknown ids are listed under `not_found`.

### `POST /v1/contribute` (UGC)

```bash
curl -s -X POST http://localhost:8000/v1/contribute \
  -H 'Content-Type: application/json' \
  -d '{"name":"Quán Mới","lat":21.03,"lon":105.85,"city":"Hà Nội","price_level":"budget"}'
```

Validates `name` + `lat`/`lon` inside the Vietnam bounding box (lat 8–24, lon 102–110),
assigns `id="ugc:<hex>"`, `source="user_contributed"`, `verified=false`, and persists to
`contributions.json`. Returns `201` as a `PlaceResult`.

### `POST /v1/contribute/menu` (UGC + OCR seam)

`multipart` with `poi_id` + `image`. Calls the `OCRMenu` seam. Until DEV3 wires vision,
it degrades honestly:

```json
{"poi_id":"…","dishes":[],"needs_confirm":true,"note":"OCR chưa nối"}
```

### `POST /v1/enrich` (On-Demand AI Enrichment)

```bash
curl -s -X POST http://localhost:8000/v1/enrich \
  -H 'Content-Type: application/json' \
  -d '{"poi_id":"poi:res001","name":"Phở Bếp Nhà","address":"2 Trần Phú, Hoàn Kiếm, Hà Nội","city":"Hà Nội","quality_before":0.61}'
```

Calls the Apify Google Places actor to collect real-time evidence. Because the
online route currently has only one independent source, it returns
`status:"refused"`, lists `refused_fields`, and leaves quality unchanged.
Run the full multi-source loop with `make thuduc-agent` (cached evidence) or
`make thuduc-agent ARGS=--live` (real Apify + TinyFish calls).

Response:
```json
{
  "poi_id": "poi:res001",
  "quality_before": 0.61,
  "quality_after": 0.61,
  "provenance": {},
  "status": "refused",
  "refused_fields": ["menu", "hours", "priceRange"],
  "source_url": "https://maps.google.com/..."
}
```

If `APIFY_TOKEN` is unset in the environment, the endpoint returns a `503 Service Unavailable` with `service_unavailable` error code.


### `GET /v1/assistant` and `POST /v1/dishes/recognize`

Both are fully implemented (RAG Q&A with citations; vision-LLM dish recognition +
menu OCR) — see `internal/assistant`/`internal/vision`. They return `503
llm_unavailable`/`vision_unavailable` only when no LLM provider key is configured,
never a hardcoded stub.

## Tasco Maps hackathon API compatibility

This engine additionally exposes the map-service surface defined by
[`resources/data/tasco_maps_hackathon_api_documentation.md`](resources/data/tasco_maps_hackathon_api_documentation.md) —
`/v1/search`, `/v1/autocomplete`, `/v1/poi/{id}`, `/v1/reverse-geocoding`,
`/v1/nearby-search`, `/v1/geocoding`, `/v1/route` (plus every alias the doc lists,
e.g. `/search`, `/poi/{id}`, `/v1/reverse`) — implemented in
`internal/httpserver/mapsapi.go`. Full contract: [`openapi.yaml`](openapi.yaml).

This engine's domain is restaurants only (no street/address database, no
road-network routing graph), so three endpoints are explicitly best-effort rather
than general-purpose, and say so honestly instead of fabricating precision:

- **`/v1/geocoding` / `/v1/reverse-geocoding`** match against this engine's own
  POI corpus (token-overlap on address text; nearest-POI-within-radius for
  reverse), not a general street geocoder. A query with no nearby/matching POI
  returns an empty `results: []`, never an invented coordinate or address.
- **`/v1/route`** has no routing engine behind it. It returns an honest haversine
  straight-line distance/duration estimate (`routes[].approximate: true`) with a
  single maneuver that says exactly that — never fabricated turn-by-turn
  directions or street names. Always 1 route, regardless of the requested
  `alternates` count (no fake route diversity).
- **`/v1/search` / `/v1/nearby-search` / `/v1/autocomplete` / `/v1/poi/{id}`**
  are fully real, backed by the same `internal/retrieve`→`internal/rerank`
  pipeline as this engine's own `/v1/recommend` — `category` is matched
  best-effort against cuisine/segments (restaurant-domain categories, not a
  general POI taxonomy like `office`/`hotel`).

**Compatibility requirements** (per the doc's "Submission Expectations"):

| Requirement | Status |
|---|---|
| Stable IDs | `poi:<id>` / `ugc:<hex>`, never reassigned |
| WGS84 lat/lon | `model.Coordinates{Lat, Lon}` throughout |
| VN diacritics preserved | `json.Encoder.SetEscapeHTML(false)`, UTF-8 everywhere |
| Configurable base URL | `PORT`/`UI_DIST` env — see `.env.example` |
| Configurable auth | `Authorization: Bearer <token>` or `X-API-Key: <token>`, both optional |
| No app-specific UI deps | Pure JSON HTTP API, zero Flutter/UI coupling in the service layer |
| Deterministic mock data | `engine/build/kb.json` (from `preprocess/build_kb.py`) is fully deterministic |

Not yet built: a Flutter/Dart SDK client adapter (the doc's `PeliasClient`/
`RoutingClient` boundary) — the REST contract in `openapi.yaml` is the
integration surface until/unless that adapter is written.

## Ranking methodology

Stage 1 recalls candidates by lexical token match and applies a **HARD gate** —
named dish, city, minimum rating, maximum price (cheapest main dish with `avg_price`
fallback), opening hours, and diet (with vegetarian-dish evidence). Failing any
constraint rejects the candidate; an empty survivor set yields an honest `not_found`
with labelled relaxation suggestions rather than silently loosening filters.

Stage 2 scores survivors with a linear **SOFT score** (PLAN §7.2):

```
score = 0.30·semantic + 0.20·geo_decay + 0.15·quality + 0.15·persona
      + 0.10·rating_pop + 0.10·localness − 0.25·luxury_penalty
```

- `semantic` = |query tokens ∩ POI index| / |query tokens|, boosted by dish matches.
- `geo_decay` = `exp(-distance / 2km)` (haversine).
- `quality` = precomputed POI quality score.
- `persona` = average match over the provided segment/diet/price dimensions.
- `rating_pop` = (rating/5 + popularity/100) / 2.
- `localness` favours affordable, high-quality local eateries.
- `luxury_penalty` subtracts for premium venues (per the Tasco brief).

When a signal is unavailable (no user location → no `geo_decay`; empty query → no
`semantic`; no persona dims), its weight is **dropped and the remaining positive
weights are renormalized to sum 1** — never zero-filled, which would unfairly sink
otherwise good venues. Each result carries a `why{}` factor breakdown and a Vietnamese
`reasoning` string (distance, persona, price, opening context).

The design follows the retrieve-then-rerank cold-start approach of **KALM4Rec**
([Kieu et al., 2024](https://arxiv.org/abs/2405.19612)); geographic weighting follows
**GeoMF** ([Lian et al., KDD 2014](https://dl.acm.org/doi/10.1145/2623330.2623638));
using lexical/semantic relevance as a prior over classical ranking follows the
**Language-Model Prior** framework ([Ju et al., 2024](https://arxiv.org/abs/2411.09065)).
Deep recommenders (LightGCN, GETNext, SASRec) are deliberately avoided — 30 POIs and
150 reviews would overfit — and are cited as the scaling roadmap.

## Honesty & anti-hallucination

- **Crystal BBQ trap:** `NamedEntities` detects proper-noun restaurant names in the
  query. A multi-word capitalized name absent from the KB returns `not_found` with the
  offending `query_entity` — the engine never invents a restaurant. Detection is
  conservative (skips city names and function-word-led phrases) so valid queries such
  as "bún chả HCM" are not false-flagged.
- **Halal-in-HCM trap:** the HARD gate rejects candidates that lack the requested diet;
  when nothing survives it returns a specific reason ("Không có quán Halal ở
  TP. Hồ Chí Minh") plus labelled relaxation options, instead of relaxing constraints
  on its own.

## UGC (user-generated content)

`contribute.go` is the only stateful write path. Users add restaurants (`/v1/contribute`)
and attach OCR'd menus (`/v1/contribute/menu`) to a mutex-guarded `contributions.json`.
UGC POIs appear in `/v1/recommend` but always carry `source="user_contributed"` and
`verified=false` for UI badging, and are excluded when `eval=1` so benchmark scoring
stays pure.

## Seams left for the team

- `OCRMenu` (`contribute.go`) — DEV3 overrides with real vision OCR (`vision.go`).
- `/v1/assistant`, `/v1/dishes/recognize` — DEV3 implements (currently `501`).
- `POI.Sentiment` is `json.RawMessage` (opaque pass-through) awaiting DEV3's
  `summarize.py` enrichment; `ai_summary`, `cuisine_classification`, `dining_occasions`
  are already in the schema and served as-is.

## References

1. Kieu et al. **KALM4Rec.** [arXiv:2405.19612](https://arxiv.org/abs/2405.19612), 2024.
2. Lian et al. **GeoMF.** [KDD 2014](https://dl.acm.org/doi/10.1145/2623330.2623638).
3. Ju et al. **Language-Model Prior Overcomes Cold-Start Items.** [arXiv:2411.09065](https://arxiv.org/abs/2411.09065), 2024.
