# BUILD PLAN — Tasco P11: AI-Powered Restaurant & Menu Intelligence

> **Bản final 11/7** — refine theo **PROBLEM STATEMENT.md** (đề chính thức) + **api/tasco_maps_hackathon_api_documentation.md** (API doc Tasco Maps).
> **Team 5 người: 1 UI · 3 dev · 1 business/pitch** — phân công ở §10.5.
> **Trạng thái repo:** backend `api/` (Cloudflare Workers) và UI prototype `ui/` (T Maps clone) **đã tồn tại** — plan này là plan **hoàn thiện + tích hợp**, không phải build from scratch.

---

## ⚠️ QUYẾT ĐỊNH KIẾN TRÚC (thay đổi so với bản trước)

**Bỏ Go engine.** Bản plan trước chốt "Go online + Python offline" khi repo chưa có code. Thực tế repo **đã có** `api/` — một backend Cloudflare Workers hoàn chỉnh (D1 + R2 + Queues + Vectorize + Workers AI) tự nhận cover: import POI/menu/review, OCR text → structured claims, provenance/claim review, search + dish search + recommendations + comparison + assistant có trích nguồn, quality scoring, và **Tasco-compatible `/v1/search` facade** + OpenAPI spec.

Build thêm 1 backend Go song song = 2 backend cho 3 dev trong ~3 ngày → tự sát. Thay vào đó:

- **Backend of record = `api/`** (TypeScript/CF Workers). Mọi năng lực online build tiếp vào đây.
- **Python chỉ còn 1 làn offline optional:** `preprocess/enrich.py` (scraping/enrichment, cache-first, §6.5).
- **Việc đầu tiên của Phase 0 = verify `api/` chạy thật** (`pnpm install && pnpm typecheck && pnpm test && pnpm dev` + seed 5 CSV). Nếu verify FAIL nặng → họp lại, fallback mới là bàn chuyện khác.

Toàn bộ thuật toán ranking (§7), bẫy chống hallucination, enrichment principles (§6.5) của plan cũ **giữ nguyên giá trị** — chỉ đổi chỗ implement (vào `api/src/search/ranking.ts` thay vì `rerank.go`).

---

## 0. Ta đang có gì

| Tài sản | Trạng thái | Ghi chú |
|---|---|---|
| `api/` — CF Workers backend | ✅ có code + test + OpenAPI | endpoints: `/api/v1/search`, `/search/dishes`, `/recommendations`, `/restaurants/{id}`, `/restaurants/{id}/menu`, `/restaurants/compare`, `/assistant/messages`, `/admin/imports/*`, `/admin/claims/*`, upload nguồn, health. Facade Tasco `GET /v1/search`, `GET /search` |
| `ui/` — T Maps UI prototype | ✅ chạy được, **data mock 100%** | React 19 + Leaflet + Tauri, iPhone frame, search/bottom-sheet/route/nav HUD. Toàn bộ trong 1 file `App.tsx`, chưa gọi backend nào |
| `data/` — 5 CSV | ✅ | POI (30 quán, 7 tỉnh), Menu (179 món), OCR Menu (18 quán, raw text), Reviews (150), Public Evaluation (15 câu chấm) |
| PROBLEM STATEMENT.md | ✅ mới nhận | scope THẬT của P11 — rộng hơn "recommender" (xem §1) |
| API doc Tasco Maps | ✅ mới nhận | DTO `PlaceResult`, `ErrorResponse`, compatibility requirements (§8) |
| Qwen DashScope key | ⏳ hết hạn **14/7** | LLM chính; Gemini free tier dự phòng |
| Sample Food Image Dataset | ❌ **chưa có trong repo** | đề nói có — **hỏi BTC ngay**; fallback: tự chụp/lấy ảnh món VN để demo dish recognition |

---

## 1. Scope P11 — coverage matrix (đề yêu cầu gì, ta có gì, ai làm)

Đề KHÔNG phải "food recommender". Đề là **Restaurant & Menu Intelligence platform**: enrich POI + hiểu menu + OCR + nhận diện món từ ảnh + search + assistant + recommend + quality score. Submission bắt buộc demo đủ **7 cảnh**:

| # | Deliverable đề yêu cầu | Backend `api/` | Việc còn lại | Owner |
|---|---|---|---|---|
| 1 | **Restaurant POI Enrichment** | claims + provenance + quality có sẵn | seed 5 CSV; làn scraping POI thật (§6.5); cảnh demo quality 0.6→0.9 | DEV1 |
| 2 | **Menu Extraction + OCR** | OCR text → structured claims có sẵn; ảnh/PDF chờ `OcrProvider` | nối vision LLM làm OcrProvider (ảnh menu, cache-first); demo từ `raw_ocr_text` CSV là đường chắc nhất | DEV1 (pipeline) + DEV3 (vision) |
| 3 | **Dish Recognition từ ảnh món** | ❌ **chưa có gì** | build mới: ảnh → vision LLM → tên món → `/search/dishes` → quán gần đó (§5.3) | DEV3 |
| 4 | **Food Search / semantic search** | search + dish search + filters + Vectorize có sẵn | verify chất lượng tiếng Việt; bật `ENABLE_AI_SEARCH`; giữ HARD gate trung thực (bẫy §11) | DEV2 |
| 5 | **AI Restaurant Assistant** (Q&A có nguồn) | assistant grounded có sẵn | prompt VN + chống bịa (bẫy Crystal BBQ); cache-first cho demo | DEV3 |
| 6 | **AI Summary + sentiment + strengths/weaknesses + cuisine class** | dữ liệu có trong CSV (strengths/weaknesses/cuisine); aggregates một phần | endpoint/field summary sinh bằng LLM + sentiment reviews, ghi vào restaurant detail | DEV3 |
| 7 | **Recommendation Engine** (personalize + localize) | `/recommendations` + deterministic rules có sẵn | port công thức SOFT score + `why{}` breakdown (§7) vào `ranking.ts` — đây là differentiator "vì sao gợi ý" | DEV2 |
| 8 | **POI Quality Scoring** | quality tables có sẵn | công thức completeness (điền được bao nhiêu field chuẩn) + hiển thị badge | DEV1 |
| 9 | **Restaurant Comparison** | `/restaurants/compare` có sẵn | UI màn so sánh 2 quán | UI |
| 10 | **UI khám phá + assistant** | — | nối `ui/` vào API thật, thêm màn theo §9 | UI |
| 11 | **Deck + video + README + methodology** | — | §10.5 BIZ + mỗi owner viết phần methodology của mình | BIZ |

---

## 2. Method — chốt 1 dòng (giữ nguyên)

> **Retrieve-then-rerank cold-start** (KALM4Rec, Kieu et al., [arXiv:2405.19612](https://arxiv.org/abs/2405.19612)): recall → **HARD gate** loại ràng buộc cứng (trung thực, không tự nới) → **SOFT score** (§7, personalize + localize + anti-luxury) → optional LLM rerank + giải thích tiếng Việt.

Vì sao không train deep model: 30 POI + 150 review → overfit (GETNext/LightGCN/SASRec cite làm scaling path, §12).

---

## 3. Kiến trúc (đã tồn tại trong `api/` — mô tả để cả team hiểu chung)

```
[ONLINE — api/ CF Workers]
HTTP API → D1 (canonical) / R2 (artifacts) → Queue
Queue → deterministic extraction / OcrProvider → candidate claims
Claim review → canonical menu/profile → search documents
Search docs → Workers AI embeddings → Vectorize
Search → Vectorize (hoặc D1 fallback) → HARD filters → ranking → response
Assistant → search → bounded context → answer + citations

[OFFLINE — làn phụ, cache-first]
preprocess/enrich.py → scrape POI THẬT (Apify/TinyFish/ZenRows) → enrichment import (provenance riêng)
Vision LLM (Qwen-VL / Gemini) → OcrProvider + dish recognition — kết quả demo cache sẵn ra đĩa
```

**Nguyên tắc sống còn cho demo:** mọi call LLM/vision đều **cache-first ra storage** — demo phải chạy được khi mất mạng/hết quota. Deterministic search (D1) là fallback khi Vectorize/AI tắt — có sẵn trong api.

**Latency:** search/rec thuần deterministic = tức thời với 30 POI. Bottleneck duy nhất = LLM (assistant/summary/vision) → cache theo hash(prompt).

---

## 4. Cấu trúc repo (final)

```
Toi-la-AI-TascoP11-AABW2026/
├── api/                    ← BACKEND (CF Workers, đã có) — DEV1/DEV2/DEV3 build tiếp vào đây
│   ├── src/{restaurants,menus,sources,claims,search,ai,routes,shared}/
│   ├── scripts/            ← seed 5 CSV (import-tasco/menus/reviews), evaluate-search
│   └── openapi/openapi.json  ← CONTRACT cho UI — nguồn sự thật duy nhất
├── ui/                     ← FRONTEND (T Maps prototype, đã có) — UI owner
│   └── src/App.tsx         ← đang mock; tách dần: api.ts + components + màn mới (§9)
├── preprocess/             ← OFFLINE optional (Python) — DEV1
│   └── enrich.py           ← scraping POI thật, cache-first (§6.5)
├── data/                   ← 5 CSV ground truth
├── PROBLEM STATEMENT.md    ← đề chính thức
├── api/tasco_maps_hackathon_api_documentation.md ← API doc Tasco
├── PLAN.md
└── README.md               ← submission: setup + technical overview + AI approach (BIZ tổng hợp)
```

~~`engine/` (Go)~~ — **không tạo nữa.**

---

## 5. Việc phải build (gap so với đề) — I/O rõ ràng

### 5.1 Seed + verify pipeline dữ liệu (DEV1, việc đầu tiên)
- **Input:** 5 CSV trong `data/`.
- Làm: `pnpm dev` → chạy `seed:tasco`, `seed:menus`, `seed:reviews`, `index:all` (scripts có sẵn). Map cột CSV → schema import (taxonomy VN §6: amenities, segments, price_level, opening_hours qua đêm "10:00-02:00").
- **Output/DoD:** `GET /api/v1/restaurants/{id}` trả đủ 30 quán, menu 179 món, review 150; `/search` trả kết quả tiếng Việt có dấu đúng.

### 5.2 SOFT score + `why{}` trong ranking (DEV2)
- Port công thức §7 vào `api/src/search/ranking.ts` (đã có deterministic rules — mở rộng, đừng viết lại).
- **Output:** mỗi result kèm `meta.why = {semantic, geo_decay, quality, persona, localness, luxury_penalty, final}` + `reasoning` tiếng Việt ("Cách bạn 1.2km · phù hợp gia đình · giá bình dân · còn mở tới 02:00").
- HARD gate giữ trung thực: rỗng → `not_found` + suggestions nới lỏng **có nhãn**, không tự nới (bẫy Halal-HCM).

### 5.3 Dish recognition từ ảnh (DEV3 — build mới hoàn toàn)
```
POST /api/v1/dishes/recognize  (multipart ảnh hoặc R2 key)
  → vision LLM (qwen-vl-plus / Gemini Flash): {dish_name, cuisine, confidence, alternatives[]}
  → match /search/dishes (fuzzy, bỏ dấu)
  → kết hợp lat/lon user → quán gần đó có món này
  → {recognized: {...}, matches: [{restaurant, dish, price, distanceMeters}]}
```
- Ảnh demo chọn trước (5–10 món VN phổ biến trùng với 179 món trong menu dataset: phở, bún chả, cơm tấm...), **kết quả vision cache sẵn** → demo không phụ thuộc mạng.
- Không train classifier (không có dataset ảnh + không kịp) — zero-shot vision LLM, ghi rõ trong methodology.

### 5.4 AI Summary + sentiment (DEV3)
- **Input:** restaurant + menu + 5 review/quán (CSV có sẵn `known_strengths/weaknesses`).
- LLM sinh: `ai_summary` (2–3 câu VN), `review_sentiment {pos/neu/neg ratio, aspects}`, `strengths[]`, `weaknesses[]`, `cuisine_classification`, `dining_occasions[]` (Family/Business/Romantic/Casual/FastFood — đề yêu cầu đúng list này).
- Chạy **1 lần batch cho 30 quán** → ghi vào D1, serve tĩnh trong restaurant detail. Không sinh lúc query.

### 5.5 OCR image → menu (DEV3 vision + DEV1 pipeline)
- Đường chắc ăn (bắt buộc): `raw_ocr_text` từ OCR Menu CSV → deterministic extraction → claims → review → canonical menu (api có sẵn) — demo được ngay "OCR extraction methodology".
- Đường ăn điểm (nếu kịp): implement `OcrProvider` = vision LLM đọc ảnh menu thật → cùng pipeline claims. 2–3 ảnh menu demo, cache kết quả.

### 5.6 Assistant chống bịa (DEV3)
- Prompt: chỉ trả lời từ context truy xuất; quán/món không có trong KB → trả `not_found` + message VN, **cấm bịa** (bẫy Crystal BBQ trong 15 câu eval).
- Cache Q&A của các câu demo + 15 câu eval.

### 5.7 UI nối API thật (UI owner) — chi tiết §9

---

## 6. Ánh xạ field CSV → tín hiệu (giữ nguyên, đã verify)

| Tín hiệu | Field CSV | Ghi chú |
|---|---|---|
| segment | `recommended_segments` ("Gia đình, Ăn nhanh...") | text VN → tag: family/romantic/fastfood/travel/budget/premium |
| diet | `cuisine_type`="Chay" / `category`="Nhà hàng chay" / Menu `dietary_tags` | không có cột diet riêng — suy đa nguồn |
| price | `price_level` (Bình dân/Trung bình/Cao cấp) + `avg_price_vnd` | |
| time | `opening_hours` ("09:00-23:00", "10:00-02:00" qua đêm) | |
| geo | `latitude`, `longitude` | haversine → geo_decay |
| city | `city` (7 tỉnh) | |
| anti-luxury | `price_level`="Cao cấp" → penalty; "Bình dân" + quality cao → boost | yêu cầu riêng TASCO |
| trust | `poi_quality_score` (0.86–0.99), `rating`, `popularity_score` | |
| amenity | `amenities_raw`: Bãi đỗ xe→parking, Phù hợp trẻ em→kid_friendly, Máy lạnh→air_con, Wi-Fi miễn phí→wifi, View đẹp→nice_view, Đặt bàn trước→reservation, Giao hàng→delivery, Không gian ngoài trời→outdoor, Nhạc nhẹ→music... | bảng hằng số trong import |

---

## 6.5 Enrichment & Scraping (differentiator — làn offline, DEV1)

Nguyên tắc **giữ nguyên từ plan cũ** (đầy đủ lý do xem git history):

1. **30 POI benchmark là data BỊA** → **KHÔNG scrape theo tên benchmark** (sẽ match nhầm quán thật = hallucination). Benchmark answers chỉ từ CSV. Scraping nhắm **POI thật** (Phở Thìn Lò Đúc...) để chứng minh engine enrich được data thật.
2. **Offline + cache-first:** scrape trước, import vào api với provenance/confidence riêng (hệ claims có sẵn — khớp hoàn hảo). Demo replay từ data đã import, không scrape live.
3. **Provenance hiển thị:** UI badge "nguồn: Google Places / Foody / TikTok" + confidence — thứ Google Maps không show.
4. **Consensus:** ≥2 nguồn đồng thuận mới thành fact (giờ mở, giá); social buzz chỉ là signal mềm.

Tool: **Apify** (Google Places/FB/TikTok actors) → **TinyFish/AgentQL** (trang schema động Foody/Riviu) → **ZenRows** (anti-bot) → LLM structure → import.

**Cảnh demo hero:** quán thật quality 0.6 → bấm enrich → 0.9, gaps_closed=["opening_hours","menu"], có badge nguồn. Chạy từ cache, rút mạng vẫn sống. **Cắt được hoàn toàn nếu thiếu giờ** — core không phụ thuộc.

---

## 7. Công thức xếp hạng — HARD gate → SOFT score (giữ nguyên, implement trong `ranking.ts`)

### 7.1 HARD gate (loại, không cho điểm)
```
fail nếu: dish đích danh không có · sai city · thiếu diet bắt buộc
          · giá > max · rating < min · không mở lúc yêu cầu
→ danh sách rỗng = not_found + suggestions nới lỏng CÓ NHÃN (không tự nới)
```

### 7.2 SOFT score
```
score = 0.30·semantic      # khớp query↔(tên+món+review): D1 lexical hoặc Vectorize
      + 0.20·geo_decay     # exp(-d/2km); THIẾU lat/lon → bỏ factor, renormalize
      + 0.15·quality       # poi_quality_score
      + 0.15·persona       # khớp segment+diet+price (0..1)
      + 0.10·rating_pop    # (rating/5 + popularity/100)/2
      + 0.10·localness     # bình dân + quality≥0.9 → +; family-run → +
      − 0.25·luxury_penalty # price_level=cao cấp → trừ
```
**Renormalize:** factor thiếu data → bỏ hẳn, chia lại trọng số (`wᵢ' = wᵢ/Σw_có_data`), không điền 0 giả. Tune tay trên 15 câu eval + 8 câu B/C (§11). Cite: LM-Prior (Ju et al., [arXiv:2411.09065](https://arxiv.org/abs/2411.09065)).

### 7.3 LLM rerank (optional, cắt đầu tiên)
Top-10 → Qwen structured JSON → thứ tự cuối + `reasoning`. Bỏ được: SOFT order vẫn tốt.

---

## 8. API contract — align với Tasco Maps API doc

`api/openapi/openapi.json` là contract nội bộ UI↔backend. Thêm lớp align với doc Tasco:

**Đã có:** facade `GET /v1/search` + `GET /search` (Tasco-compatible), trả `PlaceResult`.

**Checklist compatibility (từ API doc — BTC chấm "integration-ready"):**
- [ ] `PlaceResult`: `id, type, name, label, address, category, coordinates{lat,lon}, distanceMeters, score, source` — map được vào `SearchSuggestion` của app Flutter (bảng mapping trong doc).
- [ ] `ErrorResponse`: `{error:{code,message,details}, requestId}` + đúng bảng mã lỗi (400 `invalid_request`, 404 `not_found`, 429 `rate_limited`...).
- [ ] Stable IDs; WGS84 lat/lon; **giữ tiếng Việt có dấu**.
- [ ] Auth pluggable: `Authorization: Bearer` hoặc `X-API-Key`; base URL configurable; không hardcode key.
- [ ] Headers khuyến nghị: `X-Request-Id`, `X-Locale: vi-VN`, `X-Timezone: Asia/Ho_Chi_Minh`.
- [ ] Deterministic mock data cho test/demo.
- [ ] Submission kèm: OpenAPI spec (✅ có), REST examples, notes về ranking/enrichment/latency/fallback/provenance (BIZ gom vào README).

**Endpoint bổ sung (mới):** `POST /api/v1/dishes/recognize` (§5.3). Cân nhắc thêm alias `GET /v1/poi/{id}` → restaurant detail (khớp POI API trong doc, có `aiSummary`).

---

## 9. Frontend — từ T Maps prototype → sản phẩm demo (UI owner)

Prototype đã có phone-frame + map + bottom sheet + search + route + nav HUD (mock). Việc còn lại theo thứ tự:

1. **Tách `api.ts`** — client typed theo `openapi.json`: `search(q, filters)`, `recommend(params)`, `getRestaurant(id)`, `getMenu(id)`, `compare(ids)`, `assistant(msg)`, `recognizeDish(file)`. Base URL qua env (`VITE_API_BASE`, mặc định `http://localhost:5173`).
2. **Thay mock bằng API thật** cho search + place details (menu thật, giá thật, giờ mở thật).
3. **FilterChips** — Segment (Gia đình/Hẹn hò/Nhóm/Ăn nhanh) · Diet (Chay/Halal) · Price (Bình dân/TB/Cao cấp) · "Mở cửa bây giờ". Bấm → gọi lại API → marker + list update (personalize NHÌN THẤY ĐƯỢC).
4. **ResultCard + "Vì sao gợi ý?"** — xổ `meta.why` thành bar từng factor + `reasoning` VN + badge quality. Differentiator số 1.
5. **Màn theo demo scene:** AssistantBox (chat + citations); Compare (2 quán cạnh nhau); Dish-photo (upload ảnh → món nhận diện → quán gần); badge provenance/confidence trên field enrich; empty-state `not_found` hiển thị message + suggestions dạng chip bấm được.
6. Layout giữ ngôn ngữ thiết kế T Maps sẵn có; desktop = map trái + list phải.

**Chốt sớm với DEV2/DEV3:** shape `why{}`, shape assistant citations, shape recognize response — lấy từ openapi.json, không tự bịa.

---

## 10. Timeline — 3 ngày (key Qwen hết hạn 14/7)

### Phase 0 — Verify + seed (T6 11/7 tối, cả team) ★ GATE
- `api/`: `pnpm install && pnpm typecheck && pnpm test && pnpm dev` — **PASS/FAIL công khai trong nhóm**.
- DEV1 seed 5 CSV + index; DEV2 bắn 5 query search thử; UI chạy `npm run dev`; DEV3 test 1 call Qwen + 1 call vision sống.
- `.env`/`.dev.vars`: `DASHSCOPE_API_KEY` — **không commit key** (`.dev.vars` đã trong .gitignore của api).
- BIZ: đọc kỹ PROBLEM STATEMENT + dựng khung deck (problem/solution/architecture/business value/impact) + **hỏi BTC về Food Image Dataset**.

### Phase 1 — Core sống (T7 12/7) ★ MVP
- DEV1: taxonomy normalize chuẩn (§6) + quality completeness score.
- DEV2: SOFT score + `why{}` + not_found trung thực trong ranking.ts; facade Tasco checklist (§8).
- DEV3: batch AI summary + sentiment 30 quán ghi vào D1; assistant prompt VN chống bịa.
- UI: api.ts + search/details chạy data thật + FilterChips.
- **DoD:** cảnh demo lõi chạy end-to-end: gõ "quán chay gần đây" → map update → card có why → mở detail thấy menu + summary.

### Phase 2 — Đủ 7 cảnh demo (CN 13/7)
- DEV3: dish recognition endpoint + cache ảnh demo; OCR image provider (nếu kịp — không kịp thì demo OCR từ raw text CSV, vẫn đạt đề).
- DEV1: enrichment lane — scrape 10–20 POI thật, import với provenance, cảnh 0.6→0.9.
- DEV2: chạy eval A/B/C (§11), tune weights, fix bẫy.
- UI: Compare + AssistantBox + dish-photo + provenance badge + polish (animation marker, empty-state đẹp).
- BIZ: deck draft đủ slide + demo script 7 cảnh + quay thử video.
- **DoD:** chạy thử toàn bộ demo script, rút mạng giữa chừng vẫn sống (cache).

### Phase 3 — Đóng gói (T2 14/7)
- Freeze code sáng 14/7. Eval lần cuối, số liệu chốt cho BIZ.
- README submission: setup + technical overview + AI approach + 5 methodology (enrichment/OCR/dish recognition/recommendation/quality — mỗi owner viết phần mình, BIZ biên tập).
- Video demo final + deck final + deploy (CF Workers deploy có sẵn lệnh) hoặc chạy local ổn định.

**Đường cắt nếu cháy giờ (cắt theo thứ tự):** LLM rerank (7.3) → enrichment scraping (6.5, thay bằng slide) → OCR image provider (giữ OCR-from-text) → Tauri packaging. **KHÔNG cắt:** 7 cảnh demo tối thiểu, `why{}`, chống bịa, seed data đúng.

---

## 10.5 Phân công 5 người — 1 UI · 3 dev · 1 business (theo sở hữu file, zero conflict)

Nguyên tắc: mỗi người sở hữu 1 nhóm file, không sửa file người khác. **Contract chung duy nhất = `api/openapi/openapi.json`** — đổi response shape phải cập nhật spec trước, báo trong nhóm.

| Ai | Vai trò | Sở hữu (file/thư mục) | Deliverable chấm được |
|---|---|---|---|
| **UI** (1 người) | Frontend & Demo surface | toàn bộ `ui/` (`api.ts`, components, màn Compare/Assistant/DishPhoto, why-breakdown, provenance badge) | app demo "trông cool": map + chips + why + 7 cảnh có mặt trên màn hình |
| **DEV1** | Data · Ingestion · Enrichment · Quality | `api/scripts/*` (seed), `api/src/{sources,claims,menus}/` phần import/taxonomy, `preprocess/enrich.py`, quality score | 30 POI + 179 món + 150 review sạch trong D1; OCR-text→menu pipeline chạy; cảnh enrich 0.6→0.9 + provenance |
| **DEV2** | Search · Ranking · Recommendation · Eval | `api/src/search/*` (query-parser, ranking, filter-merge, geo), facade `routes/tasco.ts`, `scripts/evaluate-search.mjs` | SOFT score + `why{}` + not_found trung thực; personalize/localize verify bằng eval §11; Tasco compatibility checklist ✅ |
| **DEV3** | AI: LLM · Vision · Assistant | `api/src/ai/*` (prompts, schemas, embeddings), assistant route, endpoint `dishes/recognize`, OcrProvider, batch summary/sentiment | assistant Q&A có nguồn + không bịa; dish recognition demo; AI summary 30 quán; cache-first mọi call |
| **BIZ** (1 người) | Business · Pitch · Demo production | deck (Canva/Figma), demo script + video, `README.md` submission, roadmap slide (§12), bibliography (§14) | deck đủ problem/solution/architecture/business value/impact; video; demo script 7 cảnh chạy trơn; submission checklist ✅ |

**Phối hợp chéo (chốt trong Phase 0):**
- UI ↔ DEV2/DEV3: shape `why{}`, citations, recognize response (qua openapi.json).
- DEV1 → DEV2: taxonomy tag chuẩn (segment/diet/price) để ranking dùng.
- DEV3 → DEV1: OcrProvider cắm vào pipeline claims của DEV1.
- Mỗi dev viết 3–5 gạch đầu dòng methodology phần mình → BIZ biên tập vào deck/README (đề bắt nộp đủ 5 methodology).
- BIZ là **người chạy demo thử mỗi tối** — phát hiện cảnh gãy sớm nhất.

**Nếu hụt người/giờ:** enrichment (DEV1) và OCR-image (DEV3) là 2 mảng co được; UI có thể mượn BIZ làm asset hình + copywriting cho card/empty-state.

---

## 11. Eval plan (DEV2 own, chạy bằng `scripts/evaluate-search.mjs` mở rộng)

- **Nhóm A — 15 câu Public Evaluation CSV:** đủ loại task (rec, menu OCR, dish...). Không được sai bẫy: **Crystal BBQ → not_found** (cấm bịa), **Halal ở HCM → trả trung thực + suggestions**, không nhầm city.
- **Nhóm B — personalize (5 câu tự đặt):** Romantic → loại fastfood; vegetarian → 100% có món chay; time=00:30 → chỉ quán qua đêm; Family → ưu tiên parking+kid_friendly; budget → loại Cao cấp.
- **Nhóm C — localize (3 câu):** lat/lon HN → top-3 HN không lẫn HCM; đổi vị trí → kết quả đổi; "bún chả HCM" khi đang ở HN → override theo query.

**DoD:** A không sai bẫy; B/C ≥ 7/8 pass. Số pass/fail đưa vào deck (slide "evaluation").

---

## 12. Future Work (slide Roadmap — không build)

- Embedding semantic search full (Qwen text-embedding-v3 / vietnamese-embedding) thay lexical fallback.
- HuTieuBERT NER/POS cho entity tiếng Việt (đã chuyển từ scope chính xuống đây — api dùng fuzzy match + known-entity list là đủ cho 30 POI).
- Route-aware recommend dọc hành trình (Valhalla — khớp Route API trong doc Tasco, differentiator VETC).
- Behavior ranking từ dữ liệu di chuyển thật VETC.
- Enrichment scale toàn VN (agentic scraping + OCR menu ảnh hàng loạt).
- Social buzz reranking (TikTok/Threads mention → signal mềm, decay theo tuần).
- 5-tier source registry (CSV → licensed API → agentic-facts → social → business-verified).
- Deep recommenders (LightGCN/GETNext/SASRec) khi POI lên 10⁴–10⁶.
- Tauri desktop / tích hợp SDK Flutter cho app T Maps thật (client adapter như doc yêu cầu).

---

## 13. Methodology narrative (dán vào README + deck)

> The system ingests fragmented restaurant data (POIs, unstructured menus, OCR text, reviews) into a **claims-based knowledge pipeline**: every extracted fact carries provenance, confidence, and review state before it materializes into the canonical profile — turning unstructured input into *trustworthy* restaurant intelligence, per the P11 design principle. Menu intelligence combines deterministic Vietnamese price/dish parsing with a vision-LLM OCR provider. Dish recognition uses zero-shot vision LLM inference linked to the dish index. The recommender follows the **retrieve-then-rerank cold-start paradigm** (KALM4Rec, Kieu et al., 2024): hard-constraint gates (dietary, city, price, opening hours) that reject rather than silently relax — queried entities absent from the knowledge base return not_found, never a fabrication — then a linear soft score combining lexical/semantic relevance, geographic decay (exp(-d/2km), GeoMF, Lian et al., KDD 2014), POI quality, persona match, and an anti-luxury term favoring small local eateries per the TASCO brief. Missing signals are dropped and weights renormalized rather than zero-filled. The assistant answers only from retrieved, cited context. We deliberately avoid training deep recommenders on 30 POIs (overfitting); they are the scaling roadmap.

---

## 14. Citations (deck bibliography)

**Core:**
1. Kieu, D. et al. **KALM4Rec** — cold-start retrieve-then-rerank. [arXiv:2405.19612](https://arxiv.org/abs/2405.19612), 2024.
2. Lian, D. et al. **GeoMF.** [KDD 2014](https://dl.acm.org/doi/10.1145/2623330.2623638).
3. Ju, J. et al. **Language-Model Prior for Cold-Start.** [arXiv:2411.09065](https://arxiv.org/abs/2411.09065), 2024.
4. Reimers & Gurevych. **Sentence-BERT.** EMNLP 2019.
5. Cormack et al. **Reciprocal Rank Fusion.** [SIGIR 2009](https://dl.acm.org/doi/10.1145/1571941.1572114).

**Related / Future:**
6. Li, P. et al. **LLMs for Next POI Recommendation.** [arXiv:2404.17591](https://arxiv.org/abs/2404.17591), SIGIR 2024.
7. He, X. et al. **LightGCN.** [arXiv:2002.02126](https://arxiv.org/abs/2002.02126), SIGIR 2020.
8. Yang, S. et al. **GETNext.** SIGIR 2022. · 9. Kang & McAuley. **SASRec.** ICDM 2018. · 10. Kula. **LightFM.** RecSys 2015.
11. **LLMTreeRec.** [arXiv:2404.00702](https://arxiv.org/abs/2404.00702). · 12. **POI Recommendation Survey.** [arXiv:2410.02191](https://arxiv.org/abs/2410.02191).
13. Li, Y. et al. **Personalized Query Auto-Completion at Baidu Maps.** [ACM 2020](https://dl.acm.org/doi/10.1145/3394137). *(paper BTC đưa)*

---

## 15. Submission checklist (từ PROBLEM STATEMENT — BIZ track, mỗi mục có owner)

- [ ] Presentation deck: problem, solution, architecture, business value, impact — **BIZ**
- [ ] Live demo + recorded video — **BIZ** (script) + cả team (chạy)
- [ ] Source repo + README setup/technical overview/AI approach — **BIZ** biên tập, dev viết phần mình
- [ ] Data enrichment workflow — **DEV1**
- [ ] OCR & extraction methodology — **DEV1+DEV3**
- [ ] Dish recognition approach — **DEV3**
- [ ] Recommendation methodology — **DEV2**
- [ ] POI quality evaluation approach — **DEV1**
- [ ] Demo đủ 7 cảnh: enrichment · menu OCR extraction · dish recognition · AI summary · comparison · personalized recommendation · assistant Q&A — **cả team, BIZ điểm danh từng cảnh**

**Trước khi code (tối 11/7):** Phase 0 verify `api/` PASS → phân vai theo §10.5 → chốt contract openapi.json → hỏi BTC food image dataset → **không commit API key**.

---

*Refined 11/7 theo problem statement chính thức + Tasco API doc. Kiến trúc chốt: build tiếp trên `api/` (CF Workers) + `ui/` (T Maps prototype); Go engine bỏ. Bản plan trước xem git history.*
