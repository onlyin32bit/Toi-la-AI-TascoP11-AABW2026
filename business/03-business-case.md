# Business Case — Value Prop, Market, Impact, Monetization

## 1. Value proposition

> **"Chúng tôi biến dữ liệu nhà hàng hỗn loạn của Việt Nam thành POI intelligence đáng tin cậy — tự động, có nguồn gốc, và không bao giờ bịa."**
> *(We turn Vietnam's messy restaurant data into trustworthy POI intelligence — agent-built, provenance-tracked, and it never fabricates.)*

| Pillar | Demo proof | Why Tasco cares (testing phase) |
|---|---|---|
| **Enriches** | quality 0.6 → 0.9 live, agent visibly planning & using tools | launch-ready coverage without an army of curators |
| **Explains** | "Vì sao gợi ý?" factor breakdown + provenance badges | differentiation Google doesn't offer; trust for a new brand |
| **Never lies** | Crystal BBQ → `not_found`; Halal-HCM → honest empty state | one hallucination screenshot at launch = brand damage |

## 2. Market numbers (sourced — safe to put on slides)

| Number | Value | Source |
|---|---|---|
| F&B outlets in Vietnam (2024) | **323,010** (+1.8% YoY) | [iPOS/VIRAC F&B Report 2024](https://ipos.vn/en/bao-cao-nganh-fnb-2024/), [Tạp chí Công Thương](https://tapchicongthuong.vn/cong-bo-bao-cao-thi-truong-kinh-doanh-am-thuc-tai-viet-nam-nam-2024-138528.htm) |
| Outlets closed in H1 2024 alone | **≥30,000** (data churn ≈ 10%/half-year) | [iPOS H1 2024 report](https://ipos.vn/thong-cao-bao-chi-ipos-vn-ra-mat-bao-cao-nganh-fb-viet-nam-6-thang-dau-nam-2024-tai-su-kien-vietnam-fb-summit-2024/), [CafeF](https://cafef.vn/cuoc-thanh-loc-cua-nganh-fb-viet-nam-nam-2024-chi-147-cua-hang-an-uong-ghi-nhan-tang-truong-gan-50-doanh-nghiep-du-kien-tang-gia-trong-nam-2025-188250318102118881.chn) |
| VN F&B revenue 2024 | **~688,800 tỷ đồng (~US$27B), +16.6% YoY**; +9.6% forecast 2025 | [Báo Chính phủ](https://baochinhphu.vn/nganh-fb-tai-viet-nam-se-tiep-tuc-tang-truong-96-trong-nam-2025-102250319131429058.htm) |
| Diners checking Google/Maps before choosing | **64%** | [Restroworks](https://www.restroworks.com/blog/google-restaurant-search-statistics/) |
| "Near me" searches → offline visit within a day | **76%** | [BizIQ](https://biziq.com/blog/local-search-statistics/) |
| Food = #1 "near me" mobile search category | — | [Marketing Dive](https://www.marketingdive.com/news/food-entertainment-top-near-me-mobile-searches-study-says/531045/) |
| VETC network | **~2.8M vehicles, ~80% ETC market share** | [VETC](https://vetc.com.vn/), [Bảo hiểm Tasco](https://baohiemtasco.vn/tin-tuc/vetc-va-nhung-buoc-tien-lon-sau-1-nam-cach-mang-etc-ve-thu-phi-khong-dung) |
| MISA CukCuk restaurant base | **50,000+ restaurants/cafés** | [cukcuk.vn](https://www.cukcuk.vn/) |

Slide rule (playbook): estimates get labeled "estimated"; measured numbers get labeled "measured on our system".

## 3. Impact math (the money slide)

**Manual baseline (estimated, labeled):** one national curation pass at 15 min/outlet × 323,010 outlets ≈ 80,750 hours ≈ **40 person-years** — and it starts decaying immediately (10%/half-year churn).

**Agent (measured tonight):**
- Cost per enriched POI = total API/scraping credits ÷ POIs enriched = **[X]đ** → national pass ≈ **[X × 323,010]** ≈ [Y]tr đồng
- Wall-clock per POI = **[X]s** → national pass parallelized ≈ days, not years
- Quality lift = **0.6 → 0.9 avg**, [N] gaps closed per POI
- Re-runs continuously → data stays alive through churn (manual passes structurally cannot)

**Headline sentence:** *"One launch-ready restaurant profile: 15 minutes of human curation, or [X]đ and [X] seconds of agent run — repeatable every month, for all 323,010 outlets."*

### Measured-stats checklist (BIZ collects before code freeze)
- [ ] Cost per POI enriched (DEV2: credits ÷ POIs)
- [ ] Seconds per POI enriched (DEV2)
- [ ] Avg quality before → after + gaps closed (DEV2)
- [ ] Core recommend latency ms (DEV1)
- [ ] Eval: /15 public + /8 personalize-localize + 2/2 traps (DEV3)
- [ ] Count of capabilities served from one engine (9) + one binary size/startup time (DEV1, nice flex)

## 4. Monetization model (full — Slide 5 strip + appendix A5)

Sequenced by maturity; no revenue projections, comparables only (defensible under exec questioning):

| # | Stream | Who pays | Mechanism | Why credible |
|---|---|---|---|---|
| 1 | **Merchant verified listings** (freemium → subscription) | Restaurant owners | Claim & manage the enriched profile: verified badge, menu updates, photos, analytics | **MISA CukCuk = onboarding channel**: 50,000+ restaurants already on the POS; menu/price data flows in automatically, listing upsell flows out. Comparable: Google Business Profile premium features, Foody merchant tools |
| 2 | **Sponsored placement** | Restaurants/chains | Clearly-labeled promoted slots *inside* the honest ranking — provenance stays visible (our trust story doubles as ad-quality story) | Standard maps/local-discovery model (Google, Meituan, Foody/ShopeeFood) |
| 3 | **B2B data licensing** | Banks, delivery platforms, franchises, FMCG | Structured, quality-scored, fresh F&B POI dataset + API | Data is provenance-tagged and continuously verified — exactly what B2B buyers can't scrape themselves |
| 4 | **VETC ecosystem cross-sell** | Transaction commissions | Route-aware dining recommendations to ~2.8M ETC vehicles ("quán bún chả ngon, 5km trước trạm thu phí tiếp theo") → booking/ordering fees | Long-term moat: **VETC mobility data + MISA merchant data + our agent = a dataset nobody can scrape**. Comparable: Amap/Meituan local-services flywheel |

TAM framing (one line, labeled estimate): merchant SaaS/listing spend across 323k outlets + F&B ad spend within a ~$27B industry; we don't project revenue — we show four doors the asset opens.

## 5. Strategic story for Tasco (the "so what" behind everything)

1. **Now (testing phase):** the agent compresses time-to-launch-ready coverage from a curation program to an agent run — coverage becomes a compute budget, not a hiring plan.
2. **At launch:** depth + explainability + trust = the reason to open Tasco Maps at dinner time instead of Google — the highest-frequency map use case.
3. **After launch:** partner-fed data alliance (MISA POS truth + VETC mobility signals + agent verification) compounds into a proprietary food layer — the part of the map Google structurally can't copy.
