"""Build a demo map KB containing every geolocated cached Thu Duc POI.

This target is intentionally separate from the verification-gated publication
KB. It makes the complete scraped corpus visible for coverage inspection while
marking every record unverified. It never changes thuduc_resolved.json or the
strict thuduc_kb.json.
"""
import json
import pathlib

from compile_thuduc_kb import _flatten, load_buzz_scores
from poi_provenance import ENRICHMENT_PATH

OUT_DIR = pathlib.Path(__file__).parent.parent / "engine" / "build" / "thuduc"
OUT_PATH = OUT_DIR / "kb.json"
UNLOCATED_PATH = OUT_DIR / "unlocated.json"


def compile_map_poi(poi: dict, buzz_score: float | None) -> dict:
    flat = {key: _flatten(value) for key, value in poi.items()}
    flat["buzz_score"] = buzz_score
    flat["verified"] = False
    flat["source"] = poi.get("source") or "thuduc_cached_scrape"
    return flat


def main() -> None:
    if not ENRICHMENT_PATH.exists():
        raise SystemExit(f"{ENRICHMENT_PATH} not found — run the Thu Duc scrapers first")
    enrichment = json.loads(ENRICHMENT_PATH.read_text(encoding="utf-8"))
    buzz = load_buzz_scores()
    compiled = {poi_id: compile_map_poi(poi, buzz.get(poi_id))
                for poi_id, poi in enrichment.items()}
    geolocated_ids = {
        poi_id for poi_id, poi in compiled.items()
        if isinstance(poi.get("lat"), (int, float))
        and isinstance(poi.get("lon"), (int, float))
        and poi["lat"] != 0 and poi["lon"] != 0
    }
    kb = [poi for poi_id, poi in compiled.items() if poi_id in geolocated_ids]
    unlocated = [
        {"poi_id": poi_id, "name": poi.get("name"), "address": poi.get("address"),
         "reason": "missing_coordinates"}
        for poi_id, poi in compiled.items() if poi_id not in geolocated_ids
    ]
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(kb, ensure_ascii=False, indent=2), encoding="utf-8")
    UNLOCATED_PATH.write_text(json.dumps(unlocated, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"loaded {len(kb)} unverified, geolocated Thu Duc POIs for map demo -> {OUT_PATH}")
    if unlocated:
        print(f"flagged {len(unlocated)} POIs without coordinates -> {UNLOCATED_PATH}")


if __name__ == "__main__":
    main()
