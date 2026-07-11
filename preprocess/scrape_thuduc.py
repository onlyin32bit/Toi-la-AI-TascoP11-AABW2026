"""Scrape real Foody.vn restaurant listings for Thu Duc district via TinyFish.

Offline, one-shot script (PLAN.md §6.5 enrichment pattern) -> data/thuduc/thuduc_enrichment.json
(committable — unlike engine/build/, data/ is not gitignored). Never touches engine/build/kb.json.
Usage:

    python scrape_thuduc.py --sample 3      # small verification run
    python scrape_thuduc.py --limit 40      # full batch

Requires TINYFISH_API_KEY in .env (see .env.example). Real API calls only, no mocks.
"""
import argparse
import json
import pathlib
import sys
from datetime import datetime, timezone

from dotenv import load_dotenv

import tinyfish_client as tf
from poi_provenance import DATA_DIR, ENRICHMENT_PATH
from thuduc_poi_mapper import RESTAURANT_LIST_SCHEMA, build_extraction_goal, dedupe_key, map_to_poi

SEARCH_QUERIES = [
    "quán ăn ngon Thủ Đức foody",
    "nhà hàng Thủ Đức Thành phố Hồ Chí Minh",
    "quán cà phê Thủ Đức foody",
    "địa điểm ăn uống Thủ Đức",
]


def load_existing(out_path: pathlib.Path) -> dict:
    if out_path.exists():
        return json.loads(out_path.read_text(encoding="utf-8"))
    return {}


def write_output(pois: dict, out_path: pathlib.Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(pois, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {len(pois)} POIs -> {out_path}")


def run(limit: int, force: bool, out_path: pathlib.Path) -> None:
    load_dotenv(pathlib.Path(__file__).parent.parent / ".env")
    client = tf.make_client()

    existing = {} if force else load_existing(out_path)
    print(f"starting with {len(existing)} existing POI(s) in {out_path.name}")

    listing_urls = tf.discover_listing_urls(client, SEARCH_QUERIES)
    print(f"discovered {len(listing_urls)} candidate Foody listing URL(s)")
    if not listing_urls:
        print("no Foody URLs found via search — nothing to scrape this run")
        return

    listing_urls = tf.precheck_mentions_thuduc(client, listing_urls)
    print(f"{len(listing_urls)} listing URL(s) mention Thu Duc after free precheck")

    goal = build_extraction_goal()
    seen_keys: set[str] = {dedupe_key({"name": p["name"]["value"], "address": p["address"]["value"]})
                           for p in existing.values()}
    new_pois: dict[str, dict] = {}
    total_steps = 0

    for url in listing_urls:
        if len(existing) + len(new_pois) >= limit:
            print(f"reached --limit {limit}, stopping before {url}")
            break

        print(f"extracting: {url}")
        result, steps = tf.extract_from_listing(client, url, goal, RESTAURANT_LIST_SCHEMA)
        total_steps += steps
        if total_steps >= tf.STEP_BUDGET_WARN_AT:
            print(f"WARNING: ~{total_steps} steps used this run, approaching free-tier monthly cap")
        if not result:
            continue

        fetched_at = datetime.now(timezone.utc).isoformat()
        for raw in result.get("restaurants", []):
            if not raw.get("name") or not raw.get("address"):
                continue
            key = dedupe_key(raw)
            if key in seen_keys:
                continue
            seen_keys.add(key)
            poi = map_to_poi(raw, source_url=url, fetched_at=fetched_at)
            new_pois[poi["id"]] = poi
            if len(existing) + len(new_pois) >= limit:
                break

    print(f"extracted {len(new_pois)} new Thu Duc POI(s), {total_steps} TinyFish steps used this run")
    merged = {**existing, **new_pois}
    write_output(merged, out_path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=40, help="max total POIs to keep (default 40)")
    parser.add_argument("--sample", type=int, help="shortcut for a small verification run (overrides --limit)")
    parser.add_argument("--force", action="store_true", help="ignore existing output, start fresh")
    parser.add_argument("--out", type=str, default=None,
                         help="output path relative to data/thuduc/ (default thuduc_enrichment.json); "
                              "use raw/<name>.json to run alongside other scrapers in parallel")
    args = parser.parse_args()

    limit = args.sample if args.sample is not None else args.limit
    out_path = DATA_DIR / args.out if args.out else ENRICHMENT_PATH
    try:
        run(limit=limit, force=args.force, out_path=out_path)
    except RuntimeError as e:
        print(f"error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
