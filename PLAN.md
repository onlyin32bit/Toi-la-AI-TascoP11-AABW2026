# BUILD PLAN — Tasco P11 AI-Powered Restaurant & Menu Intelligence

> **Repo làm việc:** `Toi-la-AI-TascoP11-AABW2026/`.
> **Kiến trúc:** **Go engine (online) + Python (offline preprocessing/ML)** — build mới, KHÔNG dùng `api/` (CF Workers) làm backend chính.
> **Team 5 người: 1 UI · 3 dev · 1 business/pitch** — phân công ở §10.5.
> **Mục tiêu:** sản phẩm **chạy được + trông cool**, phủ đủ scope P11 chính thức (§1) — không chỉ recommender.
> **Kim chỉ nam — LOCALIZATION-FIRST (§1.5):** thứ khiến BGK thấy nổi bật KHÔNG phải "một recommender nữa", mà là **engine hiểu ẩm thực Việt ở tầng bản địa** — đặc sản vùng miền, tiếng Việt có/không dấu + teencode + tiếng lóng, văn hoá giờ ăn (sáng phở, tối nhậu, ăn khuya), chay kỳ, và stack NLP thuần Việt (HuTieuBERT, embedding Việt). Mọi quyết định thiết kế ưu tiên chiều sâu bản địa hoá.
> **Trạng thái:** plan final; DEV1 engine + test đã xong (§5), localize là lớp tăng cường đang thêm.

---

## 0. Ta đang có gì / cần gì

**Đã có:**
- `ui/` — T Maps UI prototype (React 19 + Vite + Leaflet + Tauri), phone-frame, search/bottom-sheet/route/nav HUD. **Toàn bộ data mock trong `App.tsx`, chưa gọi backend nào.** Đây là base UI, không phải scaffold trống.
- `api/` (CF Workers) — tồn tại trong repo nhưng **không dùng làm backend chính** (team không quen/không muốn maintain CF stack); có thể tham khảo OpenAPI/schema nếu tiện, không phụ thuộc.
- `data/` — 5 CSV: POI (30 quán, 7 tỉnh), Menu (179 món), OCR Menu (18 quán, raw text), Reviews (150), Public Evaluation (15 câu chấm).
- `PROBLEM STATEMENT.md` — đề chính thức P11 (scope đầy đủ, §1).
- `api/tasco_maps_hackathon_api_documentation.md` — API doc Tasco Maps (DTO, compatibility requirements, §8).
- Qwen DashScope key (hết hạn **14/7**) — LLM chính; Gemini free tier dự phòng.
- A40 48GB (optional, self-host embedding/LLM nếu cần).

**Cần build:**
1. **Backend engine** (Go, zero-dep core) — load data → index → recommend theo query + vị trí + personalize + assistant + dish recognition + OCR.
2. **Preprocess offline** (Python) — CSV→kb.json, embed, NER, enrich, batch AI summary.
3. **Frontend** — nối `ui/` (T Maps prototype có sẵn) vào Go engine qua HTTP, thay dần mock data.

**Chốt stack:**

| Layer | Chọn | Lý do |
|---|---|---|
| Backend online | **Go** — serve HTTP / retrieve / rerank / geo / vision-call / OCR-call → 1 binary tĩnh, nhanh, offline-safe | production-ready; ranh giới ở §3.3 |
| Preprocess offline | **Python** — CSV→kb.json, embed, NER, enrich, batch summary (chạy 1 lần) | hệ sinh thái ML ở Python; output là file, Go đọc |
| Data | 5 CSV trong `data/` (đã có) | ground truth |
| Semantic (core) | lexical token-match | zero-dep, chạy chắc, không cần ML runtime |
| Semantic (nâng cao) | **Qwen `text-embedding-v3` (API)** — chốt dùng; bản local tốt nhất nếu cần: `AITeamVN/Vietnamese_Embedding` (BGE-M3, SOTA VN retrieval) | Go gọi API được; local chỉ khi muốn offline hẳn. *Nếu còn giờ* |
| Vision (dish recognition, OCR ảnh) | **Qwen-VL / Gemini Flash Vision** qua HTTP từ Go, kết quả cache đĩa | zero-shot, không train, cache-first cho demo |
| NER / tách từ VN | **HuTieuBERT** (Python, offline/sidecar) | phát hiện tên quán/món → chống hallucination; KHÔNG dùng làm embedding |
| LLM | **Qwen** (DashScope OpenAI-compatible) chính; Gemini Flash dự phòng — **cache-first ra đĩa** | query parse + rerank + assistant + AI summary; demo sống khi mất mạng |
| Enrichment / scraping | **Apify** (Google Places/FB/TikTok actors) + TinyFish/AgentQL (agentic) + ZenRows (anti-bot HTML) → LLM structure | offline, cache-first, tier riêng — §6.5 |
| Frontend | `ui/` có sẵn — React 19 + Vite + Leaflet + Tauri | đã có phone-frame + map, chỉ cần nối API thật |
| Desktop wrap | Tauri (đã có trong `ui/src-tauri/`) | chạy `vite dev` trong browser đủ demo; Tauri là bonus có sẵn |

---

## 1. Scope P11 — coverage matrix (đề yêu cầu gì, ai làm)

Đề KHÔNG phải chỉ "food recommender" — là **Restaurant & Menu Intelligence platform**: enrich POI + hiểu menu + OCR + nhận diện món từ ảnh + search + assistant + recommend + quality score. Submission bắt buộc demo đủ **7 cảnh** cuối bài.

| # | Deliverable đề yêu cầu | Việc cần build | Owner |
|---|---|---|---|
| 1 | **Restaurant POI Enrichment** | build_kb.py (structured profile từ CSV) + **UGC đóng góp quán/menu (§5.10)** làm câu chuyện enrichment chính; scraping (§6.5) = dự phòng | DEV2 + DEV1/DEV3 (UGC) |
| 2 | **Menu Extraction + OCR** | đường chắc: `raw_ocr_text` (OCR Menu CSV) → parse có cấu trúc trong `build_kb.py`; đường ăn điểm: ảnh menu → vision LLM → structured, cache-first | DEV2 (parse) + DEV3 (vision) |
| 3 | **Dish Recognition từ ảnh** | mới hoàn toàn: ảnh món → vision LLM → tên món → match dish index → quán gần đó (§5.5) | DEV3 |
| 4 | **Food Search / semantic search** | `retrieve.go` — lexical token-match core + optional embedding | DEV1 |
| 5 | **AI Restaurant Assistant** (Q&A có nguồn) | `assistant.go` RAG, chống bịa, cache-first | DEV3 |
| 6 | **AI Summary + sentiment + strengths/weaknesses + cuisine class + dining occasions** | batch Python script chạy 1 lần cho 30 quán, ghi vào kb.json (§5.6) | DEV3 |
| 7 | **Recommendation Engine** (personalize + localize + "vì sao gợi ý") | `rerank.go` SOFT score + `why{}` breakdown (§7) — differentiator chính | DEV1 |
| 8 | **POI Quality Scoring** | completeness score trong `build_kb.py`, hiển thị badge | DEV2 |
| 9 | **Restaurant Comparison** | `GET /v1/compare?ids=...` trong Go + màn so sánh UI | DEV1 + UI |
| 10 | **UI khám phá + assistant** | nối `ui/` (T Maps prototype có sẵn) vào Go engine (§9) | UI |
| 11 | **Deck + video + README + methodology** | §10.5 BIZ + mỗi owner viết phần methodology của mình | BIZ |
| 12 | **UGC: đóng góp quán + chụp menu OCR** (crowdsource enrichment) | `contribute.go` (add POI + attach menu) + OCR vision + UI form/upload (§5.10). **Thay làn scraping làm câu chuyện enrichment chính** | DEV1 (endpoint) + DEV3 (OCR) + UI (form) |

---

## 1.5 LOCALIZATION-FIRST — differentiator số 1 cho BGK

Google Maps / Foody đối xử tiếng Việt như "một ngôn ngữ nữa". Ta đi sâu hơn: **hiểu ẩm thực Việt ở tầng bản địa**. Đây là câu chuyện bán cho BGK, và mỗi ý dưới đây gắn với 1 tính năng cụ thể trong engine.

### Câu bán 1 dòng
> *"Gõ `bun bo hue` không dấu ở Huế → lên đúng đặc sản bún bò, cơm hến; cùng câu `đặc sản gần đây` ở Đà Lạt lại ra lẩu gà lá é, bánh tráng nướng. Engine hiểu **món nào thuộc vùng nào, người Việt ăn gì theo giờ, và nói kiểu Việt** — thứ Google Maps VN không làm."*

### 6 trụ localize (mỗi trụ = 1 feature, có mức độ ưu tiên)

| # | Trụ localize | Làm gì trong engine | Nơi cắm | Mức |
|---|---|---|---|---|
| L1 | **Tiếng Việt có/không dấu** | `norm()` bỏ dấu 2 chiều — `bun bo` khớp `Bún Bò`. ĐÃ CÓ + test. | `kb.go norm` | ✅ done |
| L2 | **Teencode + tiếng lóng** | bảng chuẩn hoá `k/ko→không, dc/đc→được, j→gì, bao nhiu→bao nhiêu`; lóng `quán ruột, ngon bổ rẻ, chặt chém(−), nhậu`. Chuẩn hoá TRƯỚC khi parse. | `retrieve.go` (slang map) | ⚡ quick win |
| L3 | **Đặc sản vùng miền** | ontology `vùng → món đặc trưng`; boost quán phục vụ đặc sản của **thành phố user đang đứng**. Đây là **factor localize mạnh nhất để demo**. | `taxonomy` + `rerank.go` (`local_specialty`) | ⚡ quick win |
| L4 | **Văn hoá giờ ăn Việt** | prior `giờ → intent`: sáng (phở/bún/bánh mì/xôi/cà phê), trưa (cơm), tối (lẩu/nướng/nhậu), khuya (cháo/phở đêm/ốc). Khi query mơ hồ + có `time` → gợi ý đúng nếp ăn. | `retrieve.go` (meal-time prior) | ⚡ quick win |
| L5 | **Phân loại ẩm thực theo vùng** | `cuisine_classification` ghi rõ "Việt Nam — miền Trung (Huế)" thay vì chỉ "Việt Nam". | `summarize.py` (DEV3) | should |
| L6 | **Chay kỳ (âm lịch)** | mùng 1 & rằm ÂL → boost quán chay (người Việt ăn chay theo kỳ). | `rerank.go` + lunar util | 🔭 stretch |

### L3 — đặc sản vùng miền (ontology cho đúng 7 tỉnh trong dataset)

```
Hà Nội   → phở, bún chả, bún thang, chả cá
Huế      → bún bò Huế, cơm hến, bánh bèo/nậm/lọc
Đà Nẵng  → mì Quảng, bánh xèo, bún mắm
Nha Trang→ hải sản, bún cá, nem nướng
Hạ Long  → hải sản, chả mực, bánh cuốn chả mực
Đà Lạt   → đồ nướng, bánh tráng nướng, atiso, lẩu gà lá é
TP.HCM   → cơm tấm, hủ tiếu, bánh mì
```
`local_specialty(poi, user_city)` = 1.0 nếu quán phục vụ món đặc sản của thành phố user đang đứng, ngược lại 0. Vào SOFT score (§7.2) như 1 factor renormalize được → **cùng query `"đặc sản gần đây"` cho kết quả khác nhau theo tỉnh** (khoảnh khắc demo đắt nhất).

### Stack NLP thuần Việt (kể trong deck)
- **HuTieuBERT** (ACL 2026, morpheme-aware tiếng Việt) → NER tên quán/món (chống hallucination) + tách từ.
- **Embedding Việt**: Qwen `text-embedding-v3` (API) hoặc `AITeamVN/Vietnamese_Embedding` (BGE-M3, SOTA VN). Benchmark VN-MTEB.
- **Qwen** mạnh tiếng Việt cho assistant + reasoning; output **giữ nguyên dấu**.
- Roadmap: **ViSoBERT / ViGSA** cho sentiment/aspect review tiếng Việt (§12).

### Ưu tiên build (12h)
- **Làm ngay (⚡):** L2 slang map + L3 đặc sản vùng miền + L4 meal-time prior — đều rule-based, rẻ, DEV1/DEV2, ~2–3h, và là 3 khoảnh khắc demo localize rõ nhất.
- **Should:** L5 phân loại vùng (DEV3 summarize).
- **Stretch (🔭):** L6 chay kỳ âm lịch.

---

## 2. Method — chốt 1 dòng

> **Retrieve-then-rerank cold-start** (KALM4Rec paradigm, Kieu et al., [arXiv:2405.19612](https://arxiv.org/abs/2405.19612), 2024): rule-based recall → **HARD gate** loại ràng buộc cứng → **SOFT score** cộng điểm mềm (personalize + localize + anti-luxury) → (optional) **LLM rerank + giải thích**.

Vì sao không deep model: 30 POI + 150 review = quá nhỏ để train (GETNext/LightGCN/SASRec sẽ overfit). Cite chúng ở "Future Work / scaling". Chi tiết lý do ở §12.

---

## 3. Kiến trúc: OFFLINE preprocessing vs ONLINE query (trả lời câu hỏi latency)

**Đúng — muốn query nhanh thì phải preprocess trước.** Chia mọi việc theo *"cái gì không đổi giữa các query"* (làm sẵn 1 lần) vs *"cái gì đổi theo query"* (làm lúc query, giữ nhẹ).

### 3.1 OFFLINE — build 1 lần lúc khởi động (`python -m engine.build_kb`)

```
CSV (5 file)
  → parse + join (POI ⋈ Menu ⋈ Reviews theo restaurant_id)
  → normalize: amenities_raw/segments text VN → taxonomy chuẩn
                price_level → {bình dân, trung bình, cao cấp}
                opening_hours → (open_min, close_min, qua_đêm?)
  → precompute: token index (cho lexical search)
                [optional] embedding vector mỗi POI
                poi_quality_score, popularity đã có sẵn
                AI summary/sentiment/cuisine_class/dining_occasions (batch LLM, 1 lần)
  → dump build/kb.json  (+ build/vectors.npy nếu có embedding)
```

Nặng nhất = embed corpus + batch LLM summary (nếu bật). Làm 1 lần, lưu đĩa. **Cache-first: có `kb.json` thì load thẳng, không parse lại.**

### 3.2 ONLINE — mỗi query, phải nhẹ (`GET /v1/recommend`)

```
query + user_ctx (lat/lon, segment, diet, price, time)
  → parse_query → FilterSpec        (regex, <1ms)
  → recall: token match trên index đã build   (30 POI → tức thời)
  → HARD gate: loại quán fail ràng buộc cứng
  → SOFT score: công thức §7 trên vài chục ứng viên   (<1ms)
  → [optional] LLM rerank top-10     (0.5–2s, có CACHE)
  → trả JSON
```

**Kết luận latency:**
- Core (không LLM) = **gần như tức thời** với 30 POI, vì tính nặng đã đẩy sang offline.
- Bottleneck duy nhất = LLM/vision call (nếu bật). Giảm bằng: **cache theo query** (câu lặp → 0 latency) + **bỏ được LLM** (SOFT score thuần Go vẫn ra kết quả tốt).
- A40 chỉ giúp nếu **self-host embedding/LLM**; nếu gọi API thì A40 vô dụng cho latency. → Core không phụ thuộc A40.

### 3.3 Phân chia ngôn ngữ — Go (online) + Python (offline ML)

Ranh giới sạch: **cái gì cần ML runtime → Python offline; cái gì chạy mỗi query → Go**.

| | Ngôn ngữ | Chạy khi | Làm gì |
|---|---|---|---|
| **Online serving** | **Go** | mỗi query | serve HTTP · parse_query · recall · HARD gate · SOFT score · geo · gọi Qwen/vision/Apify (HTTP) |
| **Offline preprocess** | **Python** | 1 lần (build) | CSV→kb.json · normalize · embed corpus (Qwen/ST) · NER tag (HuTieuBERT) · batch AI summary · scrape enrich |

- Go **không chạy model local** — embedding/NER/summary làm sẵn offline (ghi vào kb.json), hoặc query-time gọi **Qwen/vision API** (Go gọi được vì là HTTP).
- Nếu bỏ hẳn ML (core lexical) → **chỉ cần Go**, không cần Python runtime lúc chạy. Đây là đường an toàn nhất.
- Lợi: 1 binary Go tĩnh, khởi động tức thì, offline-safe, "production-ready".

### 3.4 Deploy — server thường (không serverless/CF)

Thứ tự: **preprocess 1 lần → deploy binary + static + kb.json**.

1. **Offline (1 lần, máy dev hoặc A40):** `python build_kb.py` (+ embed/summarize/enrich nếu bật) → sinh `engine/build/kb.json` (+ cache). scp kèm khi deploy — server **không** cần Python lúc chạy.
2. **Backend:** `go build` → 1 binary `engine`. Chạy trên server (systemd / pm2 / `nohup`), lắng nghe `:8000`. Kèm thư mục `build/` (kb.json + cache) cạnh binary.
3. **Frontend:** `npm run build` → static (`ui/dist`). 2 lựa chọn:
   - **Đơn giản nhất (khuyến nghị):** cho Go serve luôn `ui/dist` ở `/` → **cùng origin, khỏi CORS**, 1 process duy nhất.
   - Hoặc nginx/Caddy serve static + reverse-proxy `/v1/*` → `:8000`.
4. **Config:** `DASHSCOPE_API_KEY` + base URL đặt qua **env trên server** (không commit). `api.ts` đọc base URL từ env Vite (`VITE_API_BASE`), mặc định `localhost:8000` lúc dev.
5. **Offline-safe:** kb.json + cache LLM/vision đi kèm binary → demo/deploy chạy được cả khi rớt mạng.

> Vì mọi thứ nặng đã precompute ra file, deploy = copy 1 binary + `build/` + `dist/`. Không DB, không runtime ML trên server.

---

## 4. Cấu trúc repo (build vào đây)

```
Toi-la-AI-TascoP11-AABW2026/
├── engine/                      ← BACKEND online (Go)
│   ├── main.go                  ← HTTP :8000, /v1/recommend, /v1/compare ...
│   ├── kb.go                    ← load kb.json, norm(), is_open_at(), haversine()
│   ├── retrieve.go              ← parse_query + recall + HARD gate
│   ├── rerank.go                ← SOFT score (personalize/localize/anti-luxury) + why{}
│   ├── llm.go                   ← Qwen client (HTTP), cache-first ra đĩa      [optional]
│   ├── assistant.go             ← RAG trả lời Q&A, trích nguồn                [optional]
│   ├── vision.go                ← dish recognition + OCR ảnh (Qwen-VL/Gemini) [§5.5]
│   ├── compare.go               ← so sánh 2+ quán
│   ├── contribute.go            ← UGC: add POI + gắn menu OCR → contributions.json [§5.10]
│   └── build/                   ← kb.json, enrichment.json, contributions.json, cache (git-ignored)
├── preprocess/                  ← OFFLINE (Python, chạy 1 lần)
│   ├── data/                    ← copy 5 CSV vào đây (từ `data/` gốc)
│   ├── build_kb.py              ← CSV → build/kb.json (normalize, embed, NER, quality)
│   ├── embed.py                 ← Qwen/ST embedding corpus            [optional]
│   ├── ner_hutieubert.py        ← HuTieuBERT tag tên quán/món         [optional, §5.4]
│   ├── summarize.py             ← batch AI summary/sentiment/cuisine/dining_occasions [§5.6]
│   └── enrich.py                ← scrape POI thật → enrichment.json  [§6.5, optional]
├── ui/                          ← FRONTEND (T Maps prototype có sẵn)
│   └── src/
│       ├── App.tsx              ← thay dần mock bằng API thật
│       ├── api.ts               ← fetch engine Go (mới)
│       ├── components/
│       │   ├── MapView / SearchBar / FilterChips / ResultCard (có sẵn, mở rộng)
│       │   ├── CompareView.tsx  ← so sánh quán               [mới]
│       │   ├── AssistantBox.tsx ← chat Q&A                    [mới]
│       │   ├── DishPhoto.tsx    ← upload ảnh nhận diện món     [mới]
│       │   ├── ContributeForm.tsx ← thả pin + form thêm quán  [mới, §5.10]
│       │   └── MenuUpload.tsx   ← chụp/upload menu → OCR       [mới, §5.10]
│       └── types.ts
├── data/                        ← 5 CSV gốc (đã có)
├── PROBLEM STATEMENT.md
├── api/tasco_maps_hackathon_api_documentation.md
├── PLAN.md
└── README.md                    ← methodology + setup
```

---

## 5. Backend — từng module (I/O rõ ràng)

### 5.0 Data flow — mỗi phần output ra cái gì

```
[Python OFFLINE — chạy 1 lần]                    [Go ONLINE — mỗi query]
 5 CSV
   │ build_kb.py                                   HTTP request
   ▼                                                  │ main.go
 build/kb.json ────────────┐                          ▼
   │ embed.py    [opt]      │                     parseQuery() → FilterSpec
   ▼                        │                          │ retrieve.go
 build/vectors.json [opt]   ├──► kb.Load() ──► recall() → []ứng viên
   │ ner_hutieubert.py [opt]│                          │ HARD gate
   │ summarize.py           │                          ▼
   ▼                        │                     rerank.go → top-K + why{}
 (kb.json đầy đủ)           │                          │ llm.go/assistant.go/vision.go [opt]
                            │                          ▼
 enrich.py [opt] ──► build/enrichment.json ───────────┤
                                                       ▼
                                                  JSON response (§8)
```

Ranh giới: `build_kb / embed / ner / summarize / enrich` = **Python offline** (output = file JSON). `kb / retrieve / rerank / llm / assistant / vision / compare / main` = **Go online** (đọc file, không chạy model).

---

### 5.1 `build_kb.py` (Python, OFFLINE)
- **Input:** 5 CSV trong `preprocess/data/`.
- **Xử lý:** join POI ⋈ Menu ⋈ Reviews theo `restaurant_id`; normalize text VN → taxonomy tag; parse `opening_hours` → phút; tokenize tên+món cho lexical; tính `quality_completeness` (điền được bao nhiêu field chuẩn / tổng field kỳ vọng).
- **Output:** `engine/build/kb.json` — list 30 POI, mỗi POI:
  ```json
  {
    "id": "poi:res001", "restaurant_id": "RES001",
    "name": "Phở Bếp Nhà", "category": "Nhà hàng", "cuisine_type": "Việt Nam",
    "city": "Hà Nội", "district": "Hoàn Kiếm", "address": "2 Trần Phú, Hoàn Kiếm, Hà Nội",
    "lat": 21.040388, "lon": 105.844615,
    "price_level": "budget", "avg_price_vnd": 68289,
    "rating": 3.8, "review_count": 608, "popularity": 55,
    "opening": {"open_min": 540, "close_min": 1380, "overnight": false, "raw": "09:00-23:00"},
    "segments": ["family","fastfood","travel","budget"],
    "amenities": ["nice_view","reservation","wifi","music","parking","kid_friendly"],
    "diet": [], "dishes": [{"name":"Phở bò tái","price_vnd":68289,"tags":[]}],
    "strengths": ["thực đơn đa dạng","phù hợp gia đình"],
    "weaknesses": ["ồn vào buổi tối"],
    "quality": 0.88, "quality_completeness": 0.92,
    "ai_summary": "...", "sentiment": {"pos":0.7,"neu":0.2,"neg":0.1,"aspects":["service","taste"]},
    "cuisine_classification": "Việt Nam - Miền Bắc",
    "dining_occasions": ["Family","Casual"],
    "tokens": ["pho","bep","nha","bo","tai"],
    "known_entities": {"names":["pho bep nha"],"dishes":["pho bo tai"]},
    "reviews": [{"text":"...","sentiment":"pos","aspects":["service","taste"]}]
  }
  ```
- **Bảng normalize** (hằng số trong code):
  - amenity: `Bãi đỗ xe→parking`, `Phù hợp trẻ em→kid_friendly`, `Có ghế trẻ em→baby_chair`, `Máy lạnh→air_con`, `Wi-Fi miễn phí→wifi`, `View đẹp→nice_view`, `Mở cửa khuya→late_night`, `Đặt bàn trước→reservation`, `Giao hàng→delivery`, `Phòng riêng→private_room`, `Không gian ngoài trời→outdoor`, `Thanh toán thẻ→card`, `Nhạc nhẹ→music`.
  - segment: `Gia đình→family`, `Hẹn hò→romantic`, `Ăn nhanh→fastfood`, `Du lịch→travel`, `Tiết kiệm→budget`, `Cao cấp→premium`.
  - price: `Bình dân→budget`, `Trung bình→mid`, `Cao cấp`/`Sang trọng→premium`.
  - diet: suy ra `vegetarian` nếu `cuisine_type="Chay"` hoặc `category="Nhà hàng chay"` hoặc có món `dietary_tags` chứa chay.

### 5.2 `kb.go` (Go, ONLINE — nền)
- **Output:** package cung cấp cho các module khác.
  - `Load() ([]POI, error)` — đọc kb.json 1 lần lúc start vào slice struct.
  - `norm(s string) string` — bỏ dấu + lowercase (`"Phở Bò"→"pho bo"`).
  - `isOpenAt(o Opening, minute int) bool` — true/false, xử lý qua đêm (10:00-02:00 → mở lúc 00:30).
  - `haversine(lat1,lon1,lat2,lon2 float64) float64` — trả mét.

### 5.3 `retrieve.go` (Go, ONLINE)
- `parseQuery(q string) FilterSpec` —
  - **Input:** `"quán chay ở Hà Nội dưới 100k"`
  - **Output:** `{"city":"Hà Nội","diet":["vegetarian"],"max_price":100000,"segments":[],"dish":[],"tokens":["quan","chay"]}`
- `recall(kb, f) []Candidate` — token match tên+món+review → danh sách thô.
- **HARD gate** → lọc: dish đích danh không có / sai city / thiếu diet / giá>max / rating<min / không mở → **loại**.
  - **Output khi có kết quả:** `[]Candidate` đã qua gate (input cho rerank).
  - **Output khi rỗng:** `{"status":"not_found","reason":"Không có quán Halal ở TP.HCM","suggestions":["Bỏ lọc Halal","Mở rộng sang Hà Nội/Đà Lạt"]}` (bẫy Halal-HCM).

### 5.4 NER chống hallucination (`ner_hutieubert.py`) + `rerank.go`
- **`ner_hutieubert.py` (Python, offline):**
  - **Input:** tên 30 quán + 179 món.
  - **Output:** ghi `known_entities` vào kb.json (đã thấy ở 5.1). Query-time Go chỉ **tra bảng**, không chạy model.
  - Query nhắc tên KHÔNG có trong bảng → `{"status":"not_found","query_entity":"Crystal BBQ","message":"Không tìm thấy 'Crystal BBQ' trong dữ liệu"}` (bẫy Crystal BBQ). Fallback: rule-based nếu bỏ HuTieuBERT.
- **`rerank.go` — SOFT score (§7):**
  - **Input:** `[]Candidate` qua gate + `user_ctx{lat,lon,segment,diet,price,time}`.
  - **Output:** top-K sắp xếp, mỗi item có `why{}` (điểm từng factor) + `reasoning` tiếng Việt (xem response §8).

### 5.5 Dish recognition + OCR ảnh — `vision.go` (Go, ONLINE, mới)
```
POST /v1/dishes/recognize  (multipart ảnh)
  → vision LLM (qwen-vl-plus / Gemini Flash Vision): {dish_name, cuisine, confidence, alternatives[]}
  → match dish index trong kb.json (fuzzy, bỏ dấu)
  → kết hợp lat/lon user → quán gần đó có món này
  → {recognized: {...}, matches: [{restaurant_id, dish, price_vnd, distanceMeters}]}

// OCR ảnh menu do UGC dùng lại: endpoint POST /v1/contribute/menu (§5.10),
// gọi chung hàm OCR trong vision.go → cùng schema build_kb menu items.
```
- Ảnh demo chọn trước (5–10 món VN phổ biến trùng 179 món trong menu dataset: phở, bún chả, cơm tấm...), **kết quả vision cache sẵn ra đĩa** → demo không phụ thuộc mạng.
- Không train classifier (không có dataset ảnh sẵn + không kịp) — zero-shot vision LLM, ghi rõ trong methodology.
- Đường chắc ăn cho "Menu OCR" đề yêu cầu vẫn là `raw_ocr_text` từ OCR Menu CSV → parse trong `build_kb.py` (§5.1) — không phụ thuộc vision, luôn demo được.

### 5.6 AI Summary + Sentiment (`summarize.py`, Python, offline batch)
- **Input:** 30 POI + review CSV (5 review/quán) + `known_strengths/weaknesses` có sẵn.
- **Xử lý:** LLM sinh 1 lần cho mỗi quán: `ai_summary` (2–3 câu VN), `sentiment{pos/neu/neg ratio, aspects}`, `cuisine_classification`, `dining_occasions` (đúng list đề: Family/Business/Romantic/Casual/FastFood).
- **Output:** ghi thẳng vào `kb.json` (§5.1) — Go chỉ serve tĩnh, không gọi LLM lúc query cho phần này.

### 5.7 `llm.go` + `assistant.go` (Go, ONLINE, optional — cắt được)
- **`llm.go`:** HTTP client → **Qwen/DashScope** (OpenAI-compatible), `base_url=https://dashscope-intl.aliyuncs.com/compatible-mode/v1`, model `qwen-plus` (xác nhận tên theo docs). Dự phòng Gemini.
  - Key qua env `DASHSCOPE_API_KEY`, **không hardcode/commit**; `.env` vào `.gitignore`; key hết hạn 14/7.
  - `hash(model+prompt)→cache đĩa`; mất mạng/hết quota → đọc cache.
- **`assistant.go`:** RAG.
  - **Input:** `q="Bún Chả Phố Cổ có món gì đáng thử?"`
  - **Output:** `{"answer":"Bún Chả Phố Cổ nổi bật món Bún chả (99.797đ)...","sources":[{"field":"menu","source":"tasco_csv"}],"poi_id":"poi:res002"}`
  - Bẫy Crystal BBQ: không có trong KB → `{"answer":"not_found","message":"..."}`, cấm bịa.

### 5.8 `compare.go` (Go, ONLINE, mới)
- **Input:** `GET /v1/compare?ids=RES001,RES002`
- **Output:** bảng so sánh side-by-side: price/rating/quality/segments/diet/distance (nếu có user lat/lon)/top dishes — dùng cho màn Comparison đề yêu cầu.

### 5.9 `main.go` (Go, ONLINE)
- **Output:** HTTP server :8000, CORS `*`. Route theo §8. `go build` → 1 binary tĩnh chạy độc lập.

### 5.10 `contribute.go` (Go, ONLINE, mới) — UGC: đóng góp quán + menu OCR

Đây là **write-path stateful duy nhất** của hệ thống. Store = 1 file phẳng `build/contributions.json` (mutex + append, persist qua restart, KHÔNG cần DB). **Tuyệt đối không merge vào `kb.json` benchmark.**

```
POST /v1/contribute          (JSON)
  body: {name, lat, lon, city?, category?, cuisine_type?, price_level?, note?}
  → validate (name + lat/lon bắt buộc; lat/lon trong VN)
  → tạo id "ugc:<uuid>", gắn source="user_contributed", verified=false, created_at
  → append build/contributions.json
  → 201 {id, poi}

POST /v1/contribute/menu     (multipart: poi_id + image)
  → vision.go OCR ảnh menu → [{dish_name, price_vnd}]  (Qwen-VL/Gemini)
  → gắn vào POI trong contributions.json (source="user_ocr", confidence theo OCR)
  → 200 {poi_id, dishes:[...], needs_confirm:true}   (UI cho user sửa trước khi lưu)
```

- **Merge lúc recommend:** `kb.Load()` đọc cả `kb.json` (benchmark) + `contributions.json` (UGC), gắn cờ. UGC **có** xuất hiện trong `/v1/recommend` (đó là giá trị: khám phá quán local mới) nhưng luôn kèm `"source":"user_contributed","verified":false` → UI badge.
- **Guard trung thực:** chế độ **eval (§11) chỉ đọc benchmark**, bỏ UGC → điểm 15 câu không bị ảnh hưởng. Cùng nguyên tắc tách tier như enrichment/scraping.
- **Vision runtime:** OCR gọi API lúc user bấm (không phải hot path recommend), không cache vì là ảnh mới của user — chấp nhận 1–3s.
- **Demo hero:** thêm 1 quán thật gần hội trường → chụp menu → OCR → quán xuất hiện trong "gợi ý gần đây" kèm menu. Live, sạch, không đụng benchmark.

---

## 6. Ánh xạ field thật → tín hiệu (đã verify trong CSV)

| Tín hiệu | Field CSV thật | Ghi chú |
|---|---|---|
| **Personalize: segment** | `recommended_segments` = "Gia đình, Ăn nhanh, Du lịch, Tiết kiệm" | text VN → tag |
| **Personalize: diet** | `cuisine_type`="Chay" / `category`="Nhà hàng chay" / Menu `dietary_tags` / amenities | không có cột diet riêng ở POI → suy từ nhiều nguồn |
| **Personalize: price** | `price_level` = Bình dân/Trung bình/Cao cấp + `avg_price_vnd` | |
| **Personalize: time** | `opening_hours` = "09:00-23:00", "10:00-02:00" (qua đêm) | |
| **Localize: geo** | `latitude`, `longitude` | haversine → geo_decay |
| **Localize: city** | `city` (7 tỉnh) | city_match |
| **Localize: đặc sản vùng (L3)** | `city` × ontology vùng→món + `dishes[].name`/`cuisine_type` | `local_specialty` boost khi quán phục vụ đặc sản của tỉnh user (§1.5) |
| **Localize: giờ ăn Việt (L4)** | `time` × prior giờ→món + `opening_hours` | gợi ý theo nếp ăn (sáng phở, tối nhậu, khuya cháo) |
| **Localize: ngôn ngữ (L1/L2)** | query text | bỏ dấu 2 chiều + teencode/lóng → chuẩn hoá trước parse |
| **Anti-luxury** | `price_level`="Cao cấp" → penalty; "Bình dân"+quality cao → boost | yêu cầu riêng TASCO |
| **Trust** | `poi_quality_score` (0.86–0.99), `rating`, `popularity_score` | có sẵn |

---

## 6.5 Enrichment & Social Scraping (offline) — HẠ XUỐNG *nice-to-have/future*

> **Quyết định 11/7 (12h còn lại):** câu chuyện "enrichment / map tự làm giàu" giờ do **UGC contribution + menu OCR (§5.10)** gánh — sạch hơn, demo live được, không đụng benchmark bịa, không rủi ro ToS. Scraping vẫn giữ trong plan làm **future/nice-to-have** (nếu dư giờ hoặc cho slide roadmap), KHÔNG phải should-have nữa. Đọc mục này khi đã xong UGC.

Ta có tool scrape (Apify/TinyFish/ZenRows...). Đây là **deliverable "enrichment" đề bài yêu cầu** + câu chuyện "map tech scale được". Nhưng phải đặt đúng chỗ, nếu không sẽ tự bắn vào chân.

### ⚠️ Cạm bẫy phải biết trước
**30 POI benchmark là dữ liệu BỊA** (tên generated, dùng để chấm 15 câu + gài bẫy chống hallucination). → Scrape social theo tên 30 quán này sẽ **tìm không ra** hoặc **match nhầm quán thật khác** = đúng lỗi hallucination đề bài trừ điểm.

**Hệ quả thiết kế:**
- Scraping **KHÔNG nhắm** 30 quán benchmark. Benchmark answers luôn **chỉ từ CSV**.
- Scraping nhắm **POI thật** (OSM Overpass / tên quán thật ở VN) → chứng minh engine **làm giàu được data thật**, tách hẳn khỏi benchmark.

### 4 nguyên tắc bắt buộc
1. **Offline + cache-first.** Scrape trước, lưu `engine/build/enrichment.json`. Query online **không** gọi scrape. Demo replay từ cache → sống khi mất mạng.
2. **Tách tier.** Data scrape có namespace riêng, **không đè** field CSV benchmark. Mỗi field enrich mang `{value, source, confidence<1.0, fetched_at}`.
3. **Provenance hiển thị.** UI badge rõ "nguồn: Foody / TikTok / web", confidence — thứ Google Maps không show.
4. **Consensus trước khi tin.** 1 nguồn social đơn lẻ không thắng; cần ≥2 nguồn đồng thuận cho fact (giờ mở, giá). Social buzz chỉ là signal mềm, không phải fact.

### `preprocess/enrich.py` (Python, làn offline, chạy tách khỏi core)
```
input: [POI thật: name + address + city]
  → Apify actors: Google Places (title, rating, reviews, openingHours,
                  popularTimes, price, parking...) · FB Page · TikTok
  → ZenRows lấy HTML trang có anti-bot · TinyFish/AgentQL query trang schema-động
    (Foody/Riviu) · Tavily/search tìm URL website/menu
  → LLM (Qwen/Gemini) structure → JSON
  → resolver: gộp nguồn + confidence + consensus
  → build/enrichment.json  (KHÔNG merge vào kb.json benchmark)
```
**Output `enrichment.json`** (namespace riêng, key = POI thật, mỗi field có provenance):
```json
{
  "real:pho-thin-lo-duc": {
    "name": "Phở Thìn Lò Đúc",
    "fields": {
      "opening_hours": {"value":"06:00-21:00","source":"google_places","confidence":0.9,"fetched_at":"2026-07-11T09:00+07"},
      "parking":       {"value":false,"source":"foody","confidence":0.6,"fetched_at":"..."},
      "buzz_score":    {"value":0.82,"source":"tiktok","confidence":0.5,"mentions":37,"fetched_at":"..."}
    },
    "quality_before": 0.61, "quality_after": 0.90, "gaps_closed": ["opening_hours","menu"]
  }
}
```
Ưu tiên tool: **Apify** cho nguồn có actor sẵn (Google/FB/TikTok — nhanh, ổn định); **TinyFish/AgentQL** cho trang schema-động không actor; **ZenRows** khi bị chặn bot.

### 2 cách dùng
- **(a) Gap-fill:** POI thật thiếu menu/giờ/amenity → scrape lấp → `quality_score` tăng. **Demo hero:** bấm nút → quán 0.6 → 0.9 (chạy từ cache).
- **(b) Social buzz signal:** mention TikTok/Threads → `buzz_score` (decay theo tuần) → 1 factor mềm nhỏ khi rerank. Chỉ *reinforce*, không tạo fact. → **Optional / Future**.

### Rủi ro
| Rủi ro | Đối sách |
|---|---|
| Scrape benchmark POI → match nhầm | KHÔNG scrape benchmark; chỉ POI thật |
| ToS / rate-limit / block | pre-scrape offline, cache; không scrape lúc demo |
| Schema trang đổi | dùng agentic (TinyFish) cho trang động; Gemini structure chịu được nhiễu |
| Latency / mất mạng lúc demo | cache-first tuyệt đối; demo không phụ thuộc network |
| Tốn credit | giới hạn số POI enrich (vài chục để demo), không quét cả VN |

> **Vị trí trong build:** làn offline **song song**, thuộc nhóm should-have. Cắt được hoàn toàn mà core vẫn chạy. Xem §10 và Future Work (§12).

---

## 7. Công thức xếp hạng — HARD gate → SOFT score

### 7.1 HARD gate (loại, không cho điểm)
```
fail nếu: dish yêu cầu mà không có · sai city · thiếu diet bắt buộc
          · giá > max · rating < min · không mở lúc yêu cầu
→ fail = loại khỏi danh sách
→ danh sách rỗng = trả not_found + đề xuất nới lỏng CÓ NHÃN (không tự nới)
```

### 7.2 SOFT score (chỉ trên quán qua gate)
```
score = 0.28·semantic        # khớp query↔(tên+món+review), token/embedding
      + 0.18·geo_decay        # exp(-d/2km); THIẾU lat/lon → bỏ factor, renormalize
      + 0.14·quality          # poi_quality_score
      + 0.14·persona          # khớp segment+diet+price (0..1)
      + 0.12·local_specialty  # L3: quán phục vụ đặc sản của tỉnh user đang đứng (0/1)
      + 0.08·rating_pop       # (rating/5 + popularity/100)/2
      + 0.06·localness        # bình dân + quality≥0.9 → +; family-run → +
      − 0.25·luxury_penalty   # price_level=cao cấp → trừ
```

**`local_specialty` (mới — trụ localize L3, §1.5):** = 1.0 nếu quán phục vụ món đặc sản của **thành phố user đang đứng** (theo ontology vùng→món), ngược lại 0. Chỉ khả dụng khi biết `city`/vị trí user → **renormalize** như các factor khác. Đây là tín hiệu tạo khoảnh khắc demo "cùng câu, khác tỉnh, khác kết quả". DEV1 thêm vào `rerank.go` (factor + trọng số + đưa vào `why{}` và `reasoning`: "đặc sản Huế").

**Luật renormalize (mượn từ SYSTEM_FLOW — quan trọng):** factor nào **thiếu data** (vd user không gửi vị trí → không có geo_decay/local_specialty) thì **bỏ hẳn và chia lại trọng số các factor còn lại** (`wᵢ' = wᵢ/Σw_có_data`), **không** điền 0 giả (điền 0 sẽ dìm oan quán).

**Tune tay** trên 15 câu eval + 8 câu B/C (§11), không train. Cite: LM-Prior (Ju et al., [arXiv:2411.09065](https://arxiv.org/abs/2411.09065)) — semantic làm prior, các factor là adjustment.

### 7.3 LLM rerank (optional, cắt đầu tiên)
Top-10 → Qwen structured JSON → thứ tự cuối + `reasoning` tiếng Việt. Cite KALM4Rec. Bỏ được: SOFT order vẫn tốt.

---

## 8. API contract — align với Tasco Maps API doc

```
GET /v1/recommend
  q       optional  câu tự nhiên (giữ dấu). Rỗng = "gợi ý quanh đây"
  lat,lon optional  vị trí user
  segment optional  family|romantic|business|group|fastfood
  diet    optional  vegetarian|halal
  price   optional  budget|mid|premium
  time    optional  HH:MM (default server now, Asia/Ho_Chi_Minh)
  limit   optional  default 12

GET /v1/poi?id=RES001            chi tiết 1 quán (đủ aiSummary, sentiment, dining_occasions)
GET /v1/compare?ids=RES001,RES002  so sánh nhiều quán
GET /v1/assistant?q=...          Q&A RAG (optional)
POST /v1/dishes/recognize        multipart ảnh → dish + quán gần
POST /v1/contribute              JSON → thêm quán tại vị trí (UGC, §5.10)
POST /v1/contribute/menu         multipart ảnh menu → OCR → gắn vào quán (§5.10)
GET /health                      status + số POI (benchmark + ugc)
```

Response `/v1/recommend`:
```json
{
  "results": [{
    "id":"poi:res002","name":"Bún Chả Phố Cổ","cuisine_type":"Việt Nam",
    "city":"TP. Hồ Chí Minh","address":"...","coordinates":{"lat":10.76,"lon":106.71},
    "distanceMeters":1240,"score":0.78,
    "tags":["family","parking"],
    "meta":{
      "why":{"semantic":0.8,"geo_decay":0.6,"quality":0.97,"persona":0.75,
             "localness":0.15,"luxury_penalty":0.0,"final":0.78},
      "reasoning":"Cách bạn 1.2km · phù hợp gia đình · giá bình dân · còn mở tới 02:00",
      "quality":0.97,"matched_dishes":[{"dish":"Bún chả","price_vnd":99797}]
    }
  }],
  "meta":{"query":"...","filters":{...},"count":1},
  "requestId":"..."
}
```

**Checklist compatibility với API doc Tasco Maps** (BTC chấm "integration-ready"):
- [ ] `PlaceResult`-tương thích: `id, type, name, label, address, category, coordinates{lat,lon}, distanceMeters, score, source` cho các field overlap (dùng khi trả `/v1/search` alias nếu cần).
- [ ] `ErrorResponse`: `{error:{code,message,details}, requestId}` + đúng bảng mã lỗi (400 `invalid_request`, 404 `not_found`, 429 `rate_limited`...).
- [ ] Stable IDs; WGS84 lat/lon; **giữ tiếng Việt có dấu**.
- [ ] Auth pluggable: `Authorization: Bearer` hoặc `X-API-Key` (dù mock chấp nhận không auth); base URL configurable qua flag/env; không hardcode key.
- [ ] Headers khuyến nghị: `X-Request-Id`, `X-Locale: vi-VN`, `X-Timezone: Asia/Ho_Chi_Minh`.
- [ ] Deterministic mock data cho test/demo (kb.json chính là mock deterministic).
- [ ] Submission kèm: OpenAPI/contract note, REST examples, ghi chú ranking/enrichment/latency/fallback/provenance (BIZ gom vào README).

---

## 9. Frontend — nối `ui/` (T Maps prototype có sẵn) vào Go engine

`ui/` đã có phone-frame + map (Leaflet) + bottom sheet + search + route + nav HUD, nhưng **100% mock trong `App.tsx`**. Việc là thay dần mock bằng gọi engine Go, không build lại từ đầu.

1. **`api.ts`** — client mới: `recommend(params): Promise<RecommendResponse>` GET `http://localhost:8000/v1/recommend`, `getPoi(id)`, `compare(ids)`, `assistant(q)`, `recognizeDish(file)`. Base URL qua env, mặc định `http://localhost:8000`.
2. **Thay mock search/place-details** trong `App.tsx` bằng data thật từ engine (menu thật, giờ mở thật, giá thật).
3. **`FilterChips.tsx`** (mới) — 4 nhóm chip: Segment (Gia đình/Hẹn hò/Nhóm/Ăn nhanh) · Diet (Chay/Halal) · Price (Bình dân/TB/Cao cấp) · Time (giờ hiện tại/ăn khuya). Bấm → gọi lại `recommend` → marker + list update (personalize NHÌN THẤY ĐƯỢC).
4. **`ResultCard.tsx`** (mở rộng có sẵn hoặc mới) — tên, cuisine, khoảng cách, giá, badge `quality`, chip tags; nút **"Vì sao gợi ý?"** xổ `meta.why` (bar mỗi factor) + `reasoning`. Differentiator số 1.
5. **Màn mới theo 7 cảnh demo:** `CompareView.tsx` (2 quán cạnh nhau), `AssistantBox.tsx` (chat + citations), `DishPhoto.tsx` (upload ảnh → món nhận diện → quán gần), badge provenance/confidence trên field enrich (§6.5), empty-state `not_found` hiển thị `message` + `suggestions` dạng chip bấm được.
6. Giữ nguyên ngôn ngữ thiết kế T Maps đã có (phone-frame, dark/clean); desktop layout map trái + list phải nếu mở rộng ngoài khung phone.

**Chốt sớm giữa UI ↔ DEV1/DEV3:** shape `why{}`, shape assistant citations, shape recognize response — theo §8, không tự bịa field.

---

## 10. Timeline — chỉ còn ~12 giờ, chạy song song theo owner, không chia ngày

Không đủ giờ để chia phase tuần tự — 5 người chạy **song song ngay từ phút đầu** theo §10.5, chỉ đồng bộ ở 2 interface (`kb.json`, API contract §8). Danh sách việc dưới đây xếp theo **must-have (không có không nộp được) → should-have (đề yêu cầu, cắt được nếu cháy giờ) → nice-to-have (cắt đầu tiên)**. Mỗi người tự chạy list của mình, tick xong việc nào báo ngay để người phụ thuộc bắt đầu.

### Setup — làm trước, chặn mọi người (10–15 phút, cả team làm song song luôn phần của mình)
- [ ] Copy 5 CSV từ `data/` → `preprocess/data/`. `go mod init` trong `engine/`. Skeleton `preprocess/*.py`.
- [ ] `.gitignore`: `engine/build/`, `.env`, `node_modules/`, `preprocess/__pycache__/`. **Không commit key.**
- [ ] `.env`: `DASHSCOPE_API_KEY=...`, đọc bằng `os.getenv`/`os.Getenv`, không hardcode.
- [ ] UI: verify `npm run dev` chạy từ prototype có sẵn.
- [ ] DEV1: verify `go run .` chạy skeleton HTTP.
- [ ] DEV3: 1 call Qwen text test sống + 1 call vision test sống.
- [ ] BIZ: đọc kỹ PROBLEM STATEMENT, hỏi BTC về Food Image Dataset ngay (đề nói có, repo chưa thấy), dựng khung deck.
- [ ] **Chốt 2 interface trước khi ai code sâu:** schema `kb.json` (DEV2↔DEV1), API contract §8 (DEV1↔UI/DEV3).

### MUST-HAVE — không có thì không thể nộp
- [ ] **DEV2** — `build_kb.py`: CSV → `kb.json` (normalize taxonomy segment/diet/price/opening_hours).
- [ ] **DEV1** — `kb.go` + `retrieve.go`: load kb.json, parseQuery, recall, HARD gate (kể cả bẫy Crystal BBQ / Halal-HCM).
- [ ] **DEV1** — `rerank.go`: SOFT score + geo_decay + renormalize + anti-luxury + `why{}`.
- [ ] **DEV1** — `main.go`: `/v1/recommend`, `/v1/poi`, `/health`. **DoD:** `curl /v1/recommend?q=quán chay&lat=..&lon=..` trả JSON đúng, có `why`.
- [ ] **UI** — `api.ts` + nối search/recommend thật vào `ui/` có sẵn (thay mock), FilterChips, ResultCard hiện `why` breakdown.
- [ ] **DEV3** — `assistant.go` RAG chống bịa (không có trong KB → not_found, cấm bịa).
- [ ] **DEV3** — `summarize.py` batch AI summary + sentiment + cuisine_classification + dining_occasions cho 30 quán, ghi vào kb.json.
- [ ] **DEV2** — `quality_completeness` score trong `build_kb.py` + badge hiển thị.
- [ ] **BIZ** — demo script đủ đường đi cho các cảnh must-have; chạy thử end-to-end ngay khi UI+DEV1 xong phần recommend.

### SHOULD-HAVE — đề yêu cầu tường minh, ưu tiên cao nhưng cắt được nếu cháy giờ
- [ ] **DEV1 + DEV2** — **LOCALIZE quick-wins (§1.5), differentiator BGK:** L2 slang/teencode map (`retrieve.go`) + L3 ontology đặc sản vùng miền + factor `local_specialty` (`taxonomy` + `rerank.go`, §7.2) + L4 meal-time prior (`retrieve.go`). Kèm test + `reasoning` tiếng Việt ("đặc sản Huế"). **Cảnh demo: cùng câu, khác tỉnh, khác đặc sản.**
- [ ] **DEV1 + DEV3 + UI** — **UGC (§5.10):** `contribute.go` (`POST /v1/contribute` + `/v1/contribute/menu`) + OCR vision + `ContributeForm.tsx` (thả pin) + `MenuUpload.tsx`. **Cảnh demo chủ lực enrichment.**
- [ ] **DEV3** — `vision.go` dish recognition (`POST /v1/dishes/recognize`) + cache sẵn kết quả cho 5–10 ảnh demo.
- [ ] **DEV1** — `compare.go` (`GET /v1/compare?ids=...`) + **UI** `CompareView.tsx`.
- [ ] **UI** — `AssistantBox.tsx` (chat + citations), `DishPhoto.tsx` (upload ảnh).
- [ ] **UI** — badge provenance/verified trên card (UGC "chưa xác minh"); empty-state `not_found` hiện `message` + `suggestions` dạng chip.
- [ ] **DEV3/DEV1** — chạy eval A/B/C (§11), tune weights SOFT score dựa trên kết quả.

### NICE-TO-HAVE — cắt đầu tiên khi thiếu giờ
- [ ] LLM rerank top-10 (§7.3).
- [ ] **Social scraping enrichment** (`enrich.py`, §6.5): scrape 10–20 POI thật → `enrichment.json`, cảnh 0.6→0.9. *Đã hạ từ should-have — UGC §5.10 gánh câu chuyện enrichment.*
- [ ] Social buzz signal (§6.5b).
- [ ] Embedding semantic search qua Qwen API (giữ lexical token-match làm core).
- [ ] Tauri desktop packaging (`ui/src-tauri/` đã có sẵn, build nếu còn giờ).
- [ ] Style polish nâng cao: animation marker, transition đẹp.

### 30 phút cuối — chốt nộp (cả team)
- [ ] Freeze code. Eval lần cuối, số liệu chốt cho BIZ.
- [ ] README (methodology §13 + setup) — mỗi dev viết 3–5 gạch đầu dòng phần mình, BIZ biên tập.
- [ ] Video demo + deck final. Kiểm tra lại: không commit API key.

**Đường cắt nếu cháy giờ (theo thứ tự):** LLM rerank (§7.3) → scraping enrichment (§6.5) → social buzz → embedding → Tauri packaging. **KHÔNG cắt:** demo tối thiểu, `why{}`, chống bịa (Crystal BBQ / Halal-HCM), seed data đúng, quality scoring, dish recognition + **UGC đóng góp quán + menu OCR (§5.10)** (đề yêu cầu tường minh + là cảnh demo chủ lực).

---

## 10.5 Phân công 5 người — 1 UI · 3 dev · 1 business (theo sở hữu file → zero conflict)

Nguyên tắc: **mỗi người sở hữu 1 nhóm file, không ai sửa file người khác.** Chỉ có 2 interface phải chốt chung sớm: **(i) schema `kb.json`** (DEV2↔DEV1), **(ii) API contract §8** (DEV1↔UI/DEV3). Chốt xong 2 cái đó, cả team chạy độc lập.

| Ai | Vai trò | Sở hữu (file/thư mục) | Giao cho ai |
|---|---|---|---|
| **UI** (1 người) | Frontend & Demo surface | toàn bộ `ui/` (`api.ts`, `FilterChips`, `ResultCard` why-breakdown, `CompareView`, `AssistantBox`, `DishPhoto`, provenance badge) | dùng `/v1/*` của DEV1/DEV3; giữ ngôn ngữ thiết kế T Maps có sẵn |
| **DEV1** | Backend core — Retrieval, Ranking, Serving, UGC | `retrieve.go`, `rerank.go`, `kb.go`, `compare.go`, `contribute.go` (§5.10 add POI + store), `main.go` — parse query, HARD gate, SOFT score, geo, `why{}`, routing/CORS | dùng kb.json của DEV2; cấp `/v1/recommend`, `/v1/compare`, `/v1/contribute` cho UI |
| **DEV2** | Data, Preprocessing & Quality | `build_kb.py`, `embed.py`, taxonomy normalize, schema `kb.json` + schema `contributions.json` (chốt với DEV1), quality_completeness. *Scraping `enrich.py` = nice-to-have, làm nếu dư giờ* | kb.json → DEV1; schema store → DEV1 |
| **DEV3** | AI: LLM, Vision, Assistant, Ngôn ngữ VN | `llm.go`, `assistant.go`, `vision.go` (dish recognition + **menu OCR cho §5.10**), `summarize.py`, `ner_hutieubert.py`, eval A/B/C | ghép vào `/v1/*` của DEV1; OCR cho contribute → DEV1/UI; số eval → BIZ |
| **BIZ** (1 người) | Business, Pitch, Demo production | deck (problem/solution/architecture/business value/impact), demo script 7 cảnh, video, `README.md` submission, roadmap slide (§12), bibliography (§14) | chạy demo thử mỗi tối, phát hiện cảnh gãy sớm nhất; hỏi BTC Food Image Dataset |

**Vì sao chia thế này:**
- DEV1 giữ lõi (điểm số + gate + serving) — thứ quyết định chất lượng và là điểm chạm của mọi module khác, gom về 1 người để tránh conflict trên `main.go`.
- DEV2 tách hẳn vì offline preprocessing là interface (kb.json) — làm xong là DEV1/UI chạy được ngay. Enrichment giờ do UGC (§5.10) gánh, nên DEV2 nhẹ tải hơn, có thể hỗ trợ DEV1 phần store `contributions.json` hoặc nhận scraping nếu dư giờ.
- DEV3 gom mọi thứ "AI" (LLM + vision + NER + prompt + eval) vì cùng họ kỹ năng và đều cần cache-first; sở hữu eval vì họ lo chất lượng câu trả lời.
- UI là người ráp cuối trên nền T Maps prototype có sẵn — không cần build từ đầu, chỉ thay mock bằng thật + thêm 3 màn mới.
- BIZ là role mới so với bản plan cũ — tách hẳn khỏi code, lo deck/pitch/demo, đồng thời làm QA "trông cool" hằng đêm.

**Nếu team yếu Go:** DEV1 cần biết Go chắc nhất; DEV2/DEV3 thuần Python + prompt, không cần Go. Nếu cả DEV2/DEV3 không biết Go → DEV1 gánh cả `main.go`/`compare.go`, DEV3 chỉ viết Python + gọi API HTTP từ ngoài, tích hợp vào Go sau qua interface JSON đơn giản.

**Nếu thiếu người (4 người):** gộp DEV2 vào DEV3 (data lo cả preprocess + enrich + AI), giữ DEV1 + UI + BIZ; cắt scraping trước.

---

## 11. Eval plan

`engine/eval.go` hoặc `preprocess/eval.py` chạy 3 nhóm, in bảng pass/fail. Owner: **DEV3** (chạy), **DEV1** (tune dựa trên kết quả).

- **Nhóm A — 15 câu Public Evaluation** (không personalize): sanity, không được sai bẫy (Crystal BBQ→not_found, Halal-HCM→trung thực).
- **Nhóm B — personalize (5 câu):** segment=Romantic→loại fast food; diet=vegetarian→100% có món chay; time=00:30→chỉ quán qua đêm; segment=Family→ưu tiên có parking+kid; price=budget→loại cao cấp.
- **Nhóm C — localize (3 câu):** lat/lon HN→top-3 ở HN, không lẫn HCM; đổi vị trí→kết quả đổi; query "bún chả HCM" khi user ở HN→override, trả HCM.

**DoD:** A không sai bẫy + B/C ≥ 7/8 pass. Số pass/fail đưa vào deck (slide "evaluation").

---

## 12. Future Work (đánh dấu rõ — không build hackathon)

Ghi vào deck slide "Roadmap" để thể hiện tầm nhìn mà không phải làm:

- **Embedding semantic search** (thay token-match) — Qwen `text-embedding-v3` (API) hoặc `AITeamVN/Vietnamese_Embedding` (BGE-M3, local A40, SOTA VN). Benchmark tham chiếu: VN-MTEB ([arXiv:2507.21500](https://arxiv.org/abs/2507.21500)). *Đã chừa chỗ trong rerank.*
- **UGC verification & moderation** — quán user đóng góp (§5.10) hiện `verified=false`; production cần luồng duyệt/kiểm chứng (consensus nhiều user, bot gọi điện xác minh kiểu Baidu DuIVRS) trước khi lên `verified=true`.
- **HuTieuBERT fine-tune SBERT-style** — hiện HuTieuBERT chỉ dùng cho NER/POS (thế mạnh). Muốn dùng làm embedding retrieval thì phải fine-tune contrastive (SBERT), ngoài phạm vi hackathon.
- **Localize L6 — chay kỳ âm lịch (§1.5):** mùng 1 & rằm ÂL → tự động boost quán chay. Cần lunar-calendar util; deeply Vietnamese, để lại roadmap.
- **Review sentiment/aspect tiếng Việt** — ViSoBERT / ViGSA cho slang + aspect-based sentiment review VN (nuôi `S_buzz` + tóm tắt điểm mạnh/yếu). Hackathon dùng Qwen; production chuyển model VN chuyên biệt.
- **Route-aware / along-route recommend** — cần Valhalla; gợi ý quán dọc hành trình liên tỉnh (differentiator VETC, khớp Route API trong doc Tasco). Cite SYSTEM_FLOW draft.
- **Behavior ranking** (Tire-Wear/Repeat kiểu Amap) — cần dữ liệu di chuyển thật từ VETC.
- **Enrichment pipeline mở rộng** (§6.5) — scrape social/web quy mô lớn cho POI thật toàn VN (TinyFish/ZenRows), OCR menu ảnh hàng loạt. Hackathon chỉ demo vài chục POI từ cache.
- **Social buzz reranking** — TikTok/Threads mention → `buzz_score` factor mềm. Cần pipeline phương ngữ VN (slang → aspect → sentiment).
- **Dish recognition fine-tune** — thay zero-shot vision LLM bằng classifier train trên dataset ảnh món VN thật (khi có).
- **Provenance + confidence từng field** — 5-tier source registry (CSV → licensed API → agentic-facts → social-signals → business/driver-verified).
- **Deep recommenders** (GETNext/LightGCN/SASRec/LightFM) — chỉ có nghĩa khi POI DB lên 10^4–10^6; với 30 POI sẽ overfit. Cite làm "scaling path".
- **Tích hợp SDK Flutter/T Maps thật** — client adapter theo doc Tasco (`PeliasClient`/`RoutingClient` boundary).
- **Tauri desktop packaging** — wrap thành app cài được (đã có `ui/src-tauri/`, chỉ cần build).

---

## 13. Methodology narrative (dán vào README + deck)

> The recommender follows the **retrieve-then-rerank cold-start paradigm** of KALM4Rec (Kieu et al., 2024), built for restaurant recommendation with no user history. Stage 1 does rule-based candidate recall then a **hard-constraint gate** (dietary, city, price, opening hours) that rejects rather than silently relaxes — this is where we handle honesty traps (a queried restaurant absent from the knowledge base returns not_found, never a fabrication). Stage 2 ranks survivors with a linear **soft score** combining lexical relevance, geographic decay (`exp(-d/2km)`), POI quality, persona match (segment/diet/price), and an anti-luxury term that favors small local eateries per the TASCO brief. Missing signals are dropped and weights renormalized rather than zero-filled. An optional LLM stage re-ranks the top candidates and generates a Vietnamese explanation. Dish recognition and image-based menu OCR use zero-shot vision-LLM inference, cached to disk so the live demo never depends on network availability. Restaurant summaries, sentiment, cuisine classification, and dining-occasion tags are generated once per POI in an offline batch pass, not at query time.
>
> **Localization is a first-class design axis, not an afterthought.** The engine matches Vietnamese with and without diacritics, normalizes teencode/slang before parsing, and encodes a province→specialty-dish ontology that boosts regional specialties for the user's current city (so the same query surfaces different local dishes in Huế vs. Đà Lạt). A Vietnamese meal-time intent prior reflects local eating culture (phở at breakfast, nhậu in the evening, cháo late at night). The NLP stack is Vietnamese-native: HuTieuBERT (morpheme-aware, ACL 2026) for proper-noun NER and tokenization, plus a Vietnamese sentence-embedding model — chosen over generic multilingual pipelines that treat Vietnamese as just one more language.
>
> Geographic weighting follows GeoMF (Lian et al., KDD 2014); using LLM/semantic similarity as a prior over classical ranking follows the Language-Model Prior framework (Ju et al., 2024). We deliberately avoid training deep recommenders (LightGCN, GETNext, SASRec, LightFM) because 30 POIs and 150 reviews cause overfitting; these are cited as the scaling roadmap once the POI base grows.

---

## 14. Citations (deck bibliography)

**Core:**
1. Kieu, D. et al. **KALM4Rec** — Keyword-driven Retrieval-Augmented LLMs for Cold-start User Recommendations. [arXiv:2405.19612](https://arxiv.org/abs/2405.19612), 2024.
2. Lian, D. et al. **GeoMF** — Joint Geographical Modeling and MF for POI Recommendation. [KDD 2014](https://dl.acm.org/doi/10.1145/2623330.2623638).
3. Ju, J. et al. **Language-Model Prior Overcomes Cold-Start Items.** [arXiv:2411.09065](https://arxiv.org/abs/2411.09065), 2024.
4. Reimers, N., Gurevych, I. **Sentence-BERT.** EMNLP 2019. *(vì sao dùng sentence-transformer, không dùng BERT thô, cho embedding)*
5. Cormack, G.V. et al. **Reciprocal Rank Fusion.** [SIGIR 2009](https://dl.acm.org/doi/10.1145/1571941.1572114). *(nếu dùng nhiều recall channel)*
6. Dinh, A.T.D., Vo, K.H.N. et al. **HuTieuBERT — Morpheme-Aware Transformer for Vietnamese.** ACL 2026. *(dùng cho NER tên quán/món chống hallucination + POS tiếng Việt)*

**Related / Future (why not deep models):**
7. Li, P. et al. **LLMs for Next POI Recommendation.** [arXiv:2404.17591](https://arxiv.org/abs/2404.17591), SIGIR 2024.
8. He, X. et al. **LightGCN.** [arXiv:2002.02126](https://arxiv.org/abs/2002.02126), SIGIR 2020.
9. Yang, S. et al. **GETNext.** [SIGIR 2022](https://dl.acm.org/doi/10.1145/3477495.3531983).
10. Kang & McAuley. **SASRec.** ICDM 2018.
11. Kula, M. **LightFM.** RecSys 2015.
12. **LLMTreeRec** — LLMs for Cold-Start. [arXiv:2404.00702](https://arxiv.org/abs/2404.00702), 2024.
13. **A Survey on POI Recommendation.** [arXiv:2410.02191](https://arxiv.org/abs/2410.02191), 2024.

**Problem motivation (paper TASCO đưa):**
14. Li, Y. et al. **Personalized Query Auto-Completion at Baidu Maps.** [ACM 2020](https://dl.acm.org/doi/10.1145/3394137).

---

## 15. Submission checklist (từ PROBLEM STATEMENT — mỗi mục có owner)

- [ ] Presentation deck: problem, solution, architecture, business value, impact — **BIZ**
- [ ] Live demo + recorded video — **BIZ** (script) + cả team (chạy)
- [ ] Source repo + README setup/technical overview/AI approach — **BIZ** biên tập, mỗi dev viết phần mình
- [ ] Data enrichment workflow — **DEV2**
- [ ] OCR & extraction methodology — **DEV2 + DEV3**
- [ ] Dish recognition approach — **DEV3**
- [ ] Recommendation methodology — **DEV1**
- [ ] POI quality evaluation approach — **DEV2**
- [ ] Demo đủ 7 cảnh: enrichment (**= UGC đóng góp quán live, §5.10**) · menu OCR extraction (**= chụp menu UGC**) · dish recognition · AI summary · comparison · personalized recommendation · assistant Q&A — **cả team, BIZ điểm danh từng cảnh**

---

## 16. Trước khi code — chốt 4 việc (làm trong Setup, §10)

1. **Copy 5 CSV** từ `data/` → `Toi-la-AI-TascoP11-AABW2026/preprocess/data/`.
2. **Chốt 5 vai trò (§10.5)** + 2 interface: schema `kb.json` (DEV2↔DEV1), API contract §8 (DEV1↔UI/DEV3).
3. **Chốt LLM/vision:** key Qwen (`DASHSCOPE_API_KEY`) đưa vào `.env`, test 1 call sống (text + vision). Key hết hạn 14/7 — build xong trong 12 giờ trước hạn. Không có LLM → bỏ nhóm should-have AI (dish recognition/assistant/summary), core recommend + search vẫn đủ demo.
4. **Hỏi BTC** về Sample Food Image Dataset (đề nói có, repo chưa thấy) — quyết định sớm ảnh hưởng scope dish recognition demo.

Xong 4 việc (≤15 phút) → cả team chạy song song theo §10. Không code trước khi copy data. **Nhắc lại: không commit API key vào git.**

---

*Plan build mới trong repo `Toi-la-AI-TascoP11-AABW2026`, dùng Go engine + Python offline, deploy server thường (§3.4); `ui/` T Maps prototype có sẵn là base frontend. LLM/embedding/vision đi qua Qwen API (không host model — §3), core lexical không cần ML. Enrichment story = UGC đóng góp quán + menu OCR (§5.10), scraping là dự phòng. Refined 11/7, team 1 UI · 3 dev · 1 business.*
