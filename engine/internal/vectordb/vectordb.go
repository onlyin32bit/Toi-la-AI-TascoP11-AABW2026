// Package vectordb is an optional Qdrant vector search layer (supplementary
// semantic score, §12 Future Work "Embedding semantic search"). Fully inert
// unless QDRANT_URL is set: callers must treat any error as "skip vector
// search, fall back to lexical" — never fail a request because of it. Talks
// to Qdrant's REST API directly (stdlib net/http) — no client SDK. The
// collection is created/populated offline by cmd/embed, not by this package.
package vectordb

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"tascop11/engine/internal/config"
	"tascop11/engine/internal/llmclient"
)

type qdrantConfig struct {
	url        string
	collection string
}

func loadQdrantConfig() qdrantConfig {
	return qdrantConfig{
		url:        normalizeURL(os.Getenv("QDRANT_URL")),
		collection: config.Or("QDRANT_COLLECTION", "tascop11_pois"),
	}
}

// normalizeURL prepends https:// to a bare host:port (e.g. a Railway/managed
// Qdrant URL pasted without its scheme) so http.NewRequest doesn't fail with
// "unsupported protocol scheme". Leaves an already-schemed URL untouched.
func normalizeURL(u string) string {
	u = strings.TrimRight(u, "/")
	if u == "" || strings.Contains(u, "://") {
		return u
	}
	return "https://" + u
}

// Enabled reports whether vector search should be attempted at all.
func Enabled() bool {
	return os.Getenv("QDRANT_URL") != ""
}

var httpClient = &http.Client{Timeout: 10 * time.Second}

// Search embeds the query and searches Qdrant, returning POI id -> cosine
// similarity (0..1). Returns (nil, nil) when disabled or the query is empty.
var Search = func(query string, limit int) (map[string]float64, error) {
	cfg := loadQdrantConfig()
	query = strings.TrimSpace(query)
	if cfg.url == "" || query == "" {
		return nil, nil
	}
	vec, err := llmclient.Embed(query)
	if err != nil {
		return nil, fmt.Errorf("vectordb: embed query: %w", err)
	}
	return search(cfg, vec, limit)
}

type searchReq struct {
	Vector      []float32 `json:"vector"`
	Limit       int       `json:"limit"`
	WithPayload bool      `json:"with_payload"`
}

type searchResp struct {
	Result []struct {
		Score   float64        `json:"score"`
		Payload map[string]any `json:"payload"`
	} `json:"result"`
}

func search(cfg qdrantConfig, vec []float32, limit int) (map[string]float64, error) {
	if limit <= 0 {
		limit = 20
	}
	body, err := json.Marshal(searchReq{Vector: vec, Limit: limit, WithPayload: true})
	if err != nil {
		return nil, err
	}
	url := cfg.url + "/collections/" + cfg.collection + "/points/search"
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("vectordb: request failed: %w", err)
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("vectordb: %s: %s", resp.Status, string(respBody))
	}

	var parsed searchResp
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return nil, fmt.Errorf("vectordb: parse search response: %w", err)
	}

	out := make(map[string]float64, len(parsed.Result))
	for _, r := range parsed.Result {
		id, _ := r.Payload["poi_id"].(string)
		if id == "" {
			continue
		}
		out[id] = r.Score
	}
	return out, nil
}

// --- offline admin operations (cmd/embed: create collection, upsert points) ---

// Point is one vector + payload to upsert.
type Point struct {
	ID      uint64         `json:"id"`
	Vector  []float32      `json:"vector"`
	Payload map[string]any `json:"payload"`
}

type createCollectionReq struct {
	Vectors struct {
		Size     int    `json:"size"`
		Distance string `json:"distance"`
	} `json:"vectors"`
}

// EnsureCollection creates the collection if it doesn't already exist.
func EnsureCollection(vectorSize int) error {
	cfg := loadQdrantConfig()
	if cfg.url == "" {
		return fmt.Errorf("vectordb: QDRANT_URL not set")
	}
	url := cfg.url + "/collections/" + cfg.collection
	if resp, err := http.Get(url); err == nil {
		defer resp.Body.Close()
		if resp.StatusCode == http.StatusOK {
			return nil // already exists
		}
	}
	var body createCollectionReq
	body.Vectors.Size = vectorSize
	body.Vectors.Distance = "Cosine"
	data, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPut, url, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("vectordb: create collection: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return fmt.Errorf("vectordb: create collection %s: %s", resp.Status, string(respBody))
	}
	return nil
}

type upsertReq struct {
	Points []Point `json:"points"`
}

// UpsertPoints writes a batch of points to the collection (wait=true, so the
// call returns only once the write is durable — fine for offline batch use).
func UpsertPoints(points []Point) error {
	cfg := loadQdrantConfig()
	if cfg.url == "" {
		return fmt.Errorf("vectordb: QDRANT_URL not set")
	}
	url := cfg.url + "/collections/" + cfg.collection + "/points?wait=true"
	data, err := json.Marshal(upsertReq{Points: points})
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPut, url, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("vectordb: upsert points: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return fmt.Errorf("vectordb: upsert points %s: %s", resp.Status, string(respBody))
	}
	return nil
}
