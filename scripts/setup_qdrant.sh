#!/usr/bin/env bash
# Auto setup for the optional Qdrant vector-search layer (engine/vectordb.go).
# Starts a local Qdrant via Docker, waits for it to be healthy, then (if
# engine/build/kb.json already exists) populates it by running cmd/embed.
#
# Usage:
#   ./scripts/setup_qdrant.sh          # start Qdrant + embed if kb.json exists
#   ./scripts/setup_qdrant.sh --down   # stop and remove the container
#
# Safe to re-run: reuses the existing container/volume if present, and
# cmd/embed upserts by a deterministic point id so re-embedding is a no-op
# for unchanged POIs.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENGINE_DIR="$ROOT_DIR/engine"
STORAGE_DIR="$ENGINE_DIR/build/qdrant_storage"

CONTAINER_NAME="${QDRANT_CONTAINER_NAME:-tascop11-qdrant}"
QDRANT_PORT="${QDRANT_PORT:-6333}"
QDRANT_GRPC_PORT="${QDRANT_GRPC_PORT:-6334}"
QDRANT_IMAGE="${QDRANT_IMAGE:-qdrant/qdrant:latest}"
URL="http://localhost:${QDRANT_PORT}"

if [[ "${1:-}" == "--down" ]]; then
  echo "==> stopping and removing ${CONTAINER_NAME}"
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  echo "==> done"
  exit 0
fi

echo "==> Vector DB (Qdrant) auto setup"

if ! command -v docker &>/dev/null; then
  echo "error: docker not found. Install Docker: https://docs.docker.com/get-docker/" >&2
  exit 1
fi
if ! docker info &>/dev/null; then
  echo "error: docker daemon not reachable (is Docker running?)" >&2
  exit 1
fi

mkdir -p "$STORAGE_DIR"

if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  echo "==> ${CONTAINER_NAME} already running"
elif docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  echo "==> starting existing container ${CONTAINER_NAME}"
  docker start "$CONTAINER_NAME" >/dev/null
else
  echo "==> creating container ${CONTAINER_NAME} (${QDRANT_IMAGE}, port ${QDRANT_PORT})"
  docker run -d --name "$CONTAINER_NAME" \
    -p "${QDRANT_PORT}:6333" -p "${QDRANT_GRPC_PORT}:6334" \
    -v "${STORAGE_DIR}:/qdrant/storage" \
    "$QDRANT_IMAGE" >/dev/null
fi

echo -n "==> waiting for Qdrant to be healthy"
ready=0
for _ in $(seq 1 30); do
  if curl -sf "${URL}/collections" >/dev/null 2>&1; then
    ready=1
    echo " ok"
    break
  fi
  echo -n "."
  sleep 1
done
if [[ "$ready" -ne 1 ]]; then
  echo
  echo "error: Qdrant did not become healthy within 30s. Check: docker logs ${CONTAINER_NAME}" >&2
  exit 1
fi

echo "==> Qdrant ready at ${URL} (dashboard: ${URL}/dashboard)"
echo "    Set in .env: QDRANT_URL=${URL}"

KB_JSON="$ENGINE_DIR/build/kb.json"
if [[ -f "$KB_JSON" ]]; then
  echo "==> populating embeddings (go run ./cmd/embed)"
  (cd "$ENGINE_DIR" && QDRANT_URL="$URL" go run ./cmd/embed)
else
  echo "==> ${KB_JSON} not found yet. Run these next:"
  echo "      python3 preprocess/build_kb.py"
  echo "      cd engine && QDRANT_URL=${URL} go run ./cmd/embed"
fi

echo "==> done"
