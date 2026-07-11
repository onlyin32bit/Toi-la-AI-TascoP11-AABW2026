"""Thin wrapper around the TinyFish SDK for the Thu Duc scrape (Search -> Fetch -> Agent).

Real API only, no mocks. Never logs/prints the API key. See phase-01 plan for the
Search (free) -> Fetch precheck (free) -> Agent extraction (credits) budget rationale.
"""
import os
import time

import tinyfish

FOODY_DOMAIN = "foody.vn"
STEP_BUDGET_WARN_AT = 400  # free tier is 500 steps/mo; warn before exhausting it


def make_client() -> tinyfish.TinyFish:
    api_key = os.environ.get("TINYFISH_API_KEY")
    if not api_key:
        raise RuntimeError("TINYFISH_API_KEY not set (check .env)")
    return tinyfish.TinyFish(api_key=api_key)


def discover_listing_urls(client: tinyfish.TinyFish, queries: list[str], per_query: int = 10) -> list[str]:
    """Search-only (free), filtered to the Foody domain, deduped, order-preserved."""
    seen: dict[str, None] = {}
    for q in queries:
        try:
            resp = client.search.query(q, location="Ho Chi Minh City, Vietnam")
        except tinyfish.SDKError as e:
            print(f"  [search] query failed ({q!r}): {e}")
            continue
        for r in resp.results[:per_query]:
            if FOODY_DOMAIN in r.site_name.lower() or FOODY_DOMAIN in r.url.lower():
                seen.setdefault(r.url, None)
    return list(seen.keys())


def precheck_mentions_thuduc(client: tinyfish.TinyFish, urls: list[str]) -> list[str]:
    """Free Fetch call to drop pages that clearly don't mention Thu Duc before spending
    Agent credits on them."""
    if not urls:
        return []
    kept = []
    try:
        resp = client.fetch.get_contents(urls[:10], format="markdown")
    except tinyfish.SDKError as e:
        print(f"  [fetch] precheck failed: {e}")
        return urls  # fail open — let the Agent step decide
    for r in resp.results:
        text = (r.text or "") + (r.title or "")
        if "thủ đức" in text.lower() or "thu duc" in text.lower():
            kept.append(r.url)
    for err in resp.errors:
        print(f"  [fetch] {err.url}: {err.error if hasattr(err, 'error') else err}")
    return kept


def extract_from_listing(client: tinyfish.TinyFish, url: str, goal: str, schema: dict,
                          max_retries: int = 2) -> tuple[dict | None, int]:
    """Agent extraction (costs credits). Returns (result_dict_or_None, steps_used)."""
    for attempt in range(max_retries + 1):
        try:
            resp = client.agent.run(goal=goal, url=url, output_schema=schema)
        except tinyfish.RateLimitError as e:
            wait = getattr(e, "retry_after", None) or (2 ** attempt * 5)
            print(f"  [agent] rate limited on {url}, retrying in {wait}s")
            time.sleep(wait)
            continue
        except (tinyfish.APIConnectionError, tinyfish.APITimeoutError) as e:
            print(f"  [agent] transient error on {url}: {e} (attempt {attempt + 1})")
            time.sleep(2 ** attempt * 3)
            continue
        except tinyfish.SDKError as e:
            print(f"  [agent] giving up on {url}: {e}")
            return None, 0

        if resp.status != tinyfish.RunStatus.COMPLETED or resp.result is None:
            reason = resp.error.message if resp.error else resp.status
            print(f"  [agent] {url} did not complete: {reason}")
            return None, resp.num_of_steps
        return resp.result, resp.num_of_steps

    print(f"  [agent] exhausted retries on {url}")
    return None, 0
