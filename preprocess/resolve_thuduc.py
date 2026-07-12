"""Publish the verification decisions produced by ``agent_loop.py``.

Unlike the previous one-candidate resolver, this module never upgrades a
single-source observation into a resolved fact.  Only ``verified_fields`` from
the agent run are written.  Missing/conflicting observations remain absent and
are copied to ``refused_fields`` for review.

Run: python3 agent_loop.py && python3 resolve_thuduc.py
"""
import argparse
import json
import pathlib
from datetime import datetime, timezone

from agent_loop import AGENT_RUNS_PATH, FACT_FIELDS
from poi_provenance import ENRICHMENT_PATH

OUT_PATH = ENRICHMENT_PATH.parent / "thuduc_resolved.json"


def quality_for(run: dict) -> dict:
    verified = run.get("verified_fields", {})
    completeness = len(verified) / len(FACT_FIELDS)
    confidences = [float(v.get("confidence", 0)) for v in verified.values()]
    agreement = min(1.0, min((v.get("consensus_count", 0) / 2 for v in verified.values()), default=0.0))
    confidence = sum(confidences) / len(confidences) if confidences else 0.0
    return {
        "verified_completeness": round(completeness, 3),
        "source_agreement": round(agreement, 3),
        "mean_confidence": round(confidence, 3),
        "score": round(completeness * agreement * confidence, 3),
        "target_met": completeness >= 0.9,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", type=pathlib.Path, default=AGENT_RUNS_PATH)
    parser.add_argument("--out", type=pathlib.Path, default=OUT_PATH)
    args = parser.parse_args()
    if not args.runs.exists():
        raise SystemExit(f"{args.runs} not found — run agent_loop.py first")
    runs = json.loads(args.runs.read_text(encoding="utf-8"))
    fields_out = {poi_id: run.get("verified_fields", {}) for poi_id, run in runs.items()}
    refused_out = {poi_id: run.get("refused_fields", {}) for poi_id, run in runs.items()}
    quality_out = {poi_id: quality_for(run) for poi_id, run in runs.items()}
    out = {
        "resolved_at": datetime.now(timezone.utc).isoformat(),
        "policy": {"consensus_min": 2, "single_source_publishable": False},
        "fields": fields_out,
        "refused_fields": refused_out,
        "quality_v2": quality_out,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    verified = sum(bool(fields) for fields in fields_out.values())
    print(f"published verification decisions for {len(runs)} POIs ({verified} with verified facts) -> {args.out}")


if __name__ == "__main__":
    main()
