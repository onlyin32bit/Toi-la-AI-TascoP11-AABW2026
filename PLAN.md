# BUILD PLAN — Tasco P11 Local Restaurant Recommender

> **Repo làm việc:** `Toi-la-AI-TascoP11-AABW2026/` (Tauri v2 + React 19 + Vite 7, hiện mới chỉ có scaffold).
> **Draft cũ** (`tasco-map-food-intelligence/`) chỉ dùng làm **tham khảo research + dataset**, KHÔNG build ở đó.
> **Mục tiêu:** một sản phẩm **chạy được + trông cool** — map + search + recommend cá nhân hoá theo vị trí, có giải thích "vì sao gợi ý".
> **Nguyên tắc:** build from scratch, ưu tiên cái chạy chắc. Phần khó → đánh dấu *Future Work*.
> **Trạng thái:** plan, chưa code.

---

## 0. Ta đang có gì / cần gì

**Đã có:**
- Scaffold `ui/`: Tauri v2, React 19, Vite 7, TypeScript. Mới là template mặc định (App.tsx greet demo).
- Dataset (copy từ draft): 5 CSV — POI (30 quán), Menu (179 món), OCR Menu (18 quán), Reviews (150), Public Evaluation (15 câu).
- A40 48GB (optional, để host embedding/LLM nếu cần).
- Gemini free tier (optional, cho assistant + query parsing nâng cao).

**Cần build:**
1. **Backend engine** (Python, zero-dep core) — load data → index → recommend theo query + vị trí + personalize.
2. **Frontend** (React, dùng scaffold sẵn) — map + search bar + filter chips + result card có "why".
3. **Glue** — React gọi HTTP API của backend.

**Chốt stack:**
| Layer | Chọn | Lý do |
|---|---|---|
| Backend online | **Go** — serve HTTP / retrieve / rerank / geo → 1 binary tĩnh, nhanh, offline-safe | ăn điểm production-ready; ranh giới ở §3.3 |
| Preprocess offline | **Python** — CSV→kb.json, embed, NER, enrich (chạy 1 lần) | hệ sinh thái ML ở Python; output là file, Go đọc |
| Data | 5 CSV copy vào `preprocess/data/` | ground truth |
| Semantic (core) | lexical token-match | zero-dep, chạy chắc, không cần ML runtime |
| Semantic (nâng cao) | **Qwen `text-embedding-v3` (API)** hoặc `dangvantuan/vietnamese-embedding` (offline) | Go gọi API được; hoặc precompute offline. *Nếu còn giờ* |
| NER / tách từ VN | **HuTieuBERT** (Python, offline/sidecar) | phát hiện tên quán/món → chống hallucination; KHÔNG dùng làm embedding — xem §5.4 |
| LLM | **Qwen** (DashScope OpenAI-compatible) chính; Gemini Flash dự phòng — **cache-first ra đĩa** | query parse + rerank + assistant; demo sống khi mất mạng |
| Enrichment / scraping | **Apify** (Google Places/FB/TikTok actors) + TinyFish/AgentQL (agentic) + ZenRows (anti-bot HTML) → LLM structure | **offline, cache-first, tier riêng** — xem §6.5 |
| Frontend | React 19 + Vite (có sẵn) + `react-leaflet` | map "cool", localize trực quan |
| Desktop wrap | Tauri | *Future Work* — chạy `vite dev` trong browser là đủ demo |

---

## 1. Sản phẩm — cảnh demo "cool" (đích đến)

> User mở app → thấy **map** với các quán quanh mình → gõ *"quán chay gần đây"* hoặc bấm chip **Gia đình / Chay / Bình dân** → map + list update, quán được **rerank theo vị trí + sở thích** → bấm 1 quán → hiện card có **điểm số tách factor** ("gần bạn 1.2km · phù hợp gia đình · giá bình dân · còn mở") + badge chất lượng → hỏi assistant *"quán này có món gì đáng thử?"* → trả lời có trích nguồn.

3 điểm khiến nó trông cool:
1. **Map interactive** với marker đổi theo query (localize nhìn thấy được).
2. **Filter chips** bấm phát đổi kết quả ngay (personalize nhìn thấy được).
3. **"Vì sao gợi ý"** — breakdown điểm số, thứ Google Maps không show.

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
  → dump build/kb.json  (+ build/vectors.npy nếu có embedding)
```

Nặng nhất = embed corpus (nếu bật). Làm 1 lần, lưu đĩa. **Cache-first: có `kb.json` thì load thẳng, không parse lại.**

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
- Bottleneck duy nhất = LLM call (nếu bật). Giảm bằng: **cache theo query** (câu lặp → 0 latency) + **bỏ được LLM** (SOFT score thuần Python vẫn ra kết quả tốt).
- A40 chỉ giúp nếu **self-host embedding/LLM**; nếu gọi API thì A40 vô dụng cho latency. → Core không phụ thuộc A40.

### 3.3 Phân chia ngôn ngữ — Go (online) + Python (offline ML)

Ranh giới sạch: **cái gì cần ML runtime → Python offline; cái gì chạy mỗi query → Go**.

| | Ngôn ngữ | Chạy khi | Làm gì |
|---|---|---|---|
| **Online serving** | **Go** | mỗi query | serve HTTP · parse_query · recall · HARD gate · SOFT score · geo · gọi Qwen/Apify (HTTP) |
| **Offline preprocess** | **Python** | 1 lần (build) | CSV→kb.json · normalize · embed corpus (Qwen/ST) · NER tag (HuTieuBERT) · scrape enrich |

- Go **không chạy model local** — embedding/NER làm sẵn offline (ghi vào kb.json), hoặc query-time gọi **Qwen embedding API** (Go gọi được vì là HTTP).
- Nếu bỏ hẳn ML (core lexical) → **chỉ cần Go**, không cần Python runtime lúc chạy. Đây là đường an toàn nhất.
- Lợi: 1 binary Go tĩnh, khởi động tức thì, offline-safe, "production-ready".

---

## 4. Cấu trúc repo (build vào đây)

```
Toi-la-AI-TascoP11-AABW2026/
├── engine/                      ← BACKEND online (Go)
│   ├── main.go                  ← HTTP :8000, /v1/recommend ...
│   ├── kb.go                    ← load kb.json, norm(), is_open_at(), haversine()
│   ├── retrieve.go              ← parse_query + recall + HARD gate
│   ├── rerank.go                ← SOFT score (personalize/localize/anti-luxury)
│   ├── llm.go                   ← Qwen client (HTTP), cache-first ra đĩa  [optional]
│   ├── assistant.go             ← RAG trả lời Q&A, trích nguồn            [optional]
│   └── build/                   ← kb.json, enrichment.json, cache (git-ignored)
├── preprocess/                  ← OFFLINE (Python, chạy 1 lần)
│   ├── data/                    ← copy 5 CSV vào đây
│   ├── build_kb.py              ← CSV → build/kb.json (normalize, embed, NER)
│   ├── embed.py                 ← Qwen/ST embedding corpus            [optional]
│   ├── ner_hutieubert.py        ← HuTieuBERT tag tên quán/món         [optional, §5.4]
│   └── enrich.py                ← scrape POI thật → enrichment.json   [§6.5, optional]
├── ui/                          ← FRONTEND (scaffold có sẵn)
│   └── src/
│       ├── App.tsx              ← thay demo greet bằng app thật
│       ├── api.ts               ← fetch /v1/recommend
│       ├── components/
│       │   ├── MapView.tsx      ← react-leaflet, marker POI
│       │   ├── SearchBar.tsx    ← ô search + nút "gần tôi"
│       │   ├── FilterChips.tsx  ← Segment/Diet/Price/Time
│       │   ├── ResultCard.tsx   ← card quán + "vì sao gợi ý"
│       │   └── AssistantBox.tsx ← chat Q&A                  [optional]
│       └── types.ts
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
   ▼                        │                          ▼
 (kb.json + known_entities) │                     rerank.go → top-K + why{}
                            │                          │ llm.go/assistant.go [opt]
 enrich.py [opt] ──► build/enrichment.json ───────────┤
                                                       ▼
                                                  JSON response (§8)
```

Ranh giới: `build_kb / embed / ner / enrich` = **Python offline** (output = file JSON). `kb / retrieve / rerank / llm / assistant / main` = **Go online** (đọc file, không chạy model).

---

### 5.1 `build_kb.py` (Python, OFFLINE)
- **Input:** 5 CSV trong `preprocess/data/`.
- **Xử lý:** join POI ⋈ Menu ⋈ Reviews theo `restaurant_id`; normalize text VN → taxonomy tag; parse `opening_hours` → phút; tokenize tên+món cho lexical.
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
    "quality": 0.88,
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

### 5.5 `llm.go` + `assistant.go` (Go, ONLINE, optional — cắt được)
- **`llm.go`:** HTTP client → **Qwen/DashScope** (OpenAI-compatible), `base_url=https://dashscope-intl.aliyuncs.com/compatible-mode/v1`, model `qwen-plus` (xác nhận tên theo docs). Dự phòng Gemini.
  - Key qua env `DASHSCOPE_API_KEY`, **không hardcode/commit**; `.env` vào `.gitignore`; key hết hạn 14/7.
  - `hash(model+prompt)→cache đĩa`; mất mạng/hết quota → đọc cache.
- **`assistant.go`:** RAG.
  - **Input:** `q="Bún Chả Phố Cổ có món gì đáng thử?"`
  - **Output:** `{"answer":"Bún Chả Phố Cổ nổi bật món Bún chả (99.797đ)...","sources":[{"field":"menu","source":"tasco_csv"}],"poi_id":"poi:res002"}`
  - Bẫy Crystal BBQ: không có trong KB → `{"answer":"not_found","message":"..."}`, cấm bịa.

### 5.6 `main.go` (Go, ONLINE)
- **Output:** HTTP server :8000, CORS `*`. Route theo §8. `go build` → 1 binary tĩnh chạy độc lập.

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
| **Anti-luxury** | `price_level`="Cao cấp" → penalty; "Bình dân"+quality cao → boost | yêu cầu riêng TASCO |
| **Trust** | `poi_quality_score` (0.86–0.99), `rating`, `popularity_score` | có sẵn |

---

## 6.5 Enrichment & Social Scraping (differentiator, offline)

Ta có tool scrape (TinyFish/AgentQL, ZenRows...). Đây là **deliverable "enrichment" đề bài yêu cầu** + câu chuyện "map tech scale được". Nhưng phải đặt đúng chỗ, nếu không sẽ tự bắn vào chân.

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
- **(b) Social buzz signal:** mention TikTok/Threads → `buzz_score` (decay theo tuần) → 1 factor mềm nhỏ khi rerank (giống tier 4b SYSTEM_FLOW). Chỉ *reinforce*, không tạo fact. → **Optional / Future**.

### Rủi ro
| Rủi ro | Đối sách |
|---|---|
| Scrape benchmark POI → match nhầm | KHÔNG scrape benchmark; chỉ POI thật |
| ToS / rate-limit / block | pre-scrape offline, cache; không scrape lúc demo |
| Schema trang đổi | dùng agentic (TinyFish) cho trang động; Gemini structure chịu được nhiễu |
| Latency / mất mạng lúc demo | cache-first tuyệt đối; demo không phụ thuộc network |
| Tốn credit | giới hạn số POI enrich (vài chục để demo), không quét cả VN |

> **Vị trí trong build:** làn offline **song song**, ưu tiên sau MVP. Cắt được hoàn toàn mà core vẫn chạy. Xem Phase 4 (§10) và Future Work (§12).

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
score = 0.30·semantic     # khớp query↔(tên+món+review), token/embedding
      + 0.20·geo_decay     # exp(-d/2km); THIẾU lat/lon → bỏ factor, renormalize
      + 0.15·quality       # poi_quality_score
      + 0.15·persona       # khớp segment+diet+price (0..1)
      + 0.10·rating_pop    # (rating/5 + popularity/100)/2
      + 0.10·localness      # bình dân + quality≥0.9 → +; family-run → +
      − 0.25·luxury_penalty # price_level=cao cấp → trừ
```

**Luật renormalize (mượn từ SYSTEM_FLOW — quan trọng):** factor nào **thiếu data** (vd user không gửi vị trí → không có geo_decay) thì **bỏ hẳn và chia lại trọng số các factor còn lại** (`wᵢ' = wᵢ/Σw_có_data`), **không** điền 0 giả (điền 0 sẽ dìm oan quán).

**Tune tay** trên 15 câu eval + 8 câu B/C (§11), không train. Cite: LM-Prior (Ju et al., [arXiv:2411.09065](https://arxiv.org/abs/2411.09065)) — semantic làm prior, các factor là adjustment.

### 7.3 LLM rerank (optional, cắt đầu tiên)
Top-10 → Qwen structured JSON → thứ tự cuối + `reasoning` tiếng Việt. Cite KALM4Rec. Bỏ được: SOFT order vẫn tốt.

---

## 8. API contract

```
GET /v1/recommend
  q       optional  câu tự nhiên (giữ dấu). Rỗng = "gợi ý quanh đây"
  lat,lon optional  vị trí user
  segment optional  family|romantic|business|group|fastfood
  diet    optional  vegetarian|halal
  price   optional  budget|mid|premium
  time    optional  HH:MM (default server now, Asia/Ho_Chi_Minh)
  limit   optional  default 12

GET /v1/poi?id=RES001        chi tiết 1 quán
GET /v1/assistant?q=...      Q&A RAG (optional)
GET /health                  status + số POI
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

---

## 9. Frontend — component cụ thể (props → render)

**`types.ts`** — mirror response §8: `Poi`, `WhyBreakdown`, `RecommendParams`, `RecommendResponse`.

**`api.ts`**
- `recommend(p: RecommendParams): Promise<RecommendResponse>` → GET `http://localhost:8000/v1/recommend` + querystring.
- `assistant(q: string)`, `getPoi(id)`.
- State chung ở `App.tsx`: `{query, userCtx, results, selectedPoi}` — đổi bất kỳ cái nào → gọi lại `recommend`.

| Component | Props (input) | Render (output) |
|---|---|---|
| **`MapView.tsx`** | `results: Poi[]`, `center`, `selectedId`, `onSelect(id)` | react-leaflet + OSM tiles; 1 marker/POI, marker chọn đổi màu; popup tên+score; re-fit bounds khi results đổi. *Mất net → ẩn tiles, hiện list.* |
| **`SearchBar.tsx`** | `value`, `onSearch(q)`, `onLocate()` | input + nút **"Gần tôi"** (`navigator.geolocation` → set lat/lon) + dropdown chọn thành phố (HN/HCM/ĐN/NT/HL/ĐL/Huế) khi không cấp GPS |
| **`FilterChips.tsx`** | `active: UserCtx`, `onChange(ctx)` | 4 nhóm chip: Segment (Gia đình/Hẹn hò/Nhóm/Ăn nhanh) · Diet (Chay/Halal) · Price (Bình dân/Trung bình/Cao cấp) · Time (Giờ hiện tại/Ăn khuya). Bấm → `onChange` → gọi lại API |
| **`ResultCard.tsx`** | `poi: Poi`, `onClick` | tên, cuisine, khoảng cách (`distanceMeters`), giá, badge `quality`, chip tags; nút **"Vì sao gợi ý?"** xổ `meta.why` (bar mỗi factor) + `reasoning` |
| **`AssistantBox.tsx`** *(opt)* | — | ô chat → `/v1/assistant`; hiện `answer` + list `sources` (badge nguồn) |

Layout: **map trái + list phải** (desktop) / map trên + list dưới (mobile). Theme dark/clean. Empty-state `not_found` hiển thị `message` + `suggestions` dạng chip bấm được (nới lỏng filter).

---

## 10. Timeline build (phased, có mốc cắt MVP)

Ước theo giờ-người. Điều chỉnh theo thời gian thật của bạn.

### Phase 0 — Setup (1h)
- Copy 5 CSV vào `preprocess/data/`. `go mod init` trong `engine/`. Skeleton `preprocess/*.py`.
- Tạo `.gitignore`: `engine/build/`, `.env`, `node_modules/`, `preprocess/__pycache__/`. **Không commit key.**
- `.env`: `DASHSCOPE_API_KEY=...` (Qwen). Đọc bằng `os.getenv` (Python) / `os.Getenv` (Go), không hardcode.
- `npm install` + thêm `react-leaflet leaflet` vào ui.
- Verify `vite dev` chạy + `go run .` chạy + 1 call Qwen test sống.

### Phase 1 — Backend core, KHÔNG LLM (3–4h) ★ MVP
- `preprocess/build_kb.py` (Python): CSV → kb.json (normalize taxonomy).
- `engine/retrieve.go`: parseQuery + recall + HARD gate.
- `engine/rerank.go`: SOFT score + geo_decay + renormalize + anti-luxury + `why`.
- `engine/main.go`: `/v1/recommend`, `/v1/poi`, `/health`.
- **DoD Phase 1:** `curl /v1/recommend?q=quán chay&lat=..&lon=..` trả JSON đúng, có why.

### Phase 2 — Frontend core (3–4h) ★ MVP
- `api.ts` + types.
- `MapView` + `SearchBar` + `FilterChips` + `ResultCard`.
- Nối end-to-end: gõ/bấm chip → map+list đổi.
- **DoD Phase 2:** demo được cảnh §1 (trừ assistant).

### Phase 3 — Đánh bóng + đo (2h)
- Chạy eval A/B/C (§11), tune weights.
- Style cho "cool": animation marker, badge, empty-state đẹp (not_found có gợi ý).

### Phase 4 — LLM assistant + rerank (2h) *(cắt được)*
- `engine/llm.go` cache-first + `engine/assistant.go` RAG + `AssistantBox`.
- `preprocess/ner_hutieubert.py`: tag tên quán/món → kb.json (nâng chất chống hallucination).
- LLM rerank top-10.

### Phase 4b — Enrichment/scraping lane (offline, song song, cắt được) *(§6.5)*
- Chạy **tách khỏi core**, bất cứ lúc nào sau Phase 0. Không chặn MVP.
- `preprocess/enrich.py`: scrape vài chục **POI thật** (không phải benchmark) → `build/enrichment.json` (cache).
- UI: badge nguồn + confidence trên card; nút demo "làm giàu" quán gap (chạy từ cache).
- **DoD:** 1 cảnh demo quality 0.6→0.9 có provenance, chạy được khi rút mạng.

### Phase 5 — Đóng gói (1–2h)
- README (methodology §13 + setup), video demo, (optional) build Tauri desktop.

**Đường MVP tối thiểu = Phase 0+1+2.** Có nó là đã có sản phẩm chạy + cool. 3,4,5 là cộng thêm.

---

## 10.5 Phân công 5 người (theo sở hữu file → zero conflict)

Nguyên tắc: **mỗi người sở hữu 1 nhóm file, không ai sửa file người khác.** Chỉ có 2 interface phải chốt chung sớm: **(i) schema `kb.json`** (P2↔P1), **(ii) API contract §8** (P1↔P5). Chốt xong 2 cái đó, 5 người chạy độc lập.

| Người | Vai trò | Sở hữu | Giao cho ai |
|---|---|---|---|
| **P1** | **Backend core — Retrieval & Ranking** (lõi thuật toán) | `retrieve.go`, `rerank.go`, `kb.go` — parse query, HARD gate, SOFT score, geo, `why{}` | dùng kb.json của P2; cấp `/v1/recommend` cho P5 |
| **P2** | **Data & Preprocessing** | `build_kb.py`, `embed.py`, taxonomy normalize, schema `kb.json`, precompute embedding | kb.json → P1; entity list → P4 |
| **P3** | **Enrichment & Scraping** (làn offline độc lập) | `enrich.py` (Apify/TinyFish/ZenRows), `enrichment.json`, provenance/confidence, demo 0.6→0.9 | enrichment.json → P5 (UI badge) |
| **P4** | **LLM & Assistant & Ngôn ngữ VN** | `llm.go`, `assistant.go`, prompt, `ner_hutieubert.py` (NER chống hallucination), chạy **eval A/B/C** | rerank/assistant nối vào P1; số eval → P5 |
| **P5** | **Frontend & Integration & Demo** | `main.go` (routing/CORS), toàn bộ `ui/`, `api.ts`, README, deck, video | ráp end-to-end, giữ API contract |

**Vì sao chia thế này:**
- P1 giữ lõi (điểm số + gate) — thứ quyết định chất lượng, không để ai khác đụng.
- P2 tách hẳn vì offline preprocessing là interface (kb.json) — làm xong là P1 chạy được ngay.
- P3 là làn offline hoàn toàn độc lập (scraping), cắt được mà không ảnh hưởng ai → giao người thích data/tự chủ cao.
- P4 gom mọi thứ "AI ngôn ngữ" (LLM + NER + prompt + eval) vì cùng họ kỹ năng; sở hữu eval vì họ lo chất lượng câu trả lời.
- P5 vừa frontend vừa integration/demo — người ráp cuối, giữ 2 binary (Go serve + vite) chạy chung, và làm phần "trông cool".

**Nếu team yếu Go:** P1 + P5 (2 người đụng Go nhiều nhất) cần biết Go; P2/P3/P4 thuần Python + prompt, không cần Go. Nếu chỉ 1 người biết Go → cho P1 làm luôn `main.go`, P5 tập trung frontend + demo.

**Nếu thiếu người (4 người):** gộp P3 vào P2 (data lo cả preprocess + enrich), cắt scraping trước.

---

## 11. Eval plan

`engine/eval.py` chạy 3 nhóm, in bảng pass/fail.

- **Nhóm A — 15 câu Public Evaluation** (không personalize): sanity, không được sai bẫy (Crystal BBQ→not_found, Halal-HCM→trung thực).
- **Nhóm B — personalize (5 câu):** segment=Romantic→loại fast food; diet=vegetarian→100% có món chay; time=00:30→chỉ quán qua đêm; segment=Family→ưu tiên có parking+kid; price=budget→loại cao cấp.
- **Nhóm C — localize (3 câu):** lat/lon HN→top-3 ở HN, không lẫn HCM; đổi vị trí→kết quả đổi; query "bún chả HCM" khi user ở HN→override, trả HCM.

**DoD:** A không sai bẫy + B/C ≥ 7/8 pass.

---

## 12. Future Work (đánh dấu rõ — không build hackathon)

Ghi vào deck slide "Roadmap" để thể hiện tầm nhìn mà không phải làm:

- **Embedding semantic search** (thay token-match) — Qwen `text-embedding-v3` (API) hoặc `vietnamese-embedding` (local A40). Tăng chất lượng NL query. *Đã chừa chỗ trong rerank.*
- **HuTieuBERT fine-tune SBERT-style** — hiện HuTieuBERT chỉ dùng cho NER/POS (thế mạnh). Muốn dùng làm embedding retrieval thì phải fine-tune contrastive (SBERT), ngoài phạm vi hackathon.
- **Route-aware / along-route recommend** — cần Valhalla; gợi ý quán dọc hành trình liên tỉnh (differentiator VETC). Cite SYSTEM_FLOW draft.
- **Behavior ranking** (Tire-Wear/Repeat kiểu Amap) — cần dữ liệu di chuyển thật từ VETC.
- **Enrichment pipeline mở rộng** (§6.5) — scrape social/web quy mô lớn cho POI thật toàn VN (TinyFish/ZenRows), OCR menu ảnh. Hackathon chỉ demo vài chục POI từ cache.
- **Social buzz reranking** — TikTok/Threads mention → `buzz_score` factor mềm (tier 4b). Cần pipeline phương ngữ VN (slang → aspect → sentiment).
- **Provenance + confidence từng field** — 5-tier source registry (CSV → licensed API → agentic-facts → social-signals → business/driver-verified).
- **Deep recommenders** (GETNext/LightGCN/SASRec/LightFM) — chỉ có nghĩa khi POI DB lên 10^4–10^6; với 30 POI sẽ overfit. Cite làm "scaling path".
- **Tauri desktop packaging** — wrap thành app cài được.

---

## 13. Methodology narrative (dán vào README + deck)

> The recommender follows the **retrieve-then-rerank cold-start paradigm** of KALM4Rec (Kieu et al., 2024), built for restaurant recommendation with no user history. Stage 1 does rule-based candidate recall then a **hard-constraint gate** (dietary, city, price, opening hours) that rejects rather than silently relaxes — this is where we handle honesty traps (a queried restaurant absent from the knowledge base returns not_found, never a fabrication). Stage 2 ranks survivors with a linear **soft score** combining lexical relevance, geographic decay (`exp(-d/2km)`), POI quality, persona match (segment/diet/price), and an anti-luxury term that favors small local eateries per the TASCO brief. Missing signals are dropped and weights renormalized rather than zero-filled. An optional LLM stage re-ranks the top candidates and generates a Vietnamese explanation.
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

## 15. Trước khi code — chốt 3 việc

1. **Copy 5 CSV** từ draft `tasco-map-food-intelligence/` → `Toi-la-AI-TascoP11-AABW2026/preprocess/data/`.
2. **Chốt 5 vai trò (§10.5)** + 2 interface: schema `kb.json` (P2↔P1), API contract §8 (P1↔P5).
3. **Chốt LLM:** key Qwen (`DASHSCOPE_API_KEY`) đưa vào `.env`, test 1 call sống. Hết hạn 14/7 → build xong trước hạn. Không có LLM → bỏ Phase 4, core vẫn đủ demo.

Xong 3 việc → chạy Phase 0. Không code trước khi copy data. **Nhắc lại: không commit API key vào git.**

---

*Plan này build from scratch trong repo `Toi-la-AI-TascoP11-AABW2026`. Draft cũ chỉ tham khảo. Chưa có dòng code nào.*
