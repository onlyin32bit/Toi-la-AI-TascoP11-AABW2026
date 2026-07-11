// Command embed populates a Qdrant collection with one vector per POI in
// build/kb.json, powering the optional semantic-search layer in
// internal/vectordb. Run once after build_kb.py (and after Qdrant is up —
// see scripts/setup_qdrant.sh): `go run ./cmd/embed`. Idempotent — points
// are upserted by a deterministic id derived from the POI id, and
// embeddings are disk-cached (internal/llmclient), so reruns are cheap.
package main

import (
	"encoding/json"
	"flag"
	"hash/fnv"
	"log"
	"os"
	"path/filepath"
	"strings"

	"tascop11/engine/internal/config"
	"tascop11/engine/internal/llmclient"
	"tascop11/engine/internal/vectordb"
)

func main() {
	kbDir := flag.String("kb-dir", "build", "directory containing kb.json (also the embed-cache dir)")
	kbFile := flag.String("kb-file", "", "override the KB JSON path (default: <kb-dir>/kb.json) — e.g. a compiled enrichment KB like data/thuduc/thuduc_kb.json")
	batchSize := flag.Int("batch", 16, "points per Qdrant upsert call")
	qdrantURL := flag.String("qdrant-url", "", "Qdrant base URL (default: $QDRANT_URL, then http://localhost:6333)")
	collection := flag.String("collection", "", "Qdrant collection name (default: $QDRANT_COLLECTION, then tascop11_pois)")
	flag.Parse()

	os.Setenv("KB_DIR", *kbDir) // internal/llmclient caches under $KB_DIR/cache/embed
	config.LoadDotEnv(".env")
	config.LoadDotEnv("../.env")
	config.LoadDotEnv("../../.env")

	if *qdrantURL != "" {
		os.Setenv("QDRANT_URL", *qdrantURL)
	} else if os.Getenv("QDRANT_URL") == "" {
		os.Setenv("QDRANT_URL", "http://localhost:6333")
	}
	if *collection != "" {
		os.Setenv("QDRANT_COLLECTION", *collection)
	}

	kbPath := *kbFile
	if kbPath == "" {
		kbPath = filepath.Join(*kbDir, "kb.json")
	}
	raw, err := os.ReadFile(kbPath)
	if err != nil {
		log.Fatalf("read %s: %v (run preprocess/build_kb.py first)", kbPath, err)
	}
	var pois []map[string]any
	if err := json.Unmarshal(raw, &pois); err != nil {
		log.Fatalf("parse %s: %v", kbPath, err)
	}
	log.Printf("embedding %d POIs -> %s (collection %q)", len(pois), os.Getenv("QDRANT_URL"), os.Getenv("QDRANT_COLLECTION"))

	type indexed struct {
		id   string
		text string
		vec  []float32
	}
	items := make([]indexed, 0, len(pois))
	for _, p := range pois {
		id, _ := p["id"].(string)
		if id == "" {
			continue
		}
		text := searchableText(p)
		vec, err := llmclient.Embed(text)
		if err != nil {
			log.Fatalf("embed %s: %v", id, err)
		}
		items = append(items, indexed{id: id, text: text, vec: vec})
	}
	if len(items) == 0 {
		log.Fatalf("nothing to embed")
	}

	if err := vectordb.EnsureCollection(len(items[0].vec)); err != nil {
		log.Fatalf("ensure collection: %v", err)
	}

	for i := 0; i < len(items); i += *batchSize {
		end := i + *batchSize
		if end > len(items) {
			end = len(items)
		}
		points := make([]vectordb.Point, 0, end-i)
		for _, it := range items[i:end] {
			points = append(points, vectordb.Point{
				ID:     pointID(it.id),
				Vector: it.vec,
				Payload: map[string]any{
					"poi_id": it.id,
					"text":   it.text,
				},
			})
		}
		if err := vectordb.UpsertPoints(points); err != nil {
			log.Fatalf("upsert points %d-%d: %v", i, end, err)
		}
		log.Printf("upserted %d/%d", end, len(items))
	}
	log.Printf("done — %d POIs indexed (dim=%d)", len(items), len(items[0].vec))
}

// searchableText mirrors the fields most useful for semantic matching: name,
// cuisine, location, dish names, and the AI summary/strengths when present.
func searchableText(p map[string]any) string {
	var b strings.Builder
	add := func(v any) {
		if s, ok := v.(string); ok && s != "" {
			b.WriteString(s)
			b.WriteString(". ")
		}
	}
	add(p["name"])
	add(p["cuisine_type"])
	add(p["city"])
	add(p["district"])
	add(p["ai_summary"])
	if dishes, ok := p["dishes"].([]any); ok {
		var names []string
		for _, d := range dishes {
			if dm, ok := d.(map[string]any); ok {
				if n, ok := dm["name"].(string); ok && n != "" {
					names = append(names, n)
				}
			}
		}
		if len(names) > 0 {
			b.WriteString(strings.Join(names, ", "))
			b.WriteString(". ")
		}
	}
	if strengths, ok := p["strengths"].([]any); ok {
		var s []string
		for _, v := range strengths {
			if str, ok := v.(string); ok {
				s = append(s, str)
			}
		}
		if len(s) > 0 {
			b.WriteString(strings.Join(s, ", "))
		}
	}
	return strings.TrimSpace(b.String())
}

// pointID derives a stable Qdrant-compatible unsigned integer id from the
// POI's string id, so reruns upsert the same points instead of duplicating.
func pointID(poiID string) uint64 {
	h := fnv.New64a()
	_, _ = h.Write([]byte(poiID))
	return h.Sum64()
}
