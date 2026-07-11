"""Map raw TikTok/Facebook items -> Tier 4b "signal" records (buzz only, never a POI fact).

Per resources/engine/SYSTEM_FLOW.md: Tier 4b sources (TikTok, FB Page) feed
personalization/"buzz" scoring only — they never enter the POI resolver as facts,
unlike Tier 3 (Apify Google Places) or Tier 4a (TinyFish/Foody). See poi_resolver.py.
"""
import json

from poi_provenance import ENRICHMENT_PATH
from taxonomy import norm

TIKTOK_CONFIDENCE = 0.40
FACEBOOK_CONFIDENCE = 0.45


def load_known_pois() -> dict[str, str]:
    """{normalized restaurant name: poi id} from the already-scraped enrichment set,
    used for best-effort linking of a signal to a specific known POI."""
    if not ENRICHMENT_PATH.exists():
        return {}
    data = json.loads(ENRICHMENT_PATH.read_text(encoding="utf-8"))
    return {norm(poi["name"]["value"]): poi_id for poi_id, poi in data.items() if poi.get("name", {}).get("value")}


def match_pois(text: str, known: dict[str, str]) -> list[str]:
    haystack = norm(text)
    return [poi_id for name_norm, poi_id in known.items() if name_norm and name_norm in haystack]


def map_tiktok_item(item: dict, known: dict[str, str], fetched_at: str) -> dict:
    text = item.get("text", "")
    author = item.get("authorMeta", {}) or {}
    return {
        "platform": "tiktok",
        "signal_id": f"tiktok:{item.get('id')}",
        "text": text,
        "url": item.get("webVideoUrl"),
        "engagement": {
            "likes": item.get("diggCount"),
            "comments": item.get("commentCount"),
            "shares": item.get("shareCount"),
            "views": item.get("playCount"),
        },
        "author": author.get("name"),
        "published_at": item.get("createTimeISO"),
        "matched_poi_ids": match_pois(text + " " + author.get("signature", ""), known),
        "source": "apify:tiktok",
        "confidence": TIKTOK_CONFIDENCE,
        "fetched_at": fetched_at,
    }


def map_facebook_item(item: dict, known: dict[str, str], fetched_at: str) -> dict:
    text = " ".join([item.get("title", ""), *(item.get("info") or []), item.get("intro") or ""])
    return {
        "platform": "facebook",
        "signal_id": f"facebook:{item.get('pageId')}",
        "text": text.strip(),
        "url": item.get("facebookUrl"),
        "engagement": {
            "likes": item.get("likes"),
            "followers": item.get("followers"),
            "rating_percent": item.get("ratingOverall"),
            "rating_count": item.get("ratingCount"),
        },
        "address": item.get("address"),
        "phone": item.get("phone"),
        "published_at": item.get("creation_date"),
        "matched_poi_ids": match_pois(text, known),
        "source": "apify:facebook_search",
        "confidence": FACEBOOK_CONFIDENCE,
        "fetched_at": fetched_at,
    }
