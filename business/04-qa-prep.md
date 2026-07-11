# Q&A Prep — 2 Minutes, Collect First

## Protocol (from playbook)

1. Open with: **"Could we collect the judges' questions first?"** — 0:20 collect, 1:20 answer. Note → group → answer in order.
2. Answer format, 15–25s each: **Answer** (conclusion first) → **Support** (one fact/example) → **Connect** (back to user/Tasco value).
3. Not sure? Say what's unvalidated, what we know, and how we'd test it. Never bluff — the honesty brand extends to Q&A.
4. Assign owners: **BIZ** = market/monetization/roadmap · **DEV1** = ranking/architecture · **DEV2** = data/enrichment · **DEV3** = AI/eval. One voice per question.

## Hard questions + drafted answers

**"Why is this agentic and not just a pipeline?"** *(rubric #1 — most likely question)*
> A pipeline runs fixed steps; our agent makes per-POI decisions. It inspects which fields are missing, chooses which sources can fill each gap, invokes the right tool — Places actor, anti-bot fetcher, OCR, vision — then verifies by cross-source consensus and decides: write, retry another source, or refuse and flag. Different POI, different plan. That decision loop is what makes the output trustworthy enough for Tasco to publish.

**"Why can't a general assistant / ChatGPT do this?"**
> A general assistant answers from what it remembers — and it will happily guess a restaurant's opening hours. Our agent is grounded in a verified KB with per-field provenance, refuses outside it, and is wired into Tasco's API contract. We'll show it refusing live — ask it about a restaurant that doesn't exist.

**"Why won't Google just do this?"**
> See [02-google-competitive.md §3](02-google-competitive.md) — structural, not technical: global product incentives vs local data alliances (MISA CukCuk 50k restaurants, VETC 2.8M vehicles).

**"Where do your numbers come from?"**
> Two buckets, labeled on the slide: market numbers are cited — iPOS/VIRAC 2024 for 323,010 outlets, VETC's published 2.8M vehicles. Performance numbers we measured on our own system tonight — cost per POI, quality lift, latency, eval pass rate. The appendix has the eval table.

**"Scraping — legality/ToS? Data quality of scraped facts?"**
> Three safeguards: enrichment runs offline against public business information, never at query time; every field keeps provenance so anything contested is traceable and removable; and production integration would shift to licensed feeds — Places API, MISA POS data — with scraping only filling gaps. Consensus gating means no single scraped source ever becomes a published fact alone.

**"With 30 POIs, how do you know it scales?"**
> The dataset is small; the architecture isn't. Query path is precomputed-index + scoring — the 30-POI benchmark answers in [X]ms and the same design serves 10⁵ POIs. Enrichment cost scales linearly at [X]đ/POI. What does change at scale is ranking: with real user history we'd move from our cold-start ranker to learned models — that's the roadmap, with citations in the README.

**"What fails? What did you not build?"** *(honesty question — score points here)*
> Live vision calls depend on an external API, so we cache demo inference — real deployments self-host. Dish recognition is zero-shot, not fine-tuned — good for common dishes, weaker on rare ones; fine-tuning needs a labeled VN food image set. And we deliberately didn't train deep recommenders: 30 POIs would overfit. We'd rather show you a small honest system than a big fragile one.

**"How does Tasco actually integrate this?"**
> It already speaks their contract — PlaceResult-compatible responses, their error schema, stable IDs, WGS84, Vietnamese diacritics preserved. It's one static binary plus a knowledge-base file; integration is pointing their gateway at our endpoints. That was a design constraint from hour one.

**"Who validated the problem?"**
> Tasco wrote the brief — and the dataset proves it: [X]% of provided POIs lack menu/hours/dietary data. Externally, 64% of diners check maps before choosing where to eat, and 30,000 outlets closed in H1 2024 — incompleteness plus churn is the problem, measured.

## Appendix slides (numbered, shown only when asked)

| # | Content | Owner |
|---|---|---|
| A1 | Agentic workflow detail (plan/tool/verify loop, per-source decision table) | DEV2 |
| A2 | Technical architecture (offline/online split, one-binary serving) | DEV1 |
| A3 | Safety & oversight (consensus gating, provenance, refusal, namespacing, no-key-in-repo) | DEV3 |
| A4 | Problem evidence (dataset completeness audit + market stats w/ sources) | BIZ |
| A5 | Impact/ROI math (cost per POI × 323k, person-year comparison, monetization) | BIZ |
| A6 | Alternatives considered (deep recommenders rejected — overfit at 30 POIs; cited) | DEV1 |
| A7 | Evaluation results (15 public + 8 P/L scenarios + 2 traps, pass/fail table) | DEV3 |
| A8 | Roadmap + limitations (embeddings, route-aware VETC, fine-tuned vision, licensed feeds) | BIZ |
