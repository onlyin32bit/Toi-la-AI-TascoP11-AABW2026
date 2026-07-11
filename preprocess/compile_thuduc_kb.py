"""Flatten data/thuduc/thuduc_enrichment.json (provenance-wrapped) into a flat JSON
ARRAY matching preprocess/build_kb.py::build_poi()'s field shape — usable as a knowledge
base the same way engine/build/kb.json is (see PLAN.md §5.1), while keeping a couple of
forward-compatible extra fields (car_parking, source_url) that the current Go POI struct
simply ignores until it's extended (see phase-01 plan "Next Steps").

Split by kind (not "put it all in Qdrant" — see resolve_thuduc.py's docstring for the
structured-fact half of this split):
- Structured facts (name/address/opening/price_level/amenities) ALSO get resolved with
  full provenance into thuduc_resolved.json by resolve_thuduc.py — this file only needs
  the flattened winning values for the Go POI schema / cmd/embed's searchableText().
- Tier 4b signals (TikTok/Facebook) are NEVER merged in as facts. They're reduced here to
  a single `buzz_score` in [0,1] per POI (engagement-weighted, 14-day half-life decay per
  SYSTEM_FLOW.md §3) — matching engine's `POI.BuzzScore *float64` field exactly, so it
  feeds internal/rerank's S_buzz factor once this file reaches engine/build/. Most POIs
  will have buzz_score = null (absent, not 0) since TikTok/Facebook name-matching only
  hits a small fraction of the 537 POIs in this dataset — that's honest, not a bug: no
  signal matched means no signal, never a fabricated low score.

Usage:
    python merge_thuduc.py       # fold parallel shards first, if any
    python compile_thuduc_kb.py
    python resolve_thuduc.py     # structured facts -> thuduc_resolved.json (provenance)

Reminder (staleness, no automatic trigger exists for this yet): if a rerun of this script
changes any POI's name/cuisine_type/city/district/dishes/strengths (the fields
cmd/embed's searchableText() blob is built from), that POI's Qdrant vector goes stale —
rerun `go run ./cmd/embed -kb-file data/thuduc/thuduc_kb.json -collection tascop11_thuduc`
to refresh it. Nothing currently diffs old vs. new and re-embeds automatically.
"""
import json
import math
from datetime import datetime, timezone

from poi_provenance import ENRICHMENT_PATH, KB_PATH, SIGNALS_PATH

PROVENANCE_KEYS = {"value", "source", "confidence", "fetched_at"}

# Engagement-index weights per platform (comments/shares indicate more genuine
# interest than passive likes/views, so they're weighted higher).
_TIKTOK_WEIGHTS = {"likes": 1.0, "comments": 2.0, "shares": 3.0, "views": 0.05}
_FACEBOOK_WEIGHTS = {"likes": 1.0, "followers": 0.05, "rating_count": 3.0}
_BUZZ_HALF_LIFE_DAYS = 14  # SYSTEM_FLOW.md §3
_BUZZ_SCALE = 20_000  # calibrated against real thuduc_signals.json engagement values


def _flatten(value):
    if isinstance(value, dict) and PROVENANCE_KEYS.issubset(value.keys()):
        return value["value"]
    return value


def compile_poi(poi: dict, buzz_score: float | None) -> dict:
    flat = {key: _flatten(val) for key, val in poi.items()}
    flat["buzz_score"] = buzz_score
    return flat


def _age_days(iso_ts: str) -> float:
    try:
        ts = datetime.fromisoformat(iso_ts.replace("Z", "+00:00"))
    except (ValueError, AttributeError, TypeError):
        return _BUZZ_HALF_LIFE_DAYS * 4  # unknown timestamp -> treat as stale, not fresh
    return max(0.0, (datetime.now(timezone.utc) - ts).total_seconds() / 86400)


def _engagement_index(sig: dict) -> float:
    weights = _TIKTOK_WEIGHTS if sig.get("platform") == "tiktok" else _FACEBOOK_WEIGHTS
    engagement = sig.get("engagement") or {}
    return sum(weights.get(k, 0.0) * (engagement.get(k) or 0) for k in weights)


def load_buzz_scores() -> dict[str, float]:
    """Reduces raw TikTok/Facebook signals to one buzz_score per matched POI:
    sum(engagement_index * recency_decay) across every matched signal, then
    squashed into [0,1) via 1-exp(-x/scale) so a single viral post saturates
    without an unbounded score, while multiple smaller mentions still add up."""
    if not SIGNALS_PATH.exists():
        return {}
    signals = json.loads(SIGNALS_PATH.read_text(encoding="utf-8"))
    weighted: dict[str, float] = {}
    for sig in signals.values():
        if not sig.get("matched_poi_ids"):
            continue
        idx = _engagement_index(sig)
        if idx <= 0:
            continue
        recency = 0.5 ** (_age_days(sig.get("published_at") or sig.get("fetched_at") or "") / _BUZZ_HALF_LIFE_DAYS)
        contribution = idx * recency
        for poi_id in sig["matched_poi_ids"]:
            weighted[poi_id] = weighted.get(poi_id, 0.0) + contribution
    return {poi_id: round(1 - math.exp(-total / _BUZZ_SCALE), 3) for poi_id, total in weighted.items()}


def main() -> None:
    if not ENRICHMENT_PATH.exists():
        raise SystemExit(f"{ENRICHMENT_PATH} not found — run a scrape + merge_thuduc.py first")

    enrichment = json.loads(ENRICHMENT_PATH.read_text(encoding="utf-8"))
    buzz = load_buzz_scores()
    kb = [compile_poi(poi, buzz.get(poi_id)) for poi_id, poi in enrichment.items()]

    KB_PATH.parent.mkdir(parents=True, exist_ok=True)
    KB_PATH.write_text(json.dumps(kb, ensure_ascii=False, indent=2), encoding="utf-8")
    matched = sum(1 for p in kb if p["buzz_score"] is not None)
    print(f"compiled {len(kb)} POI(s) -> {KB_PATH} ({matched} with a computed buzz_score)")


if __name__ == "__main__":
    main()
