# Makefile — Tasco P11 Restaurant Intelligence
# Go engine (online) + Python preprocessing (offline). Xem PLAN.md.

GO         ?= go
PYTHON     ?= python3
ENGINE_DIR := engine
PREP_DIR   := preprocess

.DEFAULT_GOAL := help

.PHONY: help kb thuduc thuduc-agent thuduc-map-kb thuduc-map build run test vet tidy fmt clean check qdrant-up qdrant-down embed enrich docker-up docker-down seed-contrib seed-db demo thuduc-compile thuduc-embed

help: ## Liệt kê các target
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

kb: ## Sinh engine/build/kb.json từ 5 CSV (chạy 1 lần / khi đổi data)
	cd $(PREP_DIR) && $(PYTHON) build_kb.py

seed-contrib: ## Sinh engine/build/contributions.json demo (2 quán UGC mẫu, 1 cái trùng benchmark để demo dedup)
	cd $(PREP_DIR) && $(PYTHON) seed_demo_contributions.py

seed-db: ## Tạo tài khoản demo trong Postgres (cần DATABASE_URL — xem docker-up)
	cd $(ENGINE_DIR) && $(GO) run ./cmd/seed

thuduc: ## Scrape Foody Thủ Đức qua TinyFish -> engine/build/thuduc_enrichment.json (cần TINYFISH_API_KEY)
	cd $(PREP_DIR) && scrape_env/bin/python scrape_thuduc.py $(ARGS)

thuduc-apify: ## Scrape Google Places (Apify) Thủ Đức, merge vào cùng thuduc_enrichment.json (cần APIFY_TOKEN)
	cd $(PREP_DIR) && scrape_env/bin/python scrape_thuduc_apify.py $(ARGS)

thuduc-agent: ## Per-POI plan -> source tools -> >=2-source verify/refuse report (cached by default; ARGS=--live for APIs)
	cd $(PREP_DIR) && $(PYTHON) agent_loop.py $(ARGS)

thuduc-compile: thuduc-agent ## Verified facts -> thuduc_resolved.json + serving KB
	cd $(PREP_DIR) && $(PYTHON) resolve_thuduc.py && $(PYTHON) compile_thuduc_kb.py

thuduc-map-kb: ## Build demo KB with all geolocated Thu Duc POIs (explicitly unverified)
	cd $(PREP_DIR) && $(PYTHON) compile_thuduc_map_kb.py

thuduc-map: thuduc-map-kb ## Run API with all Thu Duc POIs so they appear on the map
	cd $(ENGINE_DIR) && KB_DIR=build/thuduc MAP_ALL_POIS=1 $(GO) run ./cmd/server

thuduc-embed: ## Descriptive text ONLY (searchableText) -> Qdrant, collection riêng tascop11_thuduc
	cd $(ENGINE_DIR) && $(GO) run ./cmd/embed -kb-file ../data/thuduc/thuduc_kb.json -collection tascop11_thuduc

build: ## Build Go engine -> engine/engine (binary tĩnh)
	cd $(ENGINE_DIR) && $(GO) build -o engine ./cmd/server

run: ## Chạy engine trên :8000 (cần kb.json — chạy `make kb` trước)
	cd $(ENGINE_DIR) && $(GO) run ./cmd/server

enrich: ## Sinh ai_summary/sentiment/cuisine_classification/dining_occasions (cần kb.json)
	cd $(ENGINE_DIR) && $(GO) run ./cmd/enrich

test: ## Chạy toàn bộ unit + HTTP test
	cd $(ENGINE_DIR) && $(GO) test ./...

test-v: ## Test có verbose
	cd $(ENGINE_DIR) && $(GO) test ./... -v

vet: ## go vet
	cd $(ENGINE_DIR) && $(GO) vet ./...

tidy: ## go mod tidy
	cd $(ENGINE_DIR) && $(GO) mod tidy

fmt: ## gofmt toàn bộ
	cd $(ENGINE_DIR) && $(GO) fmt ./...

check: vet test ## vet + test (chạy trước khi commit)

qdrant-up: ## Auto setup: chạy Qdrant qua Docker + embed kb.json nếu đã có (optional, semantic search)
	./scripts/setup_qdrant.sh

qdrant-down: ## Dừng + xoá container Qdrant
	./scripts/setup_qdrant.sh --down

docker-up: ## Chạy Postgres + Qdrant qua docker-compose (optional infra, xem docker-compose.yml)
	docker compose up -d

docker-down: ## Dừng Postgres + Qdrant (thêm ARGS=-v để xoá luôn data)
	docker compose down $(ARGS)

embed: ## Sinh embedding cho kb.json và upsert vào Qdrant (cần kb.json + Qdrant đang chạy)
	cd $(ENGINE_DIR) && $(GO) run ./cmd/embed

clean: ## Xoá binary + kb.json build
	rm -f $(ENGINE_DIR)/engine
	rm -f $(ENGINE_DIR)/build/kb.json
	rm -rf $(ENGINE_DIR)/build/cache

# Tiện dụng: dựng lại data rồi chạy
dev: kb run ## kb + run

demo: kb seed-contrib run ## Demo nhanh: kb + UGC mẫu + chạy engine (Postgres/Qdrant optional — xem docker-up, seed-db)
.PHONY: dev demo test-v
