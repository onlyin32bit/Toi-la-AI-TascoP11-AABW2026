# Submission Portal Copy — Tasco P11 (AABW 2026)

> Paste field-by-field. Kept short on purpose. Frame: **it gets Vietnam, it gets you, and it never lies.**
> Numbers policy: measured or labeled estimate only. Fill `[X]/[N]` before submit.

---

## Team Name
Tôi là AI

## Project Title
**Tasco Maps — the Vietnamese-first food intelligence that never lies**

## Elevator Pitch (1–2 sentences)
For young Vietnamese food-discoverers, Tasco Maps is an end-to-end personalization engine that understands how they search, ranks for their taste, and refuses to recommend a place it can't verify is real and accurately rated.

---

## Project Story ("About the project")

### Inspiration
It started when one of out team's member says: *"đá bát phở không?" (Do you want to kick a bowl of phở?) — a Northern slang for eating. We realized many of our POI do not fit a maps search bar and recommendations, given all the local constraints, such as like unreliable and diverse dialect, unclear preferences, or our real-time journey. We then discover world-class food-intelligence engines already exist; they just aren't built for how we talk about or discover food here in Vietnam. And as food lovers, we got to build something about this.

### What it does
Type a Vietnamese query and Tasco Maps resolves it (your un-filled intention) to the right places, ranks them **for you** (location, time-of-day, diet, price, parking), and shows a plain-language *why* for every result. Ask about a place it hasn't verified, and it says **"Không tìm thấy trong dữ liệu"** instead of making something up. It also does menu OCR, dish recognition from a photo, POI comparison, and quality scoring — so that the recommendations ca reliably cover as many users' needs as possible.

### How we built it
A **Go online engine** (Go standard library only — one static binary, zero external deps, offline-safe) runs the request path: recall → a **Hard-Constraint Gate** that *rejects* rather than silently relaxes a constraint → a **Soft-Scoring** stage that renormalizes weights for missing signals and personalizes → serve, each field carrying its source. Behind it, a **trust-tiered resolver (S0–S7)**: an agent pulls from multiple sources, and a highest-confidence **consensus rule** decides each field — no source, no write. Localization runs through the whole stack: diacritic-insensitive matching, slang/teencode normalization, a regional-specialty ontology, and Vietnamese meal-time priors. Vision (Gemini/Qwen-VL) handles OCR and dish recognition; a Python pipeline builds the knowledge base offline.

### Challenges we ran into
Naive LLM extraction fabricates missing attributes — brand-fatal for a map. We solved it by making verification structural, not optional: two independent sources must agree before a fact is written, and the engine refuses when they don't. The other hard call was honesty about scope: two of our five trust tiers (MISA CukCuk POS, VETC telemetry) need live partner feeds we don't have yet, so we fully specified them but only claim what we validated.

### Accomplishments we're proud of
A working end-to-end system validated on a **real 537-POI corpus** across Thủ Đức, Quận 2 and Làng Đại Học — not a toy demo. And an engine that will visibly *refuse to lie* on stage: [N]/[N] honesty traps pass.

### What we learned
Localization isn't a language setting — it's the product. And for anything a brand puts its name on, "trustworthy" beats "impressive": an engine that admits what it doesn't know is worth more than one that guesses well.

### What's next
Light up Tiers 1–2 with live MISA CukCuk (50,000+ restaurants) and VETC (2.8M vehicles) feeds, turning the map self-updating; then the flywheel — more young diners → more behavioral data → sharper personalization — makes the data moat compound.

---

## Built With (tags)
`go` `python` `qwen` `dashscope` `gemini-vision` `groq` `hutieubert` `apify` `tinyfish` `zenrows` `jina` `bm25` `react` `vite` `leaflet` `tauri` `postgres` `qdrant`

## AABW Partner Tool Usage (be specific)
- **Apify** — Google Places crawler actor; licensed Tier-3 source (confidence 0.80) for POI facts, hours, parking, reviews.
- **TinyFish / AgentQL** — agentic web extraction for the Tier-4a facts tier (Foody/Riviu/website).
- **Groq** — review → aspect extraction in the offline pipeline.
- **Gemini / Qwen-VL** — menu OCR and dish-from-photo recognition, cache-first.

---
*Reminder: Demo URL tested in incognito; GitHub public with runnable README; 3–5 real-product screenshots (3:2); 2–3 min demo video showing the product working (not slides).*
