# Tasco Restaurant Intelligence API

Cloudflare Workers backend for turning restaurant POIs, menus, uploaded artifacts, and reviews into evidence-backed restaurant intelligence.

## What works

- Idempotent Tasco POI, structured menu, and review imports
- D1 canonical schema with claims, provenance, audit, quality, assistant, and search tables
- R2 uploads with byte-level MIME checks, SHA-256 deduplication, and deterministic keys
- Queue-driven source processing and indexing with processed-event idempotency
- Plain OCR text and structured menu JSON extraction into reviewable claims
- Claim accept/reject/correct flow with canonical menu/profile materialization
- Restaurant detail, menu filters, semantic/deterministic search, dish search, recommendations, comparison, and grounded assistant APIs
- Workers AI embeddings and Vectorize upserts behind `ENABLE_AI_SEARCH`
- Deterministic price, distance, opening-hour, dietary, quality, and ranking rules
- Tasco-compatible `GET /v1/search` and `GET /search` facade
- OpenAPI at `GET /openapi.json`

Image/PDF/video OCR is intentionally behind `OcrProvider`. Uploads are stored and queued but move to `needs_review` until a provider is configured; no mock provider is used in the production path.

## Local setup

```bash
pnpm install
cp .dev.vars.example .dev.vars
XDG_CONFIG_HOME=/tmp/wrangler-config pnpm cf-typegen
XDG_CONFIG_HOME=/tmp/wrangler-config pnpm db:migrate
pnpm dev
```

The Vite Worker dev server prints its local URL, normally `http://localhost:5173`. For the seed scripts, set it explicitly:

```bash
API_BASE_URL=http://localhost:5173 pnpm seed:tasco
API_BASE_URL=http://localhost:5173 pnpm seed:menus
API_BASE_URL=http://localhost:5173 pnpm seed:reviews
API_BASE_URL=http://localhost:5173 pnpm index:all
```

## Core commands

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
pnpm db:migrate
pnpm evaluate:search
```

## Import example

```bash
curl -X POST http://localhost:5173/api/v1/admin/imports/tasco-pois \
  -H 'Authorization: Bearer local-development-key' \
  -H 'Idempotency-Key: demo-poi-1' \
  -H 'Content-Type: application/json' \
  -d '{
    "records": [{
      "tascoPoiId": "tasco_123",
      "name": "Bếp Nhà Xứ Quảng",
      "address": "123 Nguyễn Văn Linh",
      "district": "Hải Châu",
      "city": "Đà Nẵng",
      "latitude": 16.0544,
      "longitude": 108.2022,
      "category": "restaurant"
    }]
  }'
```

## Search example

```bash
curl -X POST http://localhost:5173/api/v1/search \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "quán yên tĩnh cho gia đình, món Việt dưới 150 nghìn",
    "filters": {
      "maxPricePerPersonVnd": 150000,
      "familyFriendlyRequired": true
    },
    "limit": 10,
    "includeEvidence": true
  }'
```

## Cloudflare provisioning

Replace the placeholder D1 ID in `wrangler.jsonc`, then create the named R2 bucket, queues, and Vectorize index in the target account. Create Vectorize with the dimension returned by the current `@cf/baai/bge-m3` model and cosine distance; runtime indexing verifies the dimension again before upsert. Create metadata indexes for `documentType`, `city`, `district`, `primaryCuisine`, `vegetarianExplicit`, `veganExplicit`, `halalExplicit`, `familyFriendly`, `priceAmountVnd`, and `qualityScore` before the first upsert.

Set secrets without adding them to config:

```bash
pnpm exec wrangler secret put ADMIN_API_KEY
```

Apply and deploy:

```bash
XDG_CONFIG_HOME=/tmp/wrangler-config pnpm db:migrate:remote
pnpm deploy
```

See [architecture](docs/architecture.md) and [assumptions](docs/assumptions.md) for scope and extension points.
