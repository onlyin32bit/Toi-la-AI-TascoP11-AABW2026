# Single-service deploy: Go engine serves both the API and the built React
# UI from one binary/origin (server.go's UIDist static file handler), so
# Railway only needs one Dockerfile, one service, no docker-compose.

# ---- Stage 1: build the frontend ----
FROM node:20-bookworm AS ui-build
WORKDIR /app/ui
COPY ui/package.json ui/package-lock.json ./
RUN npm ci
COPY ui/ ./
RUN npm run build

# ---- Stage 2: build engine/build/kb.json from the CSVs (stdlib only) ----
FROM python:3.12-slim AS kb-build
WORKDIR /app
COPY preprocess/ ./preprocess/
RUN mkdir -p engine/build && cd preprocess && python3 build_kb.py

# ---- Stage 3: build the Go binary ----
FROM golang:1.25-bookworm AS go-build
WORKDIR /app/engine
COPY engine/go.mod engine/go.sum ./
RUN go mod download
COPY engine/ ./
RUN CGO_ENABLED=0 go build -o /app/server ./cmd/server

# ---- Stage 4: minimal runtime ----
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=go-build /app/server ./server
COPY --from=kb-build /app/engine/build ./build
COPY --from=ui-build /app/ui/dist ./ui-dist

ENV KB_DIR=/app/build
ENV UI_DIST=/app/ui-dist
# Railway injects PORT at runtime; the binary reads it via config.Or("PORT","8000").
EXPOSE 8000
CMD ["./server"]
