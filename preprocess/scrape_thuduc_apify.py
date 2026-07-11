"""Scrape real restaurant data for Thu Duc district via Apify's Google Places actor.

PRIORITY source (Tier 3, confidence 0.80) — outranks scrape_thuduc.py's TinyFish/Foody
pass (Tier 4a, 0.60) in poi_resolver's per-field merge. Adds real GPS coordinates and
review text, which Foody listing pages don't expose. Writes to data/thuduc/ (committable).
Never touches engine/build/kb.json.

The Google Places actor allows only ONE `locationQuery` per run, so sub-area coverage
(Quận 2, Làng Đại Học, Khu Công Nghệ Cao) comes from naming the area in each search
term instead, under one broad Thu Duc City location.

For parallel runs, pass --out and --search-terms so each process writes its own shard
under data/thuduc/raw/ instead of racing on the shared thuduc_enrichment.json — then run
merge_thuduc.py to fold every shard together.

Usage:
    python scrape_thuduc_apify.py --sample 3
    python scrape_thuduc_apify.py --limit 60 --max-reviews 15
    python scrape_thuduc_apify.py --out raw/apify_batch1.json --search-terms "nhà hàng Thủ Đức,quán ăn Thủ Đức" --limit 40
"""
import argparse
import json
import pathlib
import sys
from datetime import datetime, timezone

from dotenv import load_dotenv

from apify_places_client import run_google_places
from apify_poi_mapper import map_place_to_poi, place_dedupe_key
from poi_provenance import DATA_DIR, ENRICHMENT_PATH
from poi_resolver import merge_poi

LOCATION_QUERY = "Thành phố Thủ Đức, Thành phố Hồ Chí Minh, Việt Nam"
SEARCH_TERMS = [
    "nhà hàng Thủ Đức",
    "quán ăn Thủ Đức",
    "quán cà phê Thủ Đức",
    "nhà hàng Quận 2 Thành phố Thủ Đức",
    "quán ăn ngon Quận 2 Thảo Điền An Phú",
    "quán ăn Làng Đại Học Thủ Đức",
    "quán ăn sinh viên Khu Công Nghệ Cao Quận 9",
    "nhà hàng Xa Lộ Hà Nội Thủ Đức",
]


def load_existing(out_path: pathlib.Path) -> dict:
    if out_path.exists():
        return json.loads(out_path.read_text(encoding="utf-8"))
    return {}


def write_output(pois: dict, out_path: pathlib.Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(pois, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {len(pois)} POIs -> {out_path}")


def run(limit: int, force: bool, max_reviews: int, out_path: pathlib.Path, search_terms: list[str]) -> None:
    load_dotenv(pathlib.Path(__file__).parent.parent / ".env")

    existing = {} if force else load_existing(out_path)
    print(f"starting with {len(existing)} existing POI(s) in {out_path.name}")

    per_search = max(1, (limit // len(search_terms)) + 2)  # small overfetch, dedupe handles overlap
    print(f"calling Apify Google Places actor: {search_terms} x{per_search} each, max_reviews={max_reviews}")
    places = run_google_places(search_terms, LOCATION_QUERY, max_per_search=per_search, max_reviews=max_reviews)
    print(f"received {len(places)} raw place(s) from Apify")

    fetched_at = datetime.now(timezone.utc).isoformat()
    seen_keys: set[str] = set()
    merged = dict(existing)
    added = 0

    for place in places:
        if not place.get("title") or not place.get("address"):
            continue
        key = place_dedupe_key(place)
        if key in seen_keys:
            continue
        seen_keys.add(key)

        poi = map_place_to_poi(place, fetched_at)
        merged[poi["id"]] = merge_poi(merged.get(poi["id"]), poi)
        added += 1
        if len(merged) >= limit:
            print(f"reached --limit {limit}, stopping")
            break

    print(f"processed {added} new place(s) from Apify")
    write_output(merged, out_path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=30, help="max total POIs to keep (default 30)")
    parser.add_argument("--sample", type=int, help="shortcut for a small verification run (overrides --limit)")
    parser.add_argument("--force", action="store_true", help="ignore existing output, start fresh")
    parser.add_argument("--max-reviews", type=int, default=15, help="reviews to pull per place (default 15)")
    parser.add_argument("--out", type=str, default=None,
                         help="output path relative to data/thuduc/ (default thuduc_enrichment.json); "
                              "use raw/<name>.json for parallel shard runs")
    parser.add_argument("--search-terms", type=str, default=None,
                         help="comma-separated override of the default search terms (for splitting work "
                              "across parallel processes)")
    args = parser.parse_args()

    limit = args.sample if args.sample is not None else args.limit
    out_path = DATA_DIR / args.out if args.out else ENRICHMENT_PATH
    search_terms = [t.strip() for t in args.search_terms.split(",")] if args.search_terms else SEARCH_TERMS
    try:
        run(limit=limit, force=args.force, max_reviews=args.max_reviews, out_path=out_path, search_terms=search_terms)
    except RuntimeError as e:
        print(f"error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
