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
| Backend | Python 3.11 + `http.server` stdlib (zero-dep core) | offline-safe, không cần cài gì để chạy core |
| Data | 5 CSV copy vào `engine/data/` | ground truth |
| Semantic (core) | lexical token-match (như draft) | zero-dep, chạy chắc |
| Semantic (nâng cao) | embedding `dangvantuan/vietnamese-embedding` cache ra đĩa | *Future Work* / nếu còn giờ |
| LLM | Gemini Flash, **cache-first ra đĩa** | assistant + rerank; demo sống khi mất mạng |
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
- A40 chỉ giúp nếu **self-host embedding/LLM**; nếu gọi Gemini API thì A40 vô dụng cho latency. → Core không phụ thuộc A40.

---

## 4. Cấu trúc repo (build vào đây)

```
Toi-la-AI-TascoP11-AABW2026/
├── engine/                      ← BACKEND MỚI (Python)
│   ├── data/                    ← copy 5 CSV vào đây
│   ├── build_kb.py              ← OFFLINE: CSV → build/kb.json
│   ├── kb.py                    ← load KB, hàm norm(), is_open_at(), haversine()
│   ├── retrieve.py              ← parse_query + recall + HARD gate
│   ├── rerank.py                ← SOFT score (personalize/localize/anti-luxury)
│   ├── llm.py                   ← Gemini client, cache-first ra đĩa   [optional]
│   ├── assistant.py             ← RAG trả lời Q&A, trích nguồn          [optional]
│   ├── serve.py                 ← HTTP :8000, /v1/recommend ...
│   └── build/                   ← kb.json, cache LLM (git-ignored)
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

### 5.1 `build_kb.py` (OFFLINE)
- **In:** 5 CSV.
- **Ra:** `build/kb.json` = list POI, mỗi POI:
  ```json
  {
    "id": "poi:res001", "restaurant_id": "RES001",
    "name": "Phở Bếp Nhà", "category": "Nhà hàng", "cuisine_type": "Việt Nam",
    "city": "Hà Nội", "district": "Hoàn Kiếm", "address": "...",
    "lat": 21.040388, "lon": 105.844615,
    "price_level": "bình dân", "avg_price_vnd": 68289,
    "rating": 3.8, "review_count": 608, "popularity": 55,
    "opening": {"open_min": 540, "close_min": 1380, "overnight": false, "raw": "09:00-23:00"},
    "segments": ["family","fastfood","travel","budget"],
    "amenities": ["nice_view","reservation","wifi","parking","kid_friendly"],
    "diet": ["vegetarian"?],  "dishes": [{"name":"Phở bò","price":68289,"tags":[...]}],
    "strengths": [...], "weaknesses": [...],
    "quality": 0.88, "tokens": ["pho","bep","nha","bo",...],
    "reviews": [{"text":"...","sentiment":"pos","aspects":[...]}]
  }
  ```
- Normalize map (text VN → tag): "Bãi đỗ xe"→`parking`, "Phù hợp trẻ em"→`kid_friendly`, "Gia đình"→`family`, "Ăn chay"→`vegetarian`, "Cao cấp"→`premium`, ...
- `price_level`: "Bình dân"→`budget`, "Trung bình"→`mid`, "Cao cấp"/"Sang trọng"→`premium`.

### 5.2 `kb.py`
- `load()` → đọc kb.json (cache-first).
- `norm(s)` → bỏ dấu, lowercase (khớp tiếng Việt có/không dấu).
- `is_open_at(opening, minute)` → xử lý cả quán qua đêm (10:00-02:00).
- `haversine(lat1,lon1,lat2,lon2)` → mét.

### 5.3 `retrieve.py`
- `parse_query(q)` → FilterSpec `{city, dish, segments, diet, amenities, max_price, min_rating, open_after}` (regex, có sẵn logic tốt trong draft để mượn ý).
- `recall(kb, filterspec)` → ứng viên (token match tên + món + review).
- **HARD gate** (loại thẳng, không nới lỏng ngầm):
  - dish nêu đích danh mà quán không có → loại.
  - city, diet (chay/halal), max_price, min_rating, open_after → fail thì loại.
  - **Rỗng sau gate → trả `not_found` + gợi ý nới lỏng có nhãn** (xử lý bẫy Halal-HCM, Crystal BBQ tại đây).

### 5.4 `rerank.py` — SOFT score (§7 công thức)
- **In:** ứng viên qua gate + user_ctx.
- **Ra:** top-K sắp xếp, mỗi item kèm `why{}` breakdown từng factor + `reasoning` tiếng Việt.

### 5.5 `llm.py` + `assistant.py` (optional, cắt được)
- `llm.py`: gọi Gemini, **hash query → cache ra đĩa**; mất mạng → đọc cache.
- `assistant.py`: RAG — lấy top POI + evidence → prompt Gemini → trả lời **có trích provenance**. Bẫy Crystal BBQ: không có trong KB → trả `not_found`, cấm bịa.

### 5.6 `serve.py`
- stdlib HTTP :8000, CORS mở (`*`) cho React gọi. Endpoints ở §8.

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
Top-10 → Gemini structured JSON → thứ tự cuối + `reasoning` tiếng Việt. Cite KALM4Rec. Bỏ được: SOFT order vẫn tốt.

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

## 9. Frontend — component cụ thể

- **`api.ts`**: `recommend(params)` → fetch `http://localhost:8000/v1/recommend`.
- **`MapView.tsx`**: react-leaflet + OSM tiles. Marker mỗi POI, popup tên + score. Marker đổi khi kết quả đổi. Center theo vị trí user. *Tiles cần net; mất net → degrade sang list (vẫn chạy).*
- **`SearchBar.tsx`**: input + nút **"Gần tôi"** (`navigator.geolocation`) + fallback dropdown chọn thành phố (HN/HCM/ĐN/NT/HL/ĐL/Huế) cho demo không cấp GPS.
- **`FilterChips.tsx`**: 4 nhóm chip — Segment (Gia đình/Hẹn hò/Nhóm/Ăn nhanh), Diet (Chay/Halal), Price (Bình dân/Trung bình/Cao cấp), Time (Giờ hiện tại/Ăn khuya). Bấm = gửi lại request.
- **`ResultCard.tsx`**: tên, ảnh placeholder, cuisine, khoảng cách, giá, badge chất lượng, nút **"Vì sao gợi ý?"** xổ ra `meta.why` breakdown + reasoning.
- **`AssistantBox.tsx`** *(optional)*: ô chat → `/v1/assistant`, hiện câu trả lời + nguồn.

Giao diện: dark/clean, layout **map trái + list phải** (hoặc map trên + list dưới trên mobile).

---

## 10. Timeline build (phased, có mốc cắt MVP)

Ước theo giờ-người. Điều chỉnh theo thời gian thật của bạn.

### Phase 0 — Setup (1h)
- Copy 5 CSV vào `engine/data/`. Tạo skeleton `engine/*.py`.
- `npm install` + thêm `react-leaflet leaflet` vào ui.
- Verify `vite dev` chạy + Python `http.server` chạy.

### Phase 1 — Backend core, KHÔNG LLM (3–4h) ★ MVP
- `build_kb.py`: CSV → kb.json (normalize taxonomy).
- `retrieve.py`: parse_query + recall + HARD gate.
- `rerank.py`: SOFT score + geo_decay + renormalize + anti-luxury + `why`.
- `serve.py`: `/v1/recommend`, `/v1/poi`, `/health`.
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
- `llm.py` cache-first + `assistant.py` RAG + `AssistantBox`.
- LLM rerank top-10.

### Phase 5 — Đóng gói (1–2h)
- README (methodology §13 + setup), video demo, (optional) build Tauri desktop.

**Đường MVP tối thiểu = Phase 0+1+2.** Có nó là đã có sản phẩm chạy + cool. 3,4,5 là cộng thêm.

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

- **Embedding semantic search** (thay token-match) — `vietnamese-embedding` trên A40 hoặc Gemini embedding. Tăng chất lượng NL query. *Dễ thêm sau, đã chừa chỗ trong rerank.*
- **Route-aware / along-route recommend** — cần Valhalla; gợi ý quán dọc hành trình liên tỉnh (differentiator VETC). Cite SYSTEM_FLOW draft.
- **Behavior ranking** (Tire-Wear/Repeat kiểu Amap) — cần dữ liệu di chuyển thật từ VETC.
- **Enrichment pipeline** (web/OCR bù data cho quán thiếu) — cite draft ENGINE_PROPOSAL.
- **Provenance + confidence từng field** — 5-tier source registry.
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
4. Reimers, N., Gurevych, I. **Sentence-BERT.** EMNLP 2019.
5. Cormack, G.V. et al. **Reciprocal Rank Fusion.** [SIGIR 2009](https://dl.acm.org/doi/10.1145/1571941.1572114). *(nếu dùng nhiều recall channel)*

**Related / Future (why not deep models):**
6. Li, P. et al. **LLMs for Next POI Recommendation.** [arXiv:2404.17591](https://arxiv.org/abs/2404.17591), SIGIR 2024.
7. He, X. et al. **LightGCN.** [arXiv:2002.02126](https://arxiv.org/abs/2002.02126), SIGIR 2020.
8. Yang, S. et al. **GETNext.** [SIGIR 2022](https://dl.acm.org/doi/10.1145/3477495.3531983).
9. Kang & McAuley. **SASRec.** ICDM 2018.
10. Kula, M. **LightFM.** RecSys 2015.
11. **LLMTreeRec** — LLMs for Cold-Start. [arXiv:2404.00702](https://arxiv.org/abs/2404.00702), 2024.
12. **A Survey on POI Recommendation.** [arXiv:2410.02191](https://arxiv.org/abs/2410.02191), 2024.

**Problem motivation (paper TASCO đưa):**
13. Li, Y. et al. **Personalized Query Auto-Completion at Baidu Maps.** [ACM 2020](https://dl.acm.org/doi/10.1145/3394137).

---

## 15. Trước khi code — chốt 3 việc

1. **Copy 5 CSV** từ draft `tasco-map-food-intelligence/` → `Toi-la-AI-TascoP11-AABW2026/engine/data/`.
2. **Chốt team/giờ:** ai làm backend (Phase 1), ai làm frontend (Phase 2)? 2 làn chạy song song sau Phase 0.
3. **Chốt LLM:** có key Gemini sống không? Không → bỏ Phase 4, core vẫn đủ demo.

Xong 3 việc → chạy Phase 0. Không code trước khi copy data.

---

*Plan này build from scratch trong repo `Toi-la-AI-TascoP11-AABW2026`. Draft cũ chỉ tham khảo. Chưa có dòng code nào.*
