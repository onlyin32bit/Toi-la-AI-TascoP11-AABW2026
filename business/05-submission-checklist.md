# Submission Checklist — AABW Event Portal

## ⏰ Deadlines

- [ ] **Jul 11, 3:00 PM — TODAY: confirm track (Tasco P11) on the event portal.** No confirmation = not judged. Do this FIRST, before any more building.
- [ ] Jul 12, 9:00 AM — full submission on portal (NOT Devpost)
- [ ] Jul 12, before 9:00 — at least one member checks in on-site
- [ ] Jul 12 — pitch slot confirmed at check-in

## Portal fields (drafts — edit, don't start from blank)

**Team name:** [Tôi là AI] — keep consistent with deck branding.

**Project title:** descriptive > clever. Candidate: **"[Name] — Trustworthy Restaurant Intelligence Agent for Tasco Maps"**

**Elevator pitch (1–2 sentences):**
> An AI agent that plans, scrapes, verifies, and scores restaurant & menu data for Tasco Maps — turning Vietnam's 323,000 unstructured F&B listings into launch-ready POI intelligence with per-field provenance, and refusing to fabricate what it can't verify.

**About the project (structure judges read most closely):**
1. **Inspiration** — Tasco Maps is pre-launch; food is the #1 reason to open a local map; 30,000 VN restaurants closed in H1 2024 alone — restaurant data rots faster than humans can curate it.
2. **What it does** — plain language: enriches restaurant profiles from multiple sources, reads menus from photos, recognizes dishes from images, answers questions with citations, recommends with explanations, scores data quality — all on Tasco's API contract.
3. **How we built it** — Go serving engine (one static binary, cache-first, offline-safe) + Python offline agent lane (enrichment, OCR/vision, NER, batch summarization); Qwen LLM/vision; consensus-gated multi-source verification. *(Each dev writes 3–5 bullets for their module.)*
4. **Challenges** — honest ones: benchmark POIs are synthetic so scraping them would cause false matches — we split benchmark vs real-POI enrichment lanes; hallucination traps in the eval; 12-hour clock.
5. **Accomplishments** — one concrete moment: e.g. "quality 0.6→0.9 on a real Hanoi restaurant with every field traceable to its source, live, offline."
6. **What we learned** — verification is the product: enrichment without provenance is just faster misinformation.
7. **What's next** — licensed feeds (MISA CukCuk POS), route-aware dining for VETC's 2.8M vehicles, learned ranking once real usage data exists.

**Built With (tags — exact names, feeds Agentic AI Use + Technical Execution scoring):**
Go, Python, React, Vite, Leaflet, Tauri, Qwen (DashScope), qwen-vl-plus, Gemini Flash (fallback), Apify, AgentQL/TinyFish, ZenRows, HuTieuBERT, OpenStreetMap/Overpass. *(Trim to what we actually used — accuracy is a stated judging point.)*

**Partner tools section:** select every partner tool genuinely used + one specific sentence each on what it did (bonus-prize eligibility). Vague = ineligible.

**Links:**
- [ ] Demo URL — test in incognito right before submitting
- [ ] Repo URL — public, README explains how to run
- [ ] Video demo 2–3 min — product working, NOT narrated slides; record as backup for live demo too
- [ ] Image gallery — 3–5 screenshots, 3:2, readable: map+results w/ why-breakdown, enrichment before/after, assistant citing sources, dish recognition, compare view

**Disclosures:** pre-existing `ui/` T Maps prototype used as frontend base — disclose it (using prior assets is fine; hiding them is not).

**Final step:** Official Rules checkbox (read it), public visibility choice, verify track/problem statement on the summary screen.
