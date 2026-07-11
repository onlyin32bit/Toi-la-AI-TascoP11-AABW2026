package vectordb

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"tascop11/engine/internal/llmclient"
)

func TestQdrantDisabledByDefault(t *testing.T) {
	os.Unsetenv("QDRANT_URL")
	if Enabled() {
		t.Errorf("Enabled() = true with QDRANT_URL unset, want false")
	}
	scores, err := Search("bun cha", 10)
	if err != nil {
		t.Errorf("Search with disabled Qdrant returned error: %v", err)
	}
	if scores != nil {
		t.Errorf("Search with disabled Qdrant = %v, want nil", scores)
	}
}

func TestSearchEmptyQuery(t *testing.T) {
	t.Setenv("QDRANT_URL", "http://example.invalid")
	scores, err := Search("", 10)
	if err != nil || scores != nil {
		t.Errorf("Search(\"\") = (%v, %v), want (nil, nil)", scores, err)
	}
}

func TestQdrantSearchMocked(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/collections/tascop11_pois/points/search" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"result": []map[string]any{
				{"score": 0.91, "payload": map[string]any{"poi_id": "poi:resa"}},
				{"score": 0.42, "payload": map[string]any{"poi_id": "poi:resb"}},
			},
		})
	}))
	defer srv.Close()

	t.Setenv("QDRANT_URL", srv.URL)
	t.Setenv("QDRANT_COLLECTION", "tascop11_pois")

	origEmbed := llmclient.Embed
	llmclient.Embed = func(text string) ([]float32, error) { return []float32{0.1, 0.2, 0.3}, nil }
	defer func() { llmclient.Embed = origEmbed }()

	scores, err := Search("bun cha ha noi", 10)
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if scores["poi:resa"] != 0.91 || scores["poi:resb"] != 0.42 {
		t.Errorf("scores = %v, want poi:resa=0.91 poi:resb=0.42", scores)
	}
}

func TestQdrantSearchDownGracefulError(t *testing.T) {
	t.Setenv("QDRANT_URL", "http://127.0.0.1:1") // nothing listens here
	origEmbed := llmclient.Embed
	llmclient.Embed = func(text string) ([]float32, error) { return []float32{0.1}, nil }
	defer func() { llmclient.Embed = origEmbed }()

	// Search itself returns an error on an unreachable Qdrant — httpserver is
	// responsible for catching this and continuing lexical-only.
	if _, err := Search("mon an", 10); err == nil {
		t.Errorf("Search against unreachable Qdrant returned nil error, want error")
	}
}
