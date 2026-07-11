"""Apify TikTok Scraper (clockworks~tiktok-scraper) — Tier 4b buzz/signal source.

Never a hard fact per resources/engine/SYSTEM_FLOW.md's tiering — feeds personalization
"buzz" scoring only, never overrides a structured field from Google Places/Foody.
"""
from apify_actor_client import run_actor

ACTOR_ID = "clockworks~tiktok-scraper"


def run_tiktok_search(search_queries: list[str], results_per_page: int = 10,
                       timeout_s: int = 300) -> list[dict]:
    run_input = {
        "searchQueries": search_queries,
        "searchSection": "/video",
        "resultsPerPage": results_per_page,
        "shouldDownloadVideos": False,
        "shouldDownloadCovers": False,
        "shouldDownloadSubtitles": False,
        "shouldDownloadSlideshowImages": False,
        "shouldDownloadAvatars": False,
        "shouldDownloadMusicCovers": False,
    }
    return run_actor(ACTOR_ID, run_input, timeout_s)
