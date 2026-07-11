"""Structured-fact resolution for the Thu Duc enrichment corpus — the
"structured facts go through resolver.py, not Qdrant" half of the Apify
cleanup. Reuses resolver.py's resolve_field()/source_agreement()/freshness()
directly (not a reimplementation) so there's one tier/consensus/freshness
algorithm for the whole repo, not two competing ones.

Input: data/thuduc/thuduc_enrichment.json — each POI's structured fields are
already provenance-wrapped ({value, source, confidence, fetched_at}) by
apify_poi_mapper.py / thuduc_poi_mapper.py, and poi_resolver.merge_poi() has
already collapsed same-field candidates from the two possible sources
(apify:google_places, tinyfish:foody) down to a single winner per field. So
each field here is a 1-candidate resolve — genuinely correct (nothing to
reconcile beyond what merge_poi already did), not a shortcut: it's honest
about there being exactly one known source per field in this dataset.

Output: data/thuduc/thuduc_resolved.json, same shape as engine/build/resolved.json
(fields{}, quality_v2{}) — full provenance preserved, unlike thuduc_kb.json
which flattens wrappers down to plain values for the Go POI schema.

Explicitly OUT of scope here (per the "split by kind" design): description_raw
(descriptive text -> cmd/embed's searchableText(), not this resolver) and
phone/menu items (not currently scraped by apify_poi_mapper.py/
thuduc_poi_mapper.py at all -- nothing to resolve, not fabricated).

Run: python3 resolve_thuduc.py   (after compile_thuduc_kb.py or standalone)
"""
import json
from datetime import datetime, timezone

from poi_provenance import ENRICHMENT_PATH
from resolver import freshness, resolve_field, source_agreement, TIER, CONFIDENCE

OUT_PATH = ENRICHMENT_PATH.parent / "thuduc_resolved.json"

# Structured facts only (§ split-by-kind). NOT description_raw (descriptive
# text) — that belongs to cmd/embed's searchableText(), never to this file.
RESOLVED_FIELDS = ["name", "address", "opening", "price_level", "amenities", "car_parking"]


def candidate_from_wrapper(wrapper: dict) -> dict | None:
    """A field wrapper is {value, source, confidence, fetched_at}. Converts it
    into resolver.py's candidate shape, looking up `tier` from the source tag
    (falls back to the wrapper's own confidence-derived rank if the source is
    somehow unrecognized, rather than dropping the candidate silently)."""
    if not wrapper or wrapper.get("value") in (None, "", []):
        return None
    source = wrapper.get("source", "")
    tier = TIER.get(source)
    confidence = wrapper.get("confidence", CONFIDENCE.get(source, 0.5))
    if tier is None:
        tier = 1 if confidence < 0.7 else 2
    return {
        "value": wrapper["value"],
        "source": source,
        "tier": tier,
        "confidence": confidence,
        "fetched_at": wrapper.get("fetched_at") or "1970-01-01T00:00:00+00:00",
    }


def resolve_poi_fields(poi: dict) -> dict:
    out = {}
    for field_name in RESOLVED_FIELDS:
        cand = candidate_from_wrapper(poi.get(field_name))
        if cand is None:
            continue
        winner = resolve_field([cand])  # 1-candidate resolve — see module docstring
        if winner:
            out[field_name] = winner
    return out


def quality_for(poi_fields: dict) -> dict:
    if not poi_fields:
        return {"completeness": 0.0, "source_agreement": 1.0, "freshness": 1.0, "score": 0.0}
    completeness = len(poi_fields) / len(RESOLVED_FIELDS)
    agreements = [source_agreement([w], w) for w in poi_fields.values()]  # always 1.0 (1 candidate)
    agree = sum(agreements) / len(agreements)
    fresh_vals = [freshness(w) for w in poi_fields.values()]
    fresh = sum(fresh_vals) / len(fresh_vals)
    return {
        "completeness": round(completeness, 3),
        "source_agreement": round(agree, 3),
        "freshness": round(fresh, 3),
        "score": round(completeness * agree * fresh, 3),
    }


def main():
    if not ENRICHMENT_PATH.exists():
        raise SystemExit(f"{ENRICHMENT_PATH} not found — run a scrape + merge_thuduc.py first")

    enrichment = json.loads(ENRICHMENT_PATH.read_text(encoding="utf-8"))

    fields_out: dict[str, dict] = {}
    quality_out: dict[str, dict] = {}
    for poi_id, poi in enrichment.items():
        poi_fields = resolve_poi_fields(poi)
        fields_out[poi_id] = poi_fields
        quality_out[poi_id] = quality_for(poi_fields)

    out = {
        "resolved_at": datetime.now(timezone.utc).isoformat(),
        "fields": fields_out,
        "quality_v2": quality_out,
    }
    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"resolved {len(fields_out)} Thu Duc POIs -> {OUT_PATH}")


if __name__ == "__main__":
    main()
