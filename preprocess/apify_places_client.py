"""Apify Google Maps Places actor (compass~crawler-google-places) — PRIORITY source (Tier 3)."""
from apify_actor_client import run_actor

ACTOR_ID = "compass~crawler-google-places"


def run_google_places(search_terms: list[str], location_query: str, max_per_search: int = 10,
                       max_reviews: int = 5, timeout_s: int = 300) -> list[dict]:
    """Runs the actor synchronously and returns the raw place dataset items."""
    run_input = {
        "searchStringsArray": search_terms,
        "locationQuery": location_query,
        "maxCrawledPlacesPerSearch": max_per_search,
        "language": "vi",
        "maxReviews": max_reviews,
        "skipClosedPlaces": True,
    }
    return run_actor(ACTOR_ID, run_input, timeout_s)
