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
go run .                       # or: go build -o engine . && ./engine
```

Configuration is env-only:

| Env var   | Default   | Meaning                                            |
|-----------|-----------|----------------------------------------------------|
| `PORT`    | `8000`    | HTTP listen port                                   |
| `KB_DIR`  | `build`   | Directory holding `kb.json` / `contributions.json` |
| `UI_DIST` | *(unset)* | If set, serve this static dir at `/` (same-origin) |

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

### Stubs (DEV3)

`GET /v1/assistant` and `POST /v1/dishes/recognize` return `501`
`{"error":{"code":"not_implemented","message":"DEV3 chưa nối"}}`.

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
