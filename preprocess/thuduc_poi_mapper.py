"""Map raw TinyFish/Foody extraction dicts -> canonical POI schema w/ field provenance.

Mirrors preprocess/build_kb.py::build_poi() field shape, but every scraped (non-constant)
field is wrapped {value, source, confidence, fetched_at} per SYSTEM_FLOW.md Tier 4a
("agentic-facts", single-source, confidence 0.60). See plans/260712-0053-thuduc-restaurant-
scraping-tinyfish/phase-01-tinyfish-thuduc-scraper.md.
"""
import re

from poi_provenance import CITY, DISTRICT, dedupe_key as _dedupe_key, field as _base_field, slug
from taxonomy import AMENITY_MAP, PRICE_MAP, norm, split_csv_field, tokenize

SOURCE_TAG = "tinyfish:foody"
CONFIDENCE = 0.60

# JSON schema passed as TinyFish agent `output_schema` — one page yields many restaurants.
RESTAURANT_LIST_SCHEMA = {
    "type": "object",
    "properties": {
        "restaurants": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "address": {"type": "string"},
                    "category": {"type": "string"},
                    "cuisine_type": {"type": "string"},
                    "price_level_text": {"type": "string"},
                    "avg_price_vnd": {"type": "number", "nullable": True},
                    "rating": {"type": "number", "nullable": True},
                    "review_count": {"type": "integer", "nullable": True},
                    "opening_hours_raw": {"type": "string"},
                    "amenities": {"type": "array", "items": {"type": "string"}},
                    "car_parking": {"type": "boolean", "nullable": True},
                    "description": {"type": "string"},
                },
                "required": ["name", "address"],
            },
        }
    },
    "required": ["restaurants"],
}


def build_extraction_goal() -> str:
    return (
        "Tìm và trích xuất danh sách nhà hàng/quán ăn CÓ THẬT nằm ở Quận/Thành phố "
        "Thủ Đức, TP. Hồ Chí Minh, Việt Nam trên trang này. Với mỗi quán, lấy: tên, "
        "địa chỉ đầy đủ, loại hình (nhà hàng/quán ăn/quán cà phê...), loại ẩm thực, "
        "khoảng giá, điểm đánh giá (0-5), số lượt đánh giá, giờ mở cửa, tiện ích "
        "(wifi, máy lạnh, phòng riêng...), mô tả ngắn. "
        "QUAN TRỌNG — car_parking: xác định riêng xem quán có BÃI ĐỖ Ô TÔ hay không "
        "(khác với chỗ để xe máy) — true nếu có ghi rõ bãi đỗ ô tô/sân đỗ xe hơi/parking "
        "for cars, false nếu ghi rõ KHÔNG có hoặc chỉ có chỗ để xe máy, để trống/null nếu "
        "trang không đề cập. BỎ QUA quán không ở Thủ Đức. Không bịa số liệu — để trống "
        "nếu trang không có."
    )


def dedupe_key(raw: dict) -> str:
    return _dedupe_key(raw.get("name", ""), raw.get("address", ""))


def _field(value, fetched_at: str):
    return _base_field(value, SOURCE_TAG, CONFIDENCE, fetched_at)


def _infer_price_level(price_text: str, avg_price_vnd):
    mapped = PRICE_MAP.get((price_text or "").strip())
    if mapped:
        return mapped
    if isinstance(avg_price_vnd, (int, float)) and avg_price_vnd > 0:
        if avg_price_vnd < 100_000:
            return "budget"
        if avg_price_vnd < 300_000:
            return "mid"
        return "premium"
    return "mid"


def _parse_opening_hours(raw: str) -> dict:
    raw = (raw or "").strip()
    m = re.match(r"^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$", raw)
    if not m:
        return {"open_min": None, "close_min": None, "overnight": None, "raw": raw or None}
    oh, om, ch, cm = (int(x) for x in m.groups())
    open_min, close_min = oh * 60 + om, ch * 60 + cm
    return {"open_min": open_min, "close_min": close_min, "overnight": close_min <= open_min, "raw": raw}


def map_to_poi(raw: dict, source_url: str, fetched_at: str) -> dict:
    """raw: one item from RESTAURANT_LIST_SCHEMA's `restaurants` array."""
    name = raw.get("name", "").strip()
    amenities_raw = raw.get("amenities") or []
    if isinstance(amenities_raw, str):
        amenities_raw = split_csv_field(amenities_raw)
    amenities = sorted({AMENITY_MAP.get(a, norm(a)) for a in amenities_raw if a})

    avg_price_vnd = raw.get("avg_price_vnd")
    price_level = _infer_price_level(raw.get("price_level_text", ""), avg_price_vnd)

    tokens = tokenize(name)

    return {
        "id": f"real:{slug(name)}",
        "restaurant_id": None,
        "name": _field(name, fetched_at),
        "category": _field(raw.get("category") or None, fetched_at),
        "cuisine_type": _field(raw.get("cuisine_type") or None, fetched_at),
        "city": CITY,
        "district": DISTRICT,
        "address": _field(raw.get("address", "").strip(), fetched_at),
        "lat": _field(None, fetched_at),  # Foody listing pages don't expose coordinates
        "lon": _field(None, fetched_at),
        "price_level": _field(price_level, fetched_at),
        "avg_price_vnd": _field(avg_price_vnd, fetched_at),
        "rating": _field(raw.get("rating"), fetched_at),
        "review_count": _field(raw.get("review_count"), fetched_at),
        "popularity": None,
        "opening": _field(_parse_opening_hours(raw.get("opening_hours_raw", "")), fetched_at),
        "segments": [],
        "amenities": _field(amenities, fetched_at),
        "car_parking": _field(raw.get("car_parking"), fetched_at),
        "diet": [],
        "dishes": [],
        "strengths": [],
        "weaknesses": [],
        "quality": None,
        "quality_completeness": None,
        "ai_summary": None,
        "sentiment": None,
        "cuisine_classification": None,
        "dining_occasions": [],
        "tokens": tokens,
        "known_entities": {"names": [norm(name)], "dishes": []},
        "raw_ocr_text": None,
        "reviews": [],
        "description_raw": _field(raw.get("description") or None, fetched_at),
        "source": SOURCE_TAG,
        "source_url": source_url,
        "verified": False,
        "created_at": fetched_at,
    }
