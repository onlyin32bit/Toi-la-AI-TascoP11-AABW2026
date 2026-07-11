"""Shared provenance/slug helpers for Thu Duc enrichment mappers (TinyFish + Apify).

Field-provenance shape and tiering follow resources/engine/SYSTEM_FLOW.md:
Tier 3 (Apify/Google Places, confidence 0.80) vs Tier 4a (TinyFish/Foody agentic, 0.60).
"""
import pathlib
import re

from taxonomy import norm

CITY = "TP. Hồ Chí Minh"
DISTRICT = "Thủ Đức"

# Committable location (unlike engine/build/, data/ is not gitignored).
DATA_DIR = pathlib.Path(__file__).parent.parent / "data" / "thuduc"
ENRICHMENT_PATH = DATA_DIR / "thuduc_enrichment.json"
SIGNALS_PATH = DATA_DIR / "thuduc_signals.json"
KB_PATH = DATA_DIR / "thuduc_kb.json"

# Parallel scrape runs each write their own shard here (avoids racing on ENRICHMENT_PATH);
# merge_thuduc.py folds every shard + the existing ENRICHMENT_PATH back into one file.
RAW_DIR = DATA_DIR / "raw"


def field(value, source: str, confidence: float, fetched_at: str) -> dict:
    return {"value": value, "source": source, "confidence": confidence, "fetched_at": fetched_at}


def slug(name: str, district: str = DISTRICT) -> str:
    base = norm(name) + "-" + norm(district)
    return re.sub(r"[^a-z0-9]+", "-", base).strip("-")


def dedupe_key(name: str, address: str) -> str:
    return f"{norm(name)}|{norm(address)[:24]}"
