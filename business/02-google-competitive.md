# The Google Side — Competitive Positioning & Ammo

How we talk about Google Maps (and local players) in the pitch and Q&A. Layered framing as decided: **Depth (headline) → Trust → Vietnamese-first.**

Rule: never trash Google — judges use it daily and Tasco execs respect it. The stance is *"Google optimized for the world; nobody optimized for Vietnam's food layer. That's the opening."*

---

## 1. The side-by-side (Slide 4 visual)

Same restaurant, two cards:

| | Google Maps | Us (on Tasco Maps) |
|---|---|---|
| Name, rating, photos | ✅ | ✅ |
| Structured menu w/ prices | ❌ mostly photos of menus | ✅ OCR + vision-extracted, itemized |
| Search by dish ("bún chả rẻ gần đây") | ⚠️ keyword-ish | ✅ semantic + dish index |
| Dietary filters (chay / halal) | ❌ | ✅ hard filter — never silently relaxed |
| Why this suggestion? | ❌ black box | ✅ factor-by-factor explanation |
| Field provenance + confidence | ❌ | ✅ every enriched field: source, confidence, freshness |
| Quality/completeness score | ❌ internal only | ✅ visible badge, drives enrichment agent |
| Local-eatery ranking bias | ❌ ad/review-volume driven | ✅ anti-luxury term favors quán bình dân (per Tasco brief) |
| Refuses to answer unknowns | ❌ (and LLM overviews can hallucinate) | ✅ `not_found` by construction |

## 2. Three layers, in pitch order

### Layer 1 — DEPTH (headline)
Google's F&B data in Vietnam is broad but shallow: menus live in photos, prices are absent or stale, attributes are sparse. The consumer behavior data shows depth is what converts:

- **64% of diners check Google Search/Maps before deciding where to eat** — the food layer IS the decision layer ([Restroworks – Google restaurant search statistics](https://www.restroworks.com/blog/google-restaurant-search-statistics/))
- **76% of "near me" mobile searches lead to an offline visit within a day** ([BizIQ – Local search statistics](https://biziq.com/blog/local-search-statistics/))
- **Food is the #1 "near me" mobile search category** ([Marketing Dive – 'near me' study](https://www.marketingdive.com/news/food-entertainment-top-near-me-mobile-searches-study-says/531045/)); "food near me open now" searches grew ~875% YoY ([Restroworks](https://www.restroworks.com/blog/google-restaurant-search-statistics/))

Pitch line: *"When 3 out of 4 'near me' searches become a visit within 24 hours, whoever owns the deepest answer to 'ăn gì gần đây' owns the map habit."*

### Layer 2 — TRUST
Google shows information; we show information **you can verify**. Every enriched field carries `{source, confidence, fetched_at}`; facts require ≥2-source consensus; the assistant cites sources and returns `not_found` for entities outside the KB. A pre-launch brand cannot afford one viral screenshot of its AI inventing a restaurant — trust-by-construction is a launch requirement, not a feature.

### Layer 3 — VIETNAMESE-FIRST
Things a global product will never prioritize for Vietnam:
- Vietnamese query understanding incl. diacritics-insensitive matching, VN food taxonomy (phở ≠ bún ≠ hủ tiếu as dish classes)
- **Anti-luxury ranking**: boosts quán bình dân with high quality, penalizes premium-only results — encoded in the score formula, straight from Tasco's brief
- Vietnamese administrative/data churn: even Google took until 2026 to reflect Vietnam's new administrative map ([Tuổi Trẻ](https://tuoitre.vn/google-maps-bat-dau-cap-nhat-ban-do-hanh-chinh-moi-cua-viet-nam-20260319154316766.chn)) — local data operations move faster on local ground truth

## 3. "Why won't Google just do this?" (the killer Q&A question)

Answer (≤25s, playbook format — answer → support → connect):

> **Answer:** Because it's structurally against their model, not technically hard for them.
> **Support:** Google optimizes one global product; menu-level Vietnamese enrichment, bình dân-first ranking, and integrations with MISA CukCuk's 50,000+ restaurant POS systems or VETC's 2.8M-vehicle network are things only a local ecosystem can build and monetize.
> **Connect:** That local data alliance is exactly the moat this engine gives Tasco — the agent is the machinery that turns those partner feeds into map depth.

## 4. Local competitive landscape (know it, mention only if asked)

Tasco Maps isn't alone in challenging Google locally — be ready to differentiate from Vietnamese players too:

- **VietMap** — strong Maps API / navigation data business ([vietmap.vn](https://vietmap.vn/maps-api))
- **Goong** — Google-API-compatible local alternative ([goong.io](https://goong.io/))
- **GOFA HDMAP** — HD road mapping for navigation ([Dân Việt](https://danviet.vn/ky-su-viet-phat-trien-ban-do-giao-thong-hdmap-san-sang-canh-tranh-voi-google-maps-d1422159.html))

Positioning: *they compete on roads and APIs; nobody owns the **content intelligence layer** — restaurant/menu depth. That's the layer we build for Tasco, and it rides on top of Tasco's own map, not against it.* (Also matches the brief: "enhance, not replace, the underlying map platform.")

## 5. Lines to say and lines to avoid

**Say:**
- "Google wins on breadth; a Vietnamese map must win on depth, trust, and being Vietnamese-first."
- "We don't compete with Google's map — we make Tasco's map worth opening at dinner time."
- "Every fact on our card can show you where it came from. Try that on any other map."

**Avoid:**
- "Google's data is bad" (it isn't; it's *shallow and un-verifiable locally* — precision matters in Q&A)
- Absolute claims ("Google has no menus" — it has some, via photos/partners; say "mostly unstructured")
- Positioning as a Google replacement — the brief explicitly wants Tasco-ecosystem enhancement

## Sources

- [iPOS – Báo cáo ngành F&B 2024](https://ipos.vn/en/bao-cao-nganh-fnb-2024/) · [Tạp chí Công Thương – công bố báo cáo 2024](https://tapchicongthuong.vn/cong-bo-bao-cao-thi-truong-kinh-doanh-am-thuc-tai-viet-nam-nam-2024-138528.htm)
- [Restroworks – Google restaurant search statistics](https://www.restroworks.com/blog/google-restaurant-search-statistics/)
- [BizIQ – Local search statistics](https://biziq.com/blog/local-search-statistics/)
- [Marketing Dive – food tops 'near me' searches](https://www.marketingdive.com/news/food-entertainment-top-near-me-mobile-searches-study-says/531045/)
- [Tuổi Trẻ – Google Maps cập nhật bản đồ hành chính VN](https://tuoitre.vn/google-maps-bat-dau-cap-nhat-ban-do-hanh-chinh-moi-cua-viet-nam-20260319154316766.chn)
- [MISA CukCuk – 50,000+ nhà hàng](https://www.cukcuk.vn/) · [VETC](https://vetc.com.vn/) / [Bảo hiểm Tasco – VETC 1 năm cách mạng ETC](https://baohiemtasco.vn/tin-tuc/vetc-va-nhung-buoc-tien-lon-sau-1-nam-cach-mang-etc-ve-thu-phi-khong-dung)
