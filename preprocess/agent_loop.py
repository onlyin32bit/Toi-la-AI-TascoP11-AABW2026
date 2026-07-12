"""Verification-first, per-POI enrichment agent.

This is the executable Goal -> Plan -> Tools -> Act -> Verify loop described in
FINAL_PITCH.pdf.  The loop is deliberately policy-driven rather than LLM-driven:
planning is a testable decision over missing/unverified fields, tools are selected
by declared capabilities, and a fact is publishable only when two independent
sources agree.  A source failure or disagreement causes the agent to try another
eligible tool; exhausted fields are refused and explicitly flagged.

The default CLI uses the already-fetched Apify/Google and TinyFish/Foody shards in
data/thuduc/raw, so it is deterministic and demo-safe.  ``--live`` swaps in the
real network-backed versions of those same tools.

Examples:
    python3 agent_loop.py --poi-id real:some-id --dry-run
    python3 agent_loop.py --limit 10
    python3 agent_loop.py --live --poi-id real:some-id
"""
from __future__ import annotations

import argparse
import json
import math
import pathlib
import re
import sys
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Protocol

from poi_provenance import DATA_DIR, ENRICHMENT_PATH, RAW_DIR
from resolver import name_similarity
from taxonomy import norm

CONSENSUS_MIN = 2
AGENT_RUNS_PATH = DATA_DIR / "thuduc_agent_runs.json"
EPOCH = "1970-01-01T00:00:00+00:00"

# Facts the current source adapters can genuinely observe.  Empty list values are
# missing, not verified negatives.  Social buzz stays outside this fact resolver.
FACT_FIELDS = (
    "name", "category", "cuisine_type", "address", "lat", "lon",
    "price_level", "avg_price_vnd", "rating", "review_count", "opening",
    "amenities", "car_parking", "dishes", "diet", "description_raw",
)
GOOGLE_FIELDS = frozenset(FACT_FIELDS)
FOODY_FIELDS = frozenset(set(FACT_FIELDS) - {"lat", "lon"})


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def is_present(value: Any) -> bool:
    return value not in (None, "", [], {})


def unwrap(value: Any) -> Any:
    if isinstance(value, dict) and "value" in value and "source" in value:
        return value.get("value")
    return value


def source_of(value: Any) -> str:
    if isinstance(value, dict):
        return str(value.get("source") or "")
    return ""


def source_url_for(poi: dict, source: str) -> str | None:
    source_url = poi.get("source_url")
    if not source_url:
        return None
    url_norm = str(source_url).lower()
    expected_domain = {
        "apify:google_places": "google.",
        "tinyfish:foody": "foody.",
    }.get(source)
    return str(source_url) if expected_domain is None or expected_domain in url_norm else None


def canonical(value: Any) -> Any:
    """Normalize values for conservative cross-source equality checks."""
    if isinstance(value, str):
        return norm(value)
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, (int, float)):
        return round(float(value), 3)
    if isinstance(value, list):
        return tuple(sorted(canonical(v) for v in value))
    if isinstance(value, dict):
        # Source formatting differs, but the parsed opening interval is stable.
        if {"open_min", "close_min"}.issubset(value):
            return (value.get("open_min"), value.get("close_min"), value.get("overnight"))
        return tuple(sorted((k, canonical(v)) for k, v in value.items() if k != "raw"))
    return str(value)


def values_agree(field_name: str, left: Any, right: Any) -> bool:
    if not is_present(left) or not is_present(right):
        return False
    if field_name in {"lat", "lon"}:
        return math.isclose(float(left), float(right), abs_tol=0.0005)
    if field_name == "rating":
        return math.isclose(float(left), float(right), abs_tol=0.15)
    if field_name == "avg_price_vnd":
        hi = max(abs(float(left)), abs(float(right)), 1.0)
        return abs(float(left) - float(right)) / hi <= 0.10
    if field_name == "name":
        return name_similarity(str(left), str(right)) >= 0.75
    if field_name == "address":
        # Formatting varies ("P." vs "Phường", "TP.HCM" vs full city name).
        # Require the same street number plus strong overlap of meaningful
        # address tokens; this is conservative enough not to merge branches.
        stop = {"p", "phuong", "q", "quan", "tp", "thanh", "pho", "thu", "duc",
                "hcm", "ho", "chi", "minh", "viet", "nam"}
        lt = [t for t in re.findall(r"[a-z0-9]+", norm(str(left))) if t not in stop]
        rt = [t for t in re.findall(r"[a-z0-9]+", norm(str(right))) if t not in stop]
        ln = [t for t in lt if t.isdigit()]
        rn = [t for t in rt if t.isdigit()]
        if not ln or not rn or ln[0] != rn[0]:
            return False
        ls, rs = set(lt), set(rt)
        return len(ls & rs) / max(1, len(ls | rs)) >= 0.45
    return canonical(left) == canonical(right)


@dataclass(frozen=True)
class Candidate:
    field: str
    value: Any
    source: str
    confidence: float
    fetched_at: str
    source_url: str | None = None


@dataclass
class ToolResult:
    tool: str
    source: str
    found: bool
    candidates: list[Candidate] = field(default_factory=list)
    error: str | None = None


class SourceTool(Protocol):
    name: str
    source: str
    supported_fields: frozenset[str]

    def fetch(self, poi: dict, fields: set[str]) -> ToolResult: ...


@dataclass
class PlanStep:
    tool: str
    source: str
    fields: list[str]
    reason: str
    status: str = "planned"


def candidates_from_poi(poi: dict, allowed_fields: set[str], expected_source: str) -> list[Candidate]:
    out: list[Candidate] = []
    source_url = source_url_for(poi, expected_source)
    for field_name in allowed_fields:
        wrapper = poi.get(field_name)
        value = unwrap(wrapper)
        if not is_present(value):
            continue
        source = source_of(wrapper) or expected_source
        # Never let a shard masquerade as a different independent source.
        if source != expected_source:
            continue
        out.append(Candidate(
            field=field_name,
            value=value,
            source=source,
            confidence=float(wrapper.get("confidence", 0.5)) if isinstance(wrapper, dict) else 0.5,
            fetched_at=str(wrapper.get("fetched_at") or EPOCH) if isinstance(wrapper, dict) else EPOCH,
            source_url=source_url,
        ))
    return out


class CachedSourceTool:
    """One logical source backed by one or more local scrape shards."""

    def __init__(self, name: str, source: str, paths: list[pathlib.Path],
                 supported_fields: frozenset[str]):
        self.name = name
        self.source = source
        self.supported_fields = supported_fields
        self.records: dict[str, dict] = {}
        for path in paths:
            if not path.exists():
                continue
            for poi_id, poi in json.loads(path.read_text(encoding="utf-8")).items():
                # Multiple Apify shards are one underlying source, never extra votes.
                previous = self.records.get(poi_id)
                if previous is None or str(poi.get("created_at", "")) >= str(previous.get("created_at", "")):
                    self.records[poi_id] = poi

    def _match(self, target: dict) -> dict | None:
        if target.get("id") in self.records:
            return self.records[target["id"]]
        target_name = str(unwrap(target.get("name")) or "")
        target_address = norm(str(unwrap(target.get("address")) or ""))
        best: dict | None = None
        best_score = 0.0
        for record in self.records.values():
            score = name_similarity(target_name, str(unwrap(record.get("name")) or ""))
            if target_address:
                address = norm(str(unwrap(record.get("address")) or ""))
                if target_address in address or address in target_address:
                    score += 0.25
            if score > best_score:
                best, best_score = record, score
        return best if best_score >= 0.75 else None

    def fetch(self, poi: dict, fields: set[str]) -> ToolResult:
        match = self._match(poi)
        if match is None:
            return ToolResult(self.name, self.source, False)
        candidates = candidates_from_poi(match, fields, self.source)
        return ToolResult(self.name, self.source, bool(candidates), candidates)


class LiveGooglePlacesTool:
    name = "apify_google_places"
    source = "apify:google_places"
    supported_fields = GOOGLE_FIELDS

    def fetch(self, poi: dict, fields: set[str]) -> ToolResult:
        from apify_places_client import run_google_places
        from apify_poi_mapper import map_place_to_poi

        name = str(unwrap(poi.get("name")) or "")
        address = str(unwrap(poi.get("address")) or "")
        query = ", ".join(x for x in (name, address) if x)
        try:
            places = run_google_places([query], "Thành phố Thủ Đức, TP. Hồ Chí Minh, Việt Nam",
                                       max_per_search=3, max_reviews=5, timeout_s=120)
        except Exception as exc:  # SDK/network errors become retryable tool failures.
            return ToolResult(self.name, self.source, False, error=str(exc))
        if not places:
            return ToolResult(self.name, self.source, False)
        best = max(places, key=lambda p: name_similarity(name, str(p.get("title") or "")))
        if name_similarity(name, str(best.get("title") or "")) < 0.5:
            return ToolResult(self.name, self.source, False)
        mapped = map_place_to_poi(best, utcnow())
        return ToolResult(self.name, self.source, True,
                          candidates_from_poi(mapped, fields, self.source))


class LiveFoodyTool:
    name = "tinyfish_foody"
    source = "tinyfish:foody"
    supported_fields = FOODY_FIELDS

    def fetch(self, poi: dict, fields: set[str]) -> ToolResult:
        import tinyfish_client as tf
        from thuduc_poi_mapper import RESTAURANT_LIST_SCHEMA, build_extraction_goal, map_to_poi

        name = str(unwrap(poi.get("name")) or "")
        address = str(unwrap(poi.get("address")) or "")
        try:
            client = tf.make_client()
            urls = tf.discover_listing_urls(client, [f'"{name}" {address} Foody'], per_query=5)
            urls = tf.precheck_mentions_thuduc(client, urls)
        except Exception as exc:
            return ToolResult(self.name, self.source, False, error=str(exc))
        best_poi = None
        best_score = 0.0
        for url in urls[:3]:
            result, _ = tf.extract_from_listing(client, url, build_extraction_goal(), RESTAURANT_LIST_SCHEMA)
            for raw in (result or {}).get("restaurants", []):
                score = name_similarity(name, str(raw.get("name") or ""))
                if score > best_score:
                    best_score = score
                    best_poi = map_to_poi(raw, url, utcnow())
        if best_poi is None or best_score < 0.5:
            return ToolResult(self.name, self.source, False)
        return ToolResult(self.name, self.source, True,
                          candidates_from_poi(best_poi, fields, self.source))


def default_cached_tools() -> list[SourceTool]:
    apify_paths = sorted(RAW_DIR.glob("apify*.json"))
    tinyfish_paths = sorted(RAW_DIR.glob("tinyfish*.json"))
    return [
        CachedSourceTool("apify_google_places_cache", "apify:google_places",
                         apify_paths, GOOGLE_FIELDS),
        CachedSourceTool("tinyfish_foody_cache", "tinyfish:foody",
                         tinyfish_paths, FOODY_FIELDS),
    ]


def resolve_consensus(candidates: list[Candidate], minimum: int = CONSENSUS_MIN) -> dict | None:
    """Return a winner only when independent sources agree on the value."""
    groups: list[list[Candidate]] = []
    for candidate in candidates:
        placed = False
        for group in groups:
            if values_agree(candidate.field, candidate.value, group[0].value):
                group.append(candidate)
                placed = True
                break
        if not placed:
            groups.append([candidate])
    eligible = []
    for group in groups:
        by_source = {candidate.source: candidate for candidate in group}
        if len(by_source) >= minimum:
            eligible.append(list(by_source.values()))
    if not eligible:
        return None
    winner_group = max(eligible, key=lambda g: (len(g), sum(c.confidence for c in g)))
    representative = max(winner_group, key=lambda c: (c.confidence, c.fetched_at))
    return {
        "value": representative.value,
        "verified": True,
        "consensus_count": len(winner_group),
        "confidence": round(sum(c.confidence for c in winner_group) / len(winner_group), 3),
        "sources": [
            {"source": c.source, "confidence": c.confidence, "fetched_at": c.fetched_at,
             "source_url": c.source_url}
            for c in sorted(winner_group, key=lambda item: item.source)
        ],
    }


class EnrichmentAgent:
    def __init__(self, tools: list[SourceTool], consensus_min: int = CONSENSUS_MIN):
        self.tools = tools
        self.consensus_min = consensus_min

    def inspect(self, poi: dict) -> dict[str, list[Candidate]]:
        ledger: dict[str, list[Candidate]] = {field_name: [] for field_name in FACT_FIELDS}
        for field_name in FACT_FIELDS:
            wrapper = poi.get(field_name)
            value = unwrap(wrapper)
            source = source_of(wrapper)
            if is_present(value) and source:
                ledger[field_name].append(Candidate(
                    field_name, value, source,
                    float(wrapper.get("confidence", 0.5)),
                    str(wrapper.get("fetched_at") or EPOCH),
                    source_url_for(poi, source),
                ))
        return ledger

    def plan(self, poi: dict, ledger: dict[str, list[Candidate]]) -> list[PlanStep]:
        unresolved = {
            field_name for field_name, candidates in ledger.items()
            if resolve_consensus(candidates, self.consensus_min) is None
        }
        steps: list[PlanStep] = []
        known_sources = {c.source for candidates in ledger.values() for c in candidates}
        for tool in self.tools:
            fields = sorted(unresolved & set(tool.supported_fields))
            if not fields:
                continue
            retry = bool(known_sources and tool.source not in known_sources)
            steps.append(PlanStep(
                tool=tool.name,
                source=tool.source,
                fields=fields,
                reason=("retry another independent source; consensus is not met"
                        if retry else "fill missing fields and collect first-source evidence"),
            ))
            known_sources.add(tool.source)
        return steps

    def run(self, poi: dict, dry_run: bool = False) -> dict:
        started_at = utcnow()
        ledger = self.inspect(poi)
        plan = self.plan(poi, ledger)
        events: list[dict] = [{
            "stage": "goal",
            "message": "Complete the POI using only facts verified by two independent sources",
        }, {
            "stage": "plan",
            "missing_fields": sorted(k for k, v in ledger.items() if not v),
            "unverified_fields": sorted(k for k, v in ledger.items()
                                        if v and resolve_consensus(v, self.consensus_min) is None),
        }]

        if not dry_run:
            tools_by_name = {tool.name: tool for tool in self.tools}
            for step in plan:
                tool = tools_by_name[step.tool]
                still_unresolved = {
                    field_name for field_name in step.fields
                    if resolve_consensus(ledger[field_name], self.consensus_min) is None
                }
                if not still_unresolved:
                    step.status = "skipped"
                    continue
                result = tool.fetch(poi, still_unresolved)
                step.status = "failed" if result.error else "completed"
                for candidate in result.candidates:
                    # One vote per logical source and field. A retry of the same source
                    # replaces its older observation instead of inflating consensus.
                    ledger[candidate.field] = [
                        c for c in ledger[candidate.field] if c.source != candidate.source
                    ] + [candidate]
                events.append({
                    "stage": "tool",
                    "tool": result.tool,
                    "source": result.source,
                    "requested_fields": sorted(still_unresolved),
                    "returned_fields": sorted({c.field for c in result.candidates}),
                    "found": result.found,
                    "error": result.error,
                })

        verified: dict[str, dict] = {}
        refused: dict[str, dict] = {}
        for field_name, candidates in ledger.items():
            winner = resolve_consensus(candidates, self.consensus_min)
            if winner:
                verified[field_name] = winner
                continue
            reason = "missing" if not candidates else "no_consensus"
            refused[field_name] = {
                "reason": reason,
                "sources_tried": sorted({c.source for c in candidates}),
                "candidate_count": len(candidates),
                "candidates": [
                    {"value": c.value, "source": c.source, "confidence": c.confidence,
                     "fetched_at": c.fetched_at, "source_url": c.source_url}
                    for c in candidates
                ],
                "flagged_for_review": True,
            }
        completeness = len(verified) / len(FACT_FIELDS)
        events.append({
            "stage": "verify",
            "verified_fields": sorted(verified),
            "refused_fields": sorted(refused),
            "decision": "write_verified_and_flag_rest" if verified else "refuse_and_flag",
        })
        return {
            "poi_id": poi.get("id"),
            "goal": {"target_quality": 0.9, "consensus_min": self.consensus_min},
            "started_at": started_at,
            "finished_at": utcnow(),
            "plan": [asdict(step) for step in plan],
            "events": events,
            "verified_fields": verified,
            "refused_fields": refused,
            "quality": {
                "verified_completeness": round(completeness, 3),
                "target_met": completeness >= 0.9,
            },
            "status": "verified" if not refused else "partial" if verified else "refused",
        }


def load_enrichment() -> dict[str, dict]:
    if not ENRICHMENT_PATH.exists():
        raise SystemExit(f"{ENRICHMENT_PATH} not found")
    return json.loads(ENRICHMENT_PATH.read_text(encoding="utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--poi-id", help="run one POI instead of the corpus")
    parser.add_argument("--limit", type=int, help="maximum number of POIs")
    parser.add_argument("--live", action="store_true", help="call real Apify + TinyFish tools")
    parser.add_argument("--dry-run", action="store_true", help="plan without invoking tools")
    parser.add_argument("--out", type=pathlib.Path, default=AGENT_RUNS_PATH)
    args = parser.parse_args()

    enrichment = load_enrichment()
    if args.poi_id:
        if args.poi_id not in enrichment:
            raise SystemExit(f"unknown POI id: {args.poi_id}")
        selected = [(args.poi_id, enrichment[args.poi_id])]
    else:
        selected = list(enrichment.items())[:args.limit]

    tools: list[SourceTool] = ([LiveGooglePlacesTool(), LiveFoodyTool()]
                               if args.live else default_cached_tools())
    agent = EnrichmentAgent(tools)
    runs = {poi_id: agent.run(poi, dry_run=args.dry_run) for poi_id, poi in selected}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(runs, ensure_ascii=False, indent=2), encoding="utf-8")
    counts = {status: sum(r["status"] == status for r in runs.values())
              for status in ("verified", "partial", "refused")}
    print(f"agent processed {len(runs)} POI(s) -> {args.out} ({counts})")


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        sys.exit(1)
