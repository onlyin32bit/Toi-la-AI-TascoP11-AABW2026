"""Lightweight resolver merging POI records from multiple Thu Duc sources.

Per-field rule: highest `confidence` wins (SYSTEM_FLOW.md "highest tier wins"); ties keep
the more recent `fetched_at`. This is a same-`id` merge only — cross-source entity
resolution (fuzzy name/geo matching when sources use different display names) is out of
scope for this pass, see phase-01 plan "Next Steps".
"""
PROVENANCE_FIELDS = (
    "name", "category", "cuisine_type", "address", "lat", "lon", "price_level",
    "avg_price_vnd", "rating", "review_count", "opening", "amenities", "car_parking",
    "description_raw",
)


def _better(a: dict, b: dict) -> dict:
    """Both are {value, source, confidence, fetched_at}; return the more trustworthy one."""
    if a.get("confidence", 0) != b.get("confidence", 0):
        return a if a.get("confidence", 0) > b.get("confidence", 0) else b
    return a if a.get("fetched_at", "") >= b.get("fetched_at", "") else b


def merge_poi(existing: dict | None, new: dict) -> dict:
    if existing is None:
        return new
    merged = dict(existing)
    for key in PROVENANCE_FIELDS:
        if existing.get(key) and new.get(key):
            merged[key] = _better(existing[key], new[key])
        else:
            merged[key] = new.get(key) or existing.get(key)

    for key in ("reviews",):
        seen_texts = {r["text"] for r in existing.get(key, [])}
        merged[key] = existing.get(key, []) + [r for r in new.get(key, []) if r["text"] not in seen_texts]

    for key in ("segments", "diet", "dishes", "strengths", "weaknesses", "dining_occasions"):
        merged[key] = new.get(key) or existing.get(key) or []

    merged["created_at"] = min(existing.get("created_at", new["created_at"]), new["created_at"])
    merged["source"] = f"{existing.get('source', '')}+{new.get('source', '')}"
    return merged
