"""Fold every parallel scrape shard (data/thuduc/raw/*.json) + the existing
thuduc_enrichment.json into one merged file, via poi_resolver's highest-confidence-wins.

Run this after any parallel scrape_thuduc*.py --out raw/<name>.json invocations.

Usage:
    python merge_thuduc.py
"""
import json

from poi_provenance import DATA_DIR, ENRICHMENT_PATH, RAW_DIR
from poi_resolver import merge_poi


def load(path) -> dict:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def main() -> None:
    shards = sorted(RAW_DIR.glob("*.json"))
    print(f"folding {len(shards)} shard(s) + existing {ENRICHMENT_PATH.name}")

    merged: dict = load(ENRICHMENT_PATH)
    for shard_path in shards:
        shard = load(shard_path)
        for poi_id, poi in shard.items():
            merged[poi_id] = merge_poi(merged.get(poi_id), poi)
        print(f"  + {shard_path.relative_to(DATA_DIR)}: {len(shard)} POI(s)")

    ENRICHMENT_PATH.parent.mkdir(parents=True, exist_ok=True)
    ENRICHMENT_PATH.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {len(merged)} merged POI(s) -> {ENRICHMENT_PATH}")


if __name__ == "__main__":
    main()
