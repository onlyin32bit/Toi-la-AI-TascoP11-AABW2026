"""CSV -> engine/build/kb.json (PLAN.md §5.1). Chạy 1 lần offline: python build_kb.py"""
import csv
import json
import pathlib

from taxonomy import (
    AMENITY_MAP,
    DIET_TAG_MAP,
    PRICE_MAP,
    SEGMENT_MAP,
    SENTIMENT_MAP,
    norm,
    split_csv_field,
    tokenize,
)

DATA_DIR = pathlib.Path(__file__).parent / "data"
OUT_PATH = pathlib.Path(__file__).parent.parent / "engine" / "build" / "kb.json"

POI_CSV = DATA_DIR / "ai_maps_track6_dataset_participants.xlsm - Restaurant POI Dataset.csv"
MENU_CSV = DATA_DIR / "ai_maps_track6_dataset_participants.xlsm - Menu Dataset.csv"
OCR_CSV = DATA_DIR / "ai_maps_track6_dataset_participants.xlsm - OCR Menu Dataset.csv"
REVIEWS_CSV = DATA_DIR / "ai_maps_track6_dataset_participants.xlsm - Restaurant Reviews.csv"

# Fields checked for POI quality_completeness (§5.1) — non-empty/non-zero counts as filled.
COMPLETENESS_FIELDS = [
    "address", "district", "cuisine_type", "avg_price_vnd", "opening_hours",
    "amenities_raw", "description_raw", "recommended_segments",
    "known_strengths", "known_weaknesses",
]


def read_csv(path: pathlib.Path) -> list[dict]:
    with open(path, encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def parse_opening_hours(raw: str) -> dict:
    open_s, close_s = raw.split("-")
    oh, om = (int(x) for x in open_s.split(":"))
    ch, cm = (int(x) for x in close_s.split(":"))
    open_min, close_min = oh * 60 + om, ch * 60 + cm
    return {"open_min": open_min, "close_min": close_min, "overnight": close_min <= open_min, "raw": raw}


def group_by_restaurant(rows: list[dict]) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = {}
    for row in rows:
        grouped.setdefault(row["restaurant_id"], []).append(row)
    return grouped


def build_dish(row: dict) -> dict:
    tags = [DIET_TAG_MAP.get(t, t) for t in split_csv_field(row["dietary_tags"])]
    if row["is_signature"].strip() == "Có":
        tags.append("signature")
    return {"name": row["dish_name"], "price_vnd": int(row["price_vnd"]), "tags": tags}


def infer_diet(poi_row: dict, dishes: list[dict], segments: list[str]) -> list[str]:
    diet = set()
    if poi_row["cuisine_type"] == "Chay" or poi_row["category"] == "Nhà hàng chay" or "vegetarian" in segments:
        diet.add("vegetarian")
    if poi_row["cuisine_type"] == "Halal":
        diet.add("halal")
    for dish in dishes:
        diet.update(t for t in dish["tags"] if t in ("vegetarian", "halal", "gluten_free"))
    return sorted(diet)


def build_review(row: dict) -> dict:
    return {
        "text": row["review_text"],
        "sentiment": SENTIMENT_MAP.get(row["sentiment_label"], "neu"),
        "aspects": split_csv_field(row["mentioned_aspects"]),
    }


def quality_completeness(poi_row: dict, dishes: list[dict], reviews: list[dict]) -> float:
    filled = sum(1 for f in COMPLETENESS_FIELDS if poi_row[f].strip())
    total = len(COMPLETENESS_FIELDS) + 2  # + dishes + reviews presence
    filled += bool(dishes) + bool(reviews)
    return round(filled / total, 2)


def build_poi(poi_row: dict, menu_by_res: dict, ocr_by_res: dict, reviews_by_res: dict) -> dict:
    res_id = poi_row["restaurant_id"]
    name = poi_row["restaurant_name"]
    dishes = [build_dish(r) for r in menu_by_res.get(res_id, [])]
    reviews = [build_review(r) for r in reviews_by_res.get(res_id, [])]
    segments = sorted({SEGMENT_MAP.get(s, norm(s)) for s in split_csv_field(poi_row["recommended_segments"])})
    amenities = sorted({AMENITY_MAP.get(a, norm(a)) for a in split_csv_field(poi_row["amenities_raw"])})
    ocr_rows = ocr_by_res.get(res_id, [])

    tokens = tokenize(name)
    for dish in dishes:
        tokens += tokenize(dish["name"])
    tokens = sorted(set(tokens))

    return {
        "id": f"poi:{res_id.lower()}",
        "restaurant_id": res_id,
        "name": name,
        "category": poi_row["category"],
        "cuisine_type": poi_row["cuisine_type"],
        "city": poi_row["city"],
        "district": poi_row["district"],
        "address": poi_row["address"],
        "lat": float(poi_row["latitude"]),
        "lon": float(poi_row["longitude"]),
        "price_level": PRICE_MAP.get(poi_row["price_level"], "mid"),
        "avg_price_vnd": int(poi_row["avg_price_vnd"]),
        "rating": float(poi_row["rating"]),
        "review_count": int(poi_row["review_count"]),
        "popularity": int(poi_row["popularity_score"]),
        "opening": parse_opening_hours(poi_row["opening_hours"]),
        "segments": segments,
        "amenities": amenities,
        "diet": infer_diet(poi_row, dishes, segments),
        "dishes": dishes,
        "strengths": split_csv_field(poi_row["known_strengths"]),
        "weaknesses": split_csv_field(poi_row["known_weaknesses"]),
        "quality": float(poi_row["poi_quality_score"]),
        "quality_completeness": quality_completeness(poi_row, dishes, reviews),
        # Filled offline by DEV3's summarize.py (§5.6) — placeholders kept for stable schema.
        "ai_summary": None,
        "sentiment": None,
        "cuisine_classification": None,
        "dining_occasions": [],
        "tokens": tokens,
        "known_entities": {
            "names": [norm(name)],
            "dishes": sorted({norm(d["name"]) for d in dishes}),
        },
        "raw_ocr_text": ocr_rows[0]["raw_ocr_text"] if ocr_rows else None,
        "reviews": reviews,
    }


def main() -> None:
    poi_rows = read_csv(POI_CSV)
    menu_by_res = group_by_restaurant(read_csv(MENU_CSV))
    ocr_by_res = group_by_restaurant(read_csv(OCR_CSV))
    reviews_by_res = group_by_restaurant(read_csv(REVIEWS_CSV))

    kb = [build_poi(row, menu_by_res, ocr_by_res, reviews_by_res) for row in poi_rows]

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(kb, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {len(kb)} POIs -> {OUT_PATH}")


if __name__ == "__main__":
    main()
