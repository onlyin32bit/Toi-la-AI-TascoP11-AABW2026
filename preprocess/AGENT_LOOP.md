# Thu Đức enrichment agent

The executable loop is in `agent_loop.py`:

1. **Goal:** complete one POI without publishing an unverified fact.
2. **Inspect:** classify every factual field as missing, single-source, or
   verified.
3. **Plan:** select only tools whose declared capabilities cover unresolved
   fields. The plan is different when the gaps are different.
4. **Act:** invoke Google Places (Apify) and Foody (TinyFish), using cached
   scrape shards by default or real APIs with `--live`.
5. **Retry:** if the first result does not create consensus, invoke the next
   independent eligible source.
6. **Verify:** require two distinct logical sources to agree. Multiple shards
   or retries from the same source still count as one vote.
7. **Write/refuse:** write verified values with all contributing provenance;
   keep missing or conflicting values absent and flag them for review.

TikTok/Facebook data remains a decaying `buzz_score` signal and never votes on
a POI fact. Menu and dietary evidence are accepted only from explicit menu
fields; category names are not converted into invented dishes.

Commands:

```bash
make thuduc-agent                       # deterministic cached tools
make thuduc-agent ARGS="--poi-id ID"   # inspect one POI
make thuduc-agent ARGS="--live --poi-id ID"  # real APIs; requires keys
make thuduc-compile                     # agent -> resolver -> verified KB
```

Outputs:

- `data/thuduc/thuduc_agent_runs.json`: goal, plan, tool events, verified
  facts, refused gaps, and quality decision per POI.
- `data/thuduc/thuduc_resolved.json`: publication decisions and provenance.
- `data/thuduc/thuduc_kb.json`: only POIs whose identity and address passed
  the two-source gate.
