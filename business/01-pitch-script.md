# 5-Minute Pitch Script — Round 1 (AABW time map)

Format: 5:00 pitch + 2:00 Q&A + 1:00 transition. **Rehearse to 4:45.** One narrator owns the whole pitch (playbook best practice); others join only for Q&A.

Language: draft in English below; deliver in whichever language the judges brief specifies — key Vietnamese lines kept where they hit harder.

---

## 0:00–0:40 — IDENTITY + HOOK (Slide 1: Team + Promise)

> **WE ARE** [Tôi là AI]. **WE BUILT** [product name] for the Tasco P11 track.
>
> **For Tasco Maps, we deliver launch-ready restaurant intelligence by using an AI agent to collect, verify, and score POI data — an agent that never fabricates.**

Hook (pick ONE, A recommended):

- **(A) The empty-map hook:** "A map that launches with shallow restaurant data dies quietly — because *food is what people open a local map for*. 64% of diners check search or maps before choosing where to eat. Tasco Maps is in testing. The clock to launch-quality data is running. We built the agent that fills the map."
- **(B) The rot hook:** "In the first half of 2024, 30,000 Vietnamese restaurants closed. Whatever restaurant database you build today is rotting tomorrow. Coverage isn't a project — it's a process. Processes need agents."

Credibility line: "We are [X] engineers + [Y] with F&B/product background — we shipped this end-to-end in 12 hours on Tasco's real datasets and API contract."

## 0:40–1:20 — PROBLEM INSIGHT (Slide 2)

Playbook: *insight, not a copy of the brief. "We discovered…", not "the brief says…"*

- **WHO:** Tasco Maps' data/product team, pre-launch.
- **GOAL:** launch-ready F&B coverage deep enough to beat "just use Google."
- **FRICTION:** Vietnam has **323,010 F&B outlets** (iPOS 2024); their info is unstructured, image-heavy (menus are photos), and stale — **30,000 outlets closed in H1 2024 alone**, so any static dataset decays ~10%/half-year.
- **ROOT CAUSE:** manual curation can't scale (even 15 min/outlet ≈ **40 person-years** for one national pass — then it's already stale). Naive LLM enrichment scales but **hallucinates** — fabricated opening hours at launch = brand damage a new map can't survive.
- **EVIDENCE (we discovered):** in Tasco's own dataset, [X]% of POIs miss menu/hours/dietary fields — avg quality score [0.XX]. *(DEV2 fills the real number — this is our "one insight beats five statistics".)*

> One-liner: **"Tasco's bottleneck isn't map tech — it's trustworthy depth per POI, at national scale, continuously."**

## 1:20–2:20 — SOLUTION = THE AGENT AT WORK (Slide 3: Agentic Workflow)

Playbook: judges must SEE plan → tools → act → verify, or they see "only a chatbot." Narrate the loop over the architecture diagram:

1. **Goal** — "Complete this restaurant's profile to quality ≥ 0.9."
2. **Plan** — the agent inspects the gaps (no menu, no hours) and decides which sources can fill each: Google Places for hours, Foody for menu, TikTok for buzz.
3. **Tools** — it executes scrapers and vision models: Apify actors, anti-bot fetchers, agentic extraction (AgentQL), OCR + vision LLM for photographed menus.
4. **Act** — extracts and structures: raw text/images → normalized menu items, prices, dietary tags, opening hours.
5. **Verify** — the non-negotiable step: **≥2 independent sources must agree before a fact is written**; every field carries `{source, confidence, fetched_at}`; unverifiable → the agent **refuses and flags the gap** instead of guessing.

Then one breath on serving: "The verified knowledge base then powers everything the brief asks for — semantic food search, personalized recommendations *with explanations*, comparison, an assistant that cites its sources, and dish recognition from photos — all through Tasco Maps-compatible APIs."

> Sentence to land: **"Unlike a wrapper that asks an LLM to 'fill in the data', our agent treats every fact as unverified until two sources agree — that's why Tasco can put its brand on the output."**

## 2:20–3:05 — CREDIBILITY / WHY IT WINS (Slide 4)

Playbook frame — Real / Reliable / Controlled / Evaluated:

- **Real:** end-to-end working system — CSV + scraped sources → knowledge base → live API → map UI. One static binary online, offline-safe, cache-first (demo survives dead wifi).
- **Reliable:** anti-hallucination by construction — NER entity gate: a restaurant not in the KB returns `not_found`, never a fabrication. *(Tease: "we'll show it refusing, live.")*
- **Controlled:** every enriched field is namespaced, provenance-tagged, confidence-scored; benchmark data is never overwritten by scraped data; human-reviewable.
- **Evaluated:** [N]/15 public evaluation queries + [N]/8 personalization & localization scenarios passing, including **2/2 honesty traps**. *(DEV3 fills final numbers.)*

Differentiator line (vs Google — 15s version, full ammo in [02-google-competitive.md](02-google-competitive.md)):
> "Google wins on breadth. A Vietnamese map wins on **depth** — menus, prices, dietary tags per POI; **trust** — every field verifiable to its source; and **being Vietnamese-first** — our ranking favors quán bình dân over tourist traps, by design."

## 3:05–3:50 — IMPACT (Slide 5: Evidence + Impact)

Playbook: strongest evidence you actually have; label estimates. Three numbers + one comparison:

1. **Cost per enriched POI: [X]đ** *(measured tonight — API credits ÷ POIs)* vs. manual curation ≈ 15 min/POI. At national scale: **agent ≈ [X × 323k]đ total** vs **~40 person-years** of manual work — and the agent re-runs continuously, which manual passes can't.
2. **Quality lift: 0.6 → 0.9 avg completeness** on enriched POIs, [N] gaps closed *(measured)*.
3. **Latency: [X]ms** core recommendation — production-grade, no GPU required at query time *(measured)*.

Frame: "For Tasco this converts directly: **time-to-launch-ready coverage** drops from a curation program to an agent run — and the same agent keeps the data alive as 10% of outlets churn every 6 months."

Monetization (20s, from [03-business-case.md](03-business-case.md)): "Post-launch this asset monetizes 4 ways: merchant verified listings — with MISA CukCuk's 50,000+ restaurants as an onboarding channel — sponsored placement inside honest rankings, B2B data licensing, and route-aware dining for VETC's 2.8M vehicles."

## 3:50–4:50 — DEMO (Slide 6, ≤60s, follows the demo storyline)

Primary storyline — **the enrichment agent + the honesty trap** (matches hero claim):

| Time | Beat | On screen |
|---|---|---|
| 0–10s | Goal | Real restaurant POI on the map, quality badge **0.61**, missing menu & hours |
| 10–20s | Trigger | Click "Enrich" — agent panel opens |
| 20–45s | Agent acts | Visible plan + tool calls: sources found → fields extracted → **consensus check** → provenance badges appear |
| 45–55s | Outcome | Same card now quality **0.90**: menu, prices, hours, dietary tags — each field showing its source |
| 55–60s | Proof | Type "Crystal BBQ có ngon không?" → assistant: **"Không tìm thấy trong dữ liệu"** — "it enriches aggressively, and refuses to lie." |

Fallbacks: backup video recorded (playbook mandate); if time collapses, cut to the 45–60s segment only.

## 4:50–5:00 — CLOSE (10s)

> "With [product], Tasco Maps launches with the deepest, most trustworthy food layer in Vietnam — built by an agent, verified by design. **Chúng tôi không chỉ làm giàu dữ liệu — chúng tôi làm cho dữ liệu đáng tin.** Thank you."

---

## Deck = 6 slides (playbook recommendation)

1. **Team + Promise** — team, one-sentence promise, credibility line
2. **Problem Insight** — 323k outlets / 30k closures / [X]% incomplete fields — one chart max
3. **Agentic Workflow** — the Goal→Plan→Tools→Act→Verify loop diagram (THE slide)
4. **Why It Wins** — Real/Reliable/Controlled/Evaluated + Google side-by-side screenshot
5. **Evidence + Impact** — 3 measured numbers + cost math + monetization strip
6. **Demo + Close** — live demo, closing line
+ Numbered appendix A1–A8 (see [04-qa-prep.md](04-qa-prep.md)) — shown only if asked.

## Rubric self-check (write one sentence per criterion — playbook "next move")

| Criterion | Our sentence |
|---|---|
| Agentic AI use | The agent plans source selection per gap, invokes scraping/OCR/vision tools, and verifies via multi-source consensus before writing any fact. |
| Problem/track fit | We solve Tasco P11's exact brief — enrichment, menu OCR, dish recognition, search, assistant, recommendations, quality scoring — on Tasco's datasets and API contract. |
| Technical execution | Working end-to-end system: agent-built KB → sub-[X]ms API → map UI; offline-safe demo; [N]/23 eval scenarios pass. |
| Impact | Cost per launch-ready POI drops from ~15 min of human curation to [X]đ of agent run, across 323,010 outlets that churn ~10% per half-year. |
| Creativity | Verification-first agent: consensus gating + provenance + refusal — enrichment that a brand can actually publish. |
| Clarity | One story — "the agent that feeds Vietnam's map, and never lies" — told in 6 slides and one 60s demo. |
