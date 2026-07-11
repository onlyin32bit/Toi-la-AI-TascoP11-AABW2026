"""Generic Apify REST wrapper shared by all Thu Duc scrapers (Google Places, TikTok, Facebook).

Uses raw HTTP (not the apify-client SDK) — see apify_places_client.py's original note:
the installed apify-client version has a pydantic-model bug on this Python version that
breaks its `.get()`/actor-info helpers. The run-sync-get-dataset-items REST endpoint is
unaffected. Real API only, no mocks. Never logs/prints the API token.
"""
import json
import os
import urllib.error
import urllib.request


def make_token() -> str:
    token = os.environ.get("APIFY_TOKEN")
    if not token:
        raise RuntimeError("APIFY_TOKEN not set (check .env)")
    return token


def run_actor(actor_id: str, run_input: dict, timeout_s: int = 300) -> list[dict]:
    """Runs an Apify actor synchronously and returns its raw dataset items."""
    token = make_token()
    url = f"https://api.apify.com/v2/acts/{actor_id}/run-sync-get-dataset-items?timeout={timeout_s}"
    body = json.dumps(run_input).encode("utf-8")
    req = urllib.request.Request(
        url, data=body, method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_s + 30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"Apify run failed for {actor_id} ({e.code}): {detail}") from e
