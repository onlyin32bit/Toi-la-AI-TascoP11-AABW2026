# Makefile — Tasco P11 Restaurant Intelligence
# Go engine (online) + Python preprocessing (offline). Xem PLAN.md.

GO         ?= go
PYTHON     ?= python3
ENGINE_DIR := engine
PREP_DIR   := preprocess

.DEFAULT_GOAL := help

.PHONY: help kb build run test vet tidy fmt clean check

help: ## Liệt kê các target
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

kb: ## Sinh engine/build/kb.json từ 5 CSV (chạy 1 lần / khi đổi data)
	cd $(PREP_DIR) && $(PYTHON) build_kb.py

build: ## Build Go engine -> engine/engine (binary tĩnh)
	cd $(ENGINE_DIR) && $(GO) build -o engine .

run: ## Chạy engine trên :8000 (cần kb.json — chạy `make kb` trước)
	cd $(ENGINE_DIR) && $(GO) run .

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

clean: ## Xoá binary + kb.json build
	rm -f $(ENGINE_DIR)/engine
	rm -f $(ENGINE_DIR)/build/kb.json

# Tiện dụng: dựng lại data rồi chạy
dev: kb run ## kb + run
.PHONY: dev test-v
