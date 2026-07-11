"""Scrape TikTok + Facebook buzz signals for Thu Duc restaurants via Apify.

Tier 4b — never a POI fact, only a personalization/buzz signal (see signals_mapper.py).
Writes data/thuduc/thuduc_signals.json, separate from thuduc_enrichment.json. Real API
calls only, no mocks.

Usage:
    python scrape_thuduc_signals.py --sample 5
    python scrape_thuduc_signals.py --tiktok-limit 60 --facebook-limit 30
"""
import argparse
import json
import pathlib
import sys
from datetime import datetime, timezone

from dotenv import load_dotenv

from apify_facebook_client import run_facebook_search
from apify_tiktok_client import run_tiktok_search
from poi_provenance import SIGNALS_PATH
from signals_mapper import load_known_pois, map_facebook_item, map_tiktok_item

TIKTOK_QUERIES = [
    "quán ăn Thủ Đức", "quán ăn ngon Thủ Đức", "review Thủ Đức",
    "quán ăn Làng Đại Học", "cà phê Thủ Đức", "quán ăn Quận 2",
]
FACEBOOK_CATEGORIES = ["quán ăn ngon Thủ Đức", "nhà hàng Quận 2", "quán cà phê Làng Đại Học"]
FACEBOOK_LOCATIONS = ["Thủ Đức, Hồ Chí Minh", "Quận 2, Hồ Chí Minh"]


def load_existing() -> dict:
    if SIGNALS_PATH.exists():
        return json.loads(SIGNALS_PATH.read_text(encoding="utf-8"))
    return {}


def write_output(signals: dict) -> None:
    SIGNALS_PATH.parent.mkdir(parents=True, exist_ok=True)
    SIGNALS_PATH.write_text(json.dumps(signals, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {len(signals)} signal(s) -> {SIGNALS_PATH}")


def run(tiktok_limit: int, facebook_limit: int, force: bool) -> None:
    load_dotenv(pathlib.Path(__file__).parent.parent / ".env")
    known = load_known_pois()
    print(f"loaded {len(known)} known POI name(s) for signal linking")

    merged = {} if force else load_existing()
    fetched_at = datetime.now(timezone.utc).isoformat()

    if tiktok_limit > 0:
        per_query = max(1, (tiktok_limit // len(TIKTOK_QUERIES)) + 1)
        print(f"calling TikTok Scraper: {TIKTOK_QUERIES} x{per_query} each")
        videos = run_tiktok_search(TIKTOK_QUERIES, results_per_page=per_query)
        print(f"received {len(videos)} raw TikTok video(s)")
        added = 0
        for v in videos:
            if not v.get("id"):
                continue
            sig = map_tiktok_item(v, known, fetched_at)
            merged[sig["signal_id"]] = sig
            added += 1
        print(f"added {added} TikTok signal(s)")

    if facebook_limit > 0:
        print(f"calling Facebook Search Scraper: {FACEBOOK_CATEGORIES} @ {FACEBOOK_LOCATIONS}")
        pages = run_facebook_search(FACEBOOK_CATEGORIES, FACEBOOK_LOCATIONS, results_limit=facebook_limit)
        print(f"received {len(pages)} raw Facebook page(s)")
        added = 0
        for p in pages:
            if not p.get("pageId"):
                continue
            sig = map_facebook_item(p, known, fetched_at)
            merged[sig["signal_id"]] = sig
            added += 1
        print(f"added {added} Facebook signal(s)")

    linked = sum(1 for s in merged.values() if s.get("matched_poi_ids"))
    print(f"total {len(merged)} signal(s), {linked} linked to a known POI")
    write_output(merged)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tiktok-limit", type=int, default=60, help="TikTok videos to fetch (default 60)")
    parser.add_argument("--facebook-limit", type=int, default=30, help="FB pages to fetch (default 30)")
    parser.add_argument("--sample", type=int, help="shortcut: small run for both platforms (overrides limits)")
    parser.add_argument("--force", action="store_true", help="ignore existing output, start fresh")
    args = parser.parse_args()

    tiktok_limit = args.sample if args.sample is not None else args.tiktok_limit
    facebook_limit = args.sample if args.sample is not None else args.facebook_limit
    try:
        run(tiktok_limit=tiktok_limit, facebook_limit=facebook_limit, force=args.force)
    except RuntimeError as e:
        print(f"error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
