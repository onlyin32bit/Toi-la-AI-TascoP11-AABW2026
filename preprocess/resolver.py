"""S1 Entity Resolution + resolver (§6) + Quality Score v2 (§5.3 S_quality),
per resources/engine/SYSTEM_FLOW.md. Offline, additive: writes
engine/build/resolved.json. Never mutates kb.json or contributions.json — the
flat-file architecture stays the source of truth for POI/menu data; this file
is supplementary provenance/dedup output.

- S1 Entity Resolution: matches each UGC contribution against the 30-POI
  benchmark KB by geo<50m + name token overlap, so a user submitting a place
  that's actually already in the benchmark doesn't create a silent duplicate.
- Resolver (§6): for a handful of contested fields (name/address/
  opening_hours/price_level), collects every known candidate value with its
  source/tier/confidence/fetched_at, and picks a winner by tier-priority with
  a consensus override (>=3 independent lower-tier sources agreeing beats a
  stale higher tier). With today's dataset (0-few UGC contributions) this
  almost always resolves to the single tasco_csv candidate — that's the
  correct, honest behavior, not a bug: nothing to reconcile yet.
- Quality Score v2: completeness x source_agreement x freshness, extending
  build_kb.py's existing completeness score with the two new resolver-derived
  factors.

Run: python3 resolver.py   (after build_kb.py; contributions.json is optional)
"""
import json
import math
import pathlib
from datetime import datetime, timezone

from taxonomy import norm

BUILD_DIR = pathlib.Path(__file__).parent.parent / "engine" / "build"
KB_PATH = BUILD_DIR / "kb.json"
CONTRIB_PATH = BUILD_DIR / "contributions.json"
OUT_PATH = BUILD_DIR / "resolved.json"

EPOCH_ISO = "1970-01-01T00:00:00+00:00"

# Tier registry (SYSTEM_FLOW.md §S0/§6): higher tier wins outright; a lower
# tier only overrides via CONSENSUS_MIN independent agreeing sources.
TIER = {
    "tasco_csv": 3,
    "user_ocr": 2,  # business-verified equivalent for this hackathon (menu OCR)
    "user_contributed": 1,
    # Thu Duc enrichment sources (resolve_thuduc.py) — separate corpus, never
    # candidate-compared against the benchmark/UGC entries above, so reusing
    # tier 3/2 here doesn't create false equivalence with tasco_csv/user_ocr.
    "apify:google_places": 3,  # SYSTEM_FLOW.md tier 3, licensed-api
    "tinyfish:foody": 2,  # SYSTEM_FLOW.md tier 4a, agentic-facts (lower trust than apify)
}
CONFIDENCE = {
    "tasco_csv": 0.80,
    "user_ocr": 0.85,
    "user_contributed": 0.55,
    "apify:google_places": 0.80,
    "tinyfish:foody": 0.60,
}
CONSENSUS_MIN = 3

GEO_MATCH_METERS = 50
NAME_MATCH_MIN_OVERLAP = 0.6

RESOLVED_FIELDS = ["name", "address", "opening_hours", "price_level"]


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    rad = math.pi / 180
    dlat = (lat2 - lat1) * rad
    dlon = (lon2 - lon1) * rad
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1 * rad) * math.cos(lat2 * rad) * math.sin(dlon / 2) ** 2
    return r * 2 * math.asin(math.sqrt(a))


def name_similarity(a: str, b: str) -> float:
    """Token Jaccard overlap on normalized names — a cheap stand-in for an
    embedding-based match (no embedding model in the offline Python path;
    Go's kb.MatchName uses the analogous substring-containment idea online)."""
    ta, tb = set(norm(a).split()), set(norm(b).split())
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def load_json(path: pathlib.Path, default):
    if not path.exists():
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def opening_hours_value(poi: dict) -> str:
    return (poi.get("opening") or {}).get("raw", "")


def resolve_entities(benchmark: list[dict], contributions: list[dict]) -> list[dict]:
    """S1: match each UGC contribution against the benchmark KB."""
    duplicates = []
    for c in contributions:
        best, best_score = None, 0.0
        for b in benchmark:
            d = haversine(c["lat"], c["lon"], b["lat"], b["lon"])
            if d > GEO_MATCH_METERS:
                continue
            sim = name_similarity(c["name"], b["name"])
            if sim < NAME_MATCH_MIN_OVERLAP:
                continue
            score = sim - (d / GEO_MATCH_METERS) * 0.01  # tie-break: closer wins
            if score > best_score:
                best, best_score = b, score
        if best is not None:
            duplicates.append({
                "contribution_id": c["id"],
                "canonical_id": best["id"],
                "match_reason": f"geo<{GEO_MATCH_METERS}m + name_overlap>={NAME_MATCH_MIN_OVERLAP}",
            })
    return duplicates


def candidates_for(poi: dict, field: str, dup_contributions: list[dict]) -> list[dict]:
    """Every known candidate value for one field of one canonical POI."""
    cands = []
    source = poi.get("source", "tasco_csv")
    value = opening_hours_value(poi) if field == "opening_hours" else poi.get(field)
    if value not in (None, ""):
        cands.append({
            "value": value, "source": source, "tier": TIER.get(source, 3),
            "confidence": CONFIDENCE.get(source, 0.8),
            "fetched_at": poi.get("created_at") or EPOCH_ISO,
        })
    for c in dup_contributions:
        cv = opening_hours_value(c) if field == "opening_hours" else c.get(field)
        if cv not in (None, ""):
            cands.append({
                "value": cv, "source": "user_contributed", "tier": TIER["user_contributed"],
                "confidence": CONFIDENCE["user_contributed"],
                "fetched_at": c.get("created_at") or EPOCH_ISO,
            })
    return cands


def resolve_field(cands: list[dict]) -> dict | None:
    """§6: highest tier wins; a lower tier overrides only via CONSENSUS_MIN
    independent sources agreeing on one value. Ties -> most recent."""
    if not cands:
        return None
    by_tier: dict[int, list[dict]] = {}
    for c in cands:
        by_tier.setdefault(c["tier"], []).append(c)

    top_tier = max(by_tier)
    winner_pool = by_tier[top_tier]

    for tier in sorted(by_tier, reverse=True):
        if tier == top_tier:
            continue
        by_value: dict[str, list[dict]] = {}
        for c in by_tier[tier]:
            by_value.setdefault(norm(str(c["value"])), []).append(c)
        for group in by_value.values():
            if len(group) >= CONSENSUS_MIN:
                winner_pool, top_tier = group, tier
                break

    winner = max(winner_pool, key=lambda c: c["fetched_at"])
    return {
        "value": winner["value"], "source": winner["source"], "tier": winner["tier"],
        "confidence": winner["confidence"], "fetched_at": winner["fetched_at"],
        "candidates": len(cands),
    }


def source_agreement(cands: list[dict], winner: dict) -> float:
    if not cands:
        return 1.0
    agree = sum(1 for c in cands if norm(str(c["value"])) == norm(str(winner["value"])))
    return agree / len(cands)


def freshness(winner: dict) -> float:
    if winner["source"] == "tasco_csv":
        return 1.0  # canonical ground truth, no decay
    try:
        fetched = datetime.fromisoformat(str(winner["fetched_at"]).replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return 0.7
    age_days = (datetime.now(timezone.utc) - fetched).days
    half_life_days = 90
    return 0.5 ** (age_days / half_life_days)


def main():
    benchmark = load_json(KB_PATH, [])
    if not benchmark:
        raise SystemExit(f"{KB_PATH} not found — run build_kb.py first")
    contributions = load_json(CONTRIB_PATH, [])

    duplicates = resolve_entities(benchmark, contributions)
    dup_by_canonical: dict[str, list[dict]] = {}
    contrib_by_id = {c["id"]: c for c in contributions}
    for d in duplicates:
        dup_by_canonical.setdefault(d["canonical_id"], []).append(contrib_by_id[d["contribution_id"]])

    fields_out: dict[str, dict] = {}
    quality_out: dict[str, dict] = {}
    for poi in benchmark:
        dups = dup_by_canonical.get(poi["id"], [])
        poi_fields = {}
        for field in RESOLVED_FIELDS:
            winner = resolve_field(candidates_for(poi, field, dups))
            if winner:
                poi_fields[field] = winner
        fields_out[poi["id"]] = poi_fields

        comp = poi.get("quality_completeness", 0.0) or 0.0
        agreements = [
            source_agreement(candidates_for(poi, f, dups), w) for f, w in poi_fields.items()
        ]
        agree = sum(agreements) / len(agreements) if agreements else 1.0
        fresh_vals = [freshness(w) for w in poi_fields.values()]
        fresh = sum(fresh_vals) / len(fresh_vals) if fresh_vals else 1.0
        quality_out[poi["id"]] = {
            "completeness": round(comp, 3),
            "source_agreement": round(agree, 3),
            "freshness": round(fresh, 3),
            "score": round(comp * agree * fresh, 3),
        }

    out = {
        "resolved_at": datetime.now(timezone.utc).isoformat(),
        "duplicates": duplicates,
        "fields": fields_out,
        "quality_v2": quality_out,
    }
    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"resolved {len(benchmark)} POIs, {len(duplicates)} duplicate(s) -> {OUT_PATH}")


if __name__ == "__main__":
    main()
