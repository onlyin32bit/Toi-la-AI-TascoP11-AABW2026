# Changelog

Tất cả thay đổi đáng chú ý của dự án được ghi ở đây, theo định dạng
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added — DEV1 Go engine (online serving)

Backend engine mới bằng Go thuần (chỉ dùng standard library, zero external dependency),
đặt tại `engine/`. Đọc `engine/build/kb.json` do pipeline Python offline (DEV2) sinh ra.

- **`engine/kb.go` — KB loader + primitives**: nạp `kb.json` (benchmark, gắn
  `source="tasco_csv"`, `verified=true`) và `contributions.json` (UGC, `verified=false`);
  dựng chỉ mục token mỗi POI, index theo cả `restaurant_id` và `id`. Kèm `norm()` bỏ dấu
  tiếng Việt (bảng diacritics đầy đủ, khớp `taxonomy.norm`), `tokenize()`, `isOpenAt()`
  xử lý ca qua đêm, và `haversine()` tính khoảng cách mét.
- **`engine/retrieve.go` — recall + HARD gate + chống hallucination**: `ParseQuery`
  (alias thành phố, intent hint segment/diet/amenity, trần giá, rating tối thiểu,
  giờ mở cửa/ăn khuya), `DetectDish` (dò tên món thật theo n-gram, biến thành ràng buộc
  cứng), `NamedEntities` (bắt tên riêng lạ không có trong KB — bẫy "Crystal BBQ"),
  và `Recall` áp HARD gate (món/thành phố/giá/rating/giờ/chế độ ăn) trả `not_found`
  trung thực kèm gợi ý nới lỏng (bẫy "Halal ở HCM").
- **`engine/rerank.go` — SOFT score có giải thích**: điểm tuyến tính semantic /
  geo_decay / quality / persona / rating_pop / localness, trừ luxury_penalty; **renormalize**
  trọng số khi thiếu tín hiệu (không có vị trí, không có query, không có persona) thay vì
  điền 0; sinh `why{}` từng factor + `reasoning` tiếng Việt (khoảng cách, khớp persona,
  giờ mở cửa).
- **`engine/compare.go` — so sánh quán**: side-by-side giá/rating/quality/segments/diet/
  khoảng cách/top 3 món; id không tồn tại gom vào `notFound`.
- **`engine/contribute.go` — UGC (write-path duy nhất)**: `POST /v1/contribute` thêm quán
  (validate toạ độ trong bbox Việt Nam, id `ugc:<hex>`), `POST /v1/contribute/menu` OCR
  menu ảnh qua seam `OCRMenu` (DEV3 override); lưu vào `contributions.json` có mutex,
  không đụng benchmark.
- **`engine/main.go` — HTTP server**: routes `/health`, `/v1/recommend`, `/v1/poi`,
  `/v1/compare`, `/v1/contribute`, `/v1/contribute/menu`; stub 501 cho `/v1/assistant` và
  `/v1/dishes/recognize` (seam DEV3). Middleware CORS `*`, `X-Request-Id`, `X-Locale`,
  `X-Timezone`, preflight OPTIONS, recover panic → `ErrorResponse`. Chế độ `eval=1` loại
  UGC khỏi kết quả chấm điểm. Tuỳ chọn serve `UI_DIST` tĩnh cùng origin. Cấu hình qua env
  `PORT` / `KB_DIR` / `UI_DIST`.
- **`engine/types.go`**: DTO tương thích Tasco Maps (`PlaceResult`, `RecommendResponse`,
  `NotFound`, `ErrorResponse`, `CompareResponse`, `Why`).

### Seams (để DEV2/DEV3 nối)

- `OCRMenu` trong `contribute.go` mặc định trả lỗi "OCR chưa nối" — DEV3 override ở `vision.go`.
- `/v1/assistant`, `/v1/dishes/recognize` trả 501 `not_implemented` — DEV3 hiện thực sau.
- `POI.Sentiment` giữ dạng `json.RawMessage` (pass-through) chờ `summarize.py` (DEV3) điền.

### Tests

- **`engine/engine_test.go`** — 25 unit test (stdlib `testing`, hermetic, dựng KB
  trong bộ nhớ, không cần `kb.json`). Chạy `go test ./...` trong `engine/` → **25/25 PASS**.
  Phủ: `norm`/`tokenize` bỏ dấu tiếng Việt, `isOpenAt` (giờ thường + qua đêm + unset),
  `haversine`, `ParseQuery` (alias thành phố / giá `100k` & `100.000` & `trieu` / rating /
  `sau 23:00` & `ăn khuya` / intent hint), `DetectDish` (drop sub-token), `NamedEntities`
  (bẫy Crystal BBQ + không false-positive tên thành phố), HARD gate (city/dish/diet) +
  `buildNotFound` (bẫy Halal-HCM), SOFT score (geo_decay gần thắng, renormalize khi thiếu
  vị trí, luxury_penalty, localness, persona), `Rerank` sắp xếp giảm dần, `Compare`.

### Dev config

- **`.env.example`** (repo root) — mẫu biến môi trường. DEV1 Go engine KHÔNG cần secret
  (chỉ `PORT`/`KB_DIR`/`UI_DIST`); secret (`DASHSCOPE_API_KEY` Qwen + fallback/scraping)
  dành cho DEV3/Python. `.env` thật đã được `.gitignore`.
- **`.gitignore`** — thêm `engine/engine` (binary `go build`) để không commit nhầm.
