"""Flatten data/thuduc/thuduc_enrichment.json (provenance-wrapped) into a flat JSON
ARRAY matching preprocess/build_kb.py::build_poi()'s field shape — usable as a knowledge
base the same way engine/build/kb.json is (see PLAN.md §5.1), while keeping a couple of
forward-compatible extra fields (car_parking, source_url, buzz_mentions) that the current
Go POI struct simply ignores until it's extended (see phase-01 plan "Next Steps").

Tier 4b signals (TikTok/Facebook) are NOT merged in as facts — only a `buzz_mentions`
count is attached per POI, per SYSTEM_FLOW.md's "signals feed personalization, never
become a fact" rule.

Usage:
    python merge_thuduc.py       # fold parallel shards first, if any
    python compile_thuduc_kb.py
"""
import json
from collections import Counter

from poi_provenance import ENRICHMENT_PATH, KB_PATH, SIGNALS_PATH

PROVENANCE_KEYS = {"value", "source", "confidence", "fetched_at"}


def _flatten(value):
    if isinstance(value, dict) and PROVENANCE_KEYS.issubset(value.keys()):
        return value["value"]
    return value


def compile_poi(poi: dict, buzz_mentions: int) -> dict:
    flat = {key: _flatten(val) for key, val in poi.items()}
    flat["buzz_mentions"] = buzz_mentions
    return flat


def load_buzz_counts() -> Counter:
    if not SIGNALS_PATH.exists():
        return Counter()
    signals = json.loads(SIGNALS_PATH.read_text(encoding="utf-8"))
    counts: Counter = Counter()
    for sig in signals.values():
        for poi_id in sig.get("matched_poi_ids", []):
            counts[poi_id] += 1
    return counts


def main() -> None:
    if not ENRICHMENT_PATH.exists():
        raise SystemExit(f"{ENRICHMENT_PATH} not found — run a scrape + merge_thuduc.py first")

    enrichment = json.loads(ENRICHMENT_PATH.read_text(encoding="utf-8"))
    buzz = load_buzz_counts()
    kb = [compile_poi(poi, buzz.get(poi_id, 0)) for poi_id, poi in enrichment.items()]

    KB_PATH.parent.mkdir(parents=True, exist_ok=True)
    KB_PATH.write_text(json.dumps(kb, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"compiled {len(kb)} POI(s) -> {KB_PATH}")


if __name__ == "__main__":
    main()
