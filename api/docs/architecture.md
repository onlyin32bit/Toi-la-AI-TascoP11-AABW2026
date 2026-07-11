# Architecture

## Runtime flow

```text
HTTP API -> D1 canonical records / R2 artifacts -> Queue
Queue -> deterministic extraction or provider boundary -> candidate claims
Claim review -> canonical menu/profile -> search documents
Search documents -> Workers AI embeddings -> Vectorize
Search -> Vectorize or D1 fallback -> D1 hard filters -> ranked response
Assistant -> search -> bounded context -> cited answer
```

## Domain boundaries

- `restaurants`: POIs, branches, identity, opening hours, quality, review aggregates.
- `menus`: structured menus, strict dietary state, Vietnamese price parsing.
- `sources`: uploads, URL policy, R2 artifacts, ingestion jobs, extraction state.
- `claims`: provenance, trust, review, canonical materialization, audit events.
- `search`: parsing, D1/Vectorize retrieval, distance/opening filters, ranking, indexing.
- `ai`: model adapters, validated extraction schemas, versioned prompts.
- `shared`: IDs, errors, request envelopes, auth, idempotency, normalization.

Cloudflare bindings enter only at repository/service boundaries. Pure business rules have no binding dependency and run in focused unit tests.

## Failure behavior

- Upload and URL requests return after durable storage and queue publication.
- Queue event IDs are recorded in `processed_events` to tolerate at-least-once delivery.
- Claim extraction is idempotent by `(source_id, extraction_key)`.
- Vector generation is idempotent by embedding hash and stable search-document ID.
- Optional Vectorize/AI failures do not disable deterministic search.
- Unsupported source failures are permanent; transient failures use queue retry/backoff and DLQ policy.
