"""Map raw Apify Google-Places dataset items -> canonical POI schema w/ provenance.

Tier 3 ("licensed-API/CSV/OSM/Google-Places-via-Apify", confidence 0.80) per
resources/engine/SYSTEM_FLOW.md — higher trust than TinyFish/Foody's Tier 4a (0.60).
Ground-truth field names verified against a real actor call (compass~crawler-google-places),
not guessed from docs.
"""
import re

from poi_provenance import CITY, DISTRICT, dedupe_key, field, slug
from taxonomy import norm, tokenize

SOURCE_TAG = "apify:google_places"
CONFIDENCE = 0.80

_PRICE_RANGE_RE = re.compile(r"(\d[\d.,]*)\s*[-–]\s*(\d[\d.,]*)\s*N")  # e.g. "200-800 N ₫"


def _f(value, fetched_at: str):
    return field(value, SOURCE_TAG, CONFIDENCE, fetched_at)


def _parse_avg_price_vnd(price_text: str):
    """Google's 'price' field is often like '200-800 N ₫' (N = nghìn/thousand)."""
    m = _PRICE_RANGE_RE.search(price_text or "")
    if not m:
        return None
    lo = float(m.group(1).replace(",", "").replace(".", ""))
    hi = float(m.group(2).replace(",", "").replace(".", ""))
    return int((lo + hi) / 2 * 1000)


def _price_level_from_avg(avg_price_vnd):
    if not isinstance(avg_price_vnd, (int, float)) or avg_price_vnd <= 0:
        return "mid"
    if avg_price_vnd < 100_000:
        return "budget"
    if avg_price_vnd < 300_000:
        return "mid"
    return "premium"


def _most_common_hours(opening_hours: list) -> str:
    """openingHours is per-day [{day, hours}]; collapse to the most frequent range."""
    if not opening_hours:
        return ""
    counts: dict[str, int] = {}
    for row in opening_hours:
        h = (row.get("hours") or "").strip()
        if h and h.lower() != "closed":
            counts[h] = counts.get(h, 0) + 1
    if not counts:
        return ""
    return max(counts, key=counts.get)


def _parse_opening_hours(opening_hours: list) -> dict:
    raw = _most_common_hours(opening_hours)
    m = re.match(r"^(\d{1,2}):(\d{2})\s*(?:to|-)\s*(\d{1,2}):(\d{2})$", raw)
    if not m:
        return {"open_min": None, "close_min": None, "overnight": None, "raw": raw or None}
    oh, om, ch, cm = (int(x) for x in m.groups())
    open_min, close_min = oh * 60 + om, ch * 60 + cm
    return {"open_min": open_min, "close_min": close_min, "overnight": close_min <= open_min, "raw": raw}


def _car_parking(additional_info: dict):
    """Google's 'additionalInfo' groups amenities by localized category name; the Vietnamese
    UI groups parking mentions under 'Bãi đỗ xe'. Google doesn't split car vs. motorbike, so
    presence of any true entry is treated as a (weaker, Tier 3) car-parking signal, never a
    fabricated False — absence of the whole group means "unknown", not "no parking"."""
    group = (additional_info or {}).get("Bãi đỗ xe")
    if not group:
        return None
    return any(v for entry in group for v in entry.values())


def _amenities_from_additional_info(additional_info: dict) -> list[str]:
    tags = []
    for group_name, entries in (additional_info or {}).items():
        if group_name == "Bãi đỗ xe":
            continue  # promoted to its own car_parking field instead
        for entry in entries:
            tags.extend(norm(label) for label, present in entry.items() if present)
    return sorted(set(tags))


def _map_review(raw_review: dict) -> dict:
    stars = raw_review.get("stars")
    sentiment = "pos" if isinstance(stars, int) and stars >= 4 else \
        "neg" if isinstance(stars, int) and stars <= 2 else "neu"
    return {
        "text": raw_review.get("text") or raw_review.get("textTranslated") or "",
        "sentiment": sentiment,
        "aspects": sorted((raw_review.get("reviewDetailedRating") or {}).keys()),
    }


def map_place_to_poi(place: dict, fetched_at: str) -> dict:
    name = (place.get("title") or "").strip()
    address = (place.get("address") or "").strip()
    avg_price_vnd = _parse_avg_price_vnd(place.get("price") or "")
    location = place.get("location") or {}
    additional_info = place.get("additionalInfo") or {}

    return {
        "id": f"real:{slug(name)}",
        "restaurant_id": None,
        "name": _f(name, fetched_at),
        "category": _f(place.get("categoryName") or None, fetched_at),
        "cuisine_type": _f(", ".join(place.get("categories") or []) or None, fetched_at),
        "city": CITY,
        "district": DISTRICT,
        "address": _f(address, fetched_at),
        "lat": _f(location.get("lat"), fetched_at),
        "lon": _f(location.get("lng"), fetched_at),
        "price_level": _f(_price_level_from_avg(avg_price_vnd), fetched_at),
        "avg_price_vnd": _f(avg_price_vnd, fetched_at),
        "rating": _f(place.get("totalScore"), fetched_at),
        "review_count": _f(place.get("reviewsCount"), fetched_at),
        "popularity": None,
        "opening": _f(_parse_opening_hours(place.get("openingHours") or []), fetched_at),
        "segments": [],
        "amenities": _f(_amenities_from_additional_info(additional_info), fetched_at),
        "car_parking": _f(_car_parking(additional_info), fetched_at),
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
        "tokens": tokenize(name),
        "known_entities": {"names": [norm(name)], "dishes": []},
        "raw_ocr_text": None,
        "reviews": [_map_review(r) for r in (place.get("reviews") or [])],
        "description_raw": _f(place.get("description") or None, fetched_at),
        "source": SOURCE_TAG,
        "source_url": place.get("url"),
        "verified": False,
        "created_at": fetched_at,
    }


def place_dedupe_key(place: dict) -> str:
    return dedupe_key(place.get("title") or "", place.get("address") or "")
