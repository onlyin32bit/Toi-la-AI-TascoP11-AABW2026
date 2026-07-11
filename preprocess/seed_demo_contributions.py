"""Demo UGC data — writes engine/build/contributions.json with a couple of
user-contributed POIs so the demo doesn't start from an empty UGC list.

- ugc:demo0001 sits ~15m from poi:res001 (Phở Bếp Nhà) with a near-identical
  name — a live demo of resolver.py's entity resolution (§S1) catching a
  duplicate submission of a restaurant already in the benchmark.
- ugc:demo0002 is a genuinely new restaurant (no match), showing the normal
  "UGC appears in /v1/recommend with source=user_contributed, verified=false"
  path.

Menus are intentionally left empty — attaching a menu photo (OCR) is meant to
be a *live* demo action (POST /v1/contribute/menu), not pre-seeded.

Run: python3 seed_demo_contributions.py   (after build_kb.py; safe to rerun —
overwrites contributions.json with just these two entries)
"""
import json
import pathlib
from datetime import datetime, timezone

from taxonomy import norm

BUILD_DIR = pathlib.Path(__file__).parent.parent / "engine" / "build"
OUT_PATH = BUILD_DIR / "contributions.json"

NOW = datetime.now(timezone.utc).isoformat()


def make_poi(id_, name, city, district, address, lat, lon, price_level, quality):
    return {
        "id": id_,
        "restaurant_id": id_,
        "name": name,
        "category": "Nhà hàng",
        "cuisine_type": "Việt Nam",
        "city": city,
        "district": district,
        "address": address,
        "lat": lat,
        "lon": lon,
        "price_level": price_level,
        "avg_price_vnd": 0,
        "rating": 0,
        "review_count": 0,
        "popularity": 0,
        "opening": {"open_min": 360, "close_min": 1320, "overnight": False, "raw": "06:00-22:00"},
        "segments": [],
        "amenities": [],
        "diet": [],
        "dishes": [],
        "strengths": [],
        "weaknesses": [],
        "quality": quality,
        "quality_completeness": 0,
        "ai_summary": None,
        "sentiment": None,
        "cuisine_classification": None,
        "dining_occasions": [],
        "tokens": [],
        "known_entities": {"names": [norm(name)], "dishes": []},
        "raw_ocr_text": None,
        "reviews": [],
        "source": "user_contributed",
        "verified": False,
        "created_at": NOW,
    }


CONTRIBUTIONS = [
    # Near-duplicate of poi:res001 (Phở Bếp Nhà, 21.040388, 105.844615) — offset
    # ~15m, name overlap 1.0 -> resolver.py's resolve_entities() should match it.
    make_poi(
        "ugc:demo0001", "Phở Bếp Nhà", "Hà Nội", "Hoàn Kiếm",
        "2 Trần Phú, Hoàn Kiếm, Hà Nội (do người dùng đóng góp)",
        21.040520, 105.844700, "budget", 0.6,
    ),
    # Genuinely new POI, no match in the benchmark.
    make_poi(
        "ugc:demo0002", "Bánh Xèo Cô Ba", "Đà Nẵng", "Hải Châu",
        "45 Nguyễn Văn Linh, Hải Châu, Đà Nẵng",
        16.047300, 108.212100, "budget", 0.65,
    ),
]


def main():
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(CONTRIBUTIONS, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {len(CONTRIBUTIONS)} demo UGC POIs -> {OUT_PATH}")


if __name__ == "__main__":
    main()
