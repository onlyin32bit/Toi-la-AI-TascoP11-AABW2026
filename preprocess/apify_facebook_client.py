"""Apify Facebook Search Scraper (apify~facebook-search-scraper) — Tier 4b buzz/signal source.

Never a hard fact — same tiering rationale as apify_tiktok_client.py.
"""
from apify_actor_client import run_actor

ACTOR_ID = "apify~facebook-search-scraper"


def run_facebook_search(categories: list[str], locations: list[str], results_limit: int = 10,
                         timeout_s: int = 300) -> list[dict]:
    run_input = {
        "categories": categories,
        "locations": locations,
        "resultsLimit": results_limit,
    }
    return run_actor(ACTOR_ID, run_input, timeout_s)
