# Tasco P11 — Restaurant Search UI

A React frontend for the Tasco Maps AI Hackathon P11 "AI-Powered Restaurant & Menu Intelligence" recommender: search restaurants by dish/segment/diet/price/time, see results on a map, and inspect a "why recommended" score breakdown per result.

## Tech stack

- **React 19 + TypeScript** — UI and state
- **Vite** — dev server / build (runs on port `1420` per `tauri.conf.json`, not the Vite default `5173`)
- **react-leaflet + Leaflet** — the map (CartoDB light tiles)
- **lucide-react** — icon set
- **Tauri 2** — optional desktop shell (`src-tauri/`)

## Architecture

There is no backend yet (see `../PLAN.md` §5/§8 — `engine/` hasn't been built).
`src/lib/rank.ts` implements the HARD-gate → SOFT-score recommender algorithm
from `PLAN.md` §7 client-side, running over the full 30-restaurant benchmark
dataset transcribed verbatim into `src/data/mockPlaces.ts` (POI, Menu, and
Reviews CSVs from `tasco-map-food-intelligence/`).

`src/api.ts` exposes `recommend()` / `getPoi()` against the same shape the
real `/v1/recommend` backend will eventually return (`PLAN.md` §8) — when
that backend exists, only `api.ts`'s function bodies need to change to
`fetch()` calls; every component below is unaffected.

```
src/
├── types.ts              # PlaceResult, WhyBreakdown, SearchFilters, Poi, etc.
├── api.ts                # recommend()/getPoi(), backend-swap seam
├── data/mockPlaces.ts     # all 30 benchmark restaurants (real data, verbatim)
├── lib/
│   ├── rank.ts            # HARD gate + SOFT score (PLAN.md §7)
│   └── labels.ts           # Vietnamese label maps for segments/diet/price
├── components/
│   ├── MapView.tsx         # react-leaflet map, markers follow search results
│   ├── SearchBar.tsx       # query input + "dùng vị trí của tôi" + city fallback
│   ├── FilterChips.tsx     # Segment / Diet / Price / Time chip filters
│   ├── ResultCard.tsx      # result row + expandable why-breakdown
│   └── AssistantBox.tsx    # disabled stub — needs an LLM backend (Phase 4)
├── App.tsx                # layout + state orchestration
└── App.css                 # responsive map+sidebar layout
```

## Features

- Map + result list, both driven by the same `SearchResponse`; markers and cards stay in sync by POI id
- Text search (Vietnamese, diacritics preserved) with city and dish-name detection
- Filter chips for Segment (Gia đình/Hẹn hò/Nhóm bạn/Ăn nhanh), Diet (Chay/Halal), Price (Bình dân/Trung bình/Cao cấp), Time (giờ hiện tại/ăn khuya)
- Expandable "Vì sao gợi ý?" panel showing the full score breakdown (semantic/geo/quality/persona/rating/localness/luxury-penalty) and matched dishes
- Honest empty state: a filter combination with zero matches (e.g. Diet=Halal in a city with none) shows a labeled "not found" message instead of silently relaxing filters — preserving the eval set's hallucination/geographic traps
- Geolocation via "Gần tôi", with a city dropdown fallback when GPS is unavailable

## Getting started

```bash
npm install
npm run dev       # starts Vite at http://localhost:1420
```

Other scripts:

```bash
npm run build     # type-check + production build to dist/
npm run preview   # preview the production build
npm run tauri dev # run inside the Tauri desktop shell
```

## Known limitations

- No real backend: ranking runs client-side in the browser rather than on a server.
- `AssistantBox` is a disabled placeholder — Q&A needs an LLM-backed assistant endpoint (`PLAN.md` Phase 4).
- No route/corridor (Module 5) integration.
