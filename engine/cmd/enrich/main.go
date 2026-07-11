// Command enrich fills ai_summary/sentiment/cuisine_classification/
// dining_occasions into build/kb.json (§5.6), replacing the Python
// summarize.py step with a Go-only offline batch. Run once before starting
// the server: `go run ./cmd/enrich`. Idempotent — reruns skip POIs already
// enriched unless -force. Cached to disk (via internal/llmclient), so
// reruns after the first are free and the server never needs network access
// for this data.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"tascop11/engine/internal/config"
	"tascop11/engine/internal/llmclient"
)

func main() {
	kbDir := flag.String("kb-dir", "build", "directory containing kb.json")
	batchSize := flag.Int("batch", 5, "POIs per LLM call")
	force := flag.Bool("force", false, "re-enrich POIs that already have ai_summary")
	flag.Parse()

	os.Setenv("KB_DIR", *kbDir) // internal/llmclient caches under $KB_DIR/cache/llm
	config.LoadDotEnv(".env")
	config.LoadDotEnv("../.env")
	config.LoadDotEnv("../../.env")

	kbPath := filepath.Join(*kbDir, "kb.json")
	raw, err := os.ReadFile(kbPath)
	if err != nil {
		log.Fatalf("read %s: %v (run preprocess/build_kb.py first)", kbPath, err)
	}
	var pois []map[string]any
	if err := json.Unmarshal(raw, &pois); err != nil {
		log.Fatalf("parse %s: %v", kbPath, err)
	}

	var todo []map[string]any
	for _, p := range pois {
		if *force || !hasSummary(p) {
			todo = append(todo, p)
		}
	}
	log.Printf("%d/%d POIs need enrichment (batch=%d)", len(todo), len(pois), *batchSize)

	for i := 0; i < len(todo); i += *batchSize {
		end := i + *batchSize
		if end > len(todo) {
			end = len(todo)
		}
		batch := todo[i:end]
		results, err := enrichBatch(batch)
		if err != nil {
			log.Fatalf("enrich batch %d-%d: %v", i, end, err)
		}
		for _, p := range batch {
			id, _ := p["id"].(string)
			res, ok := results[id]
			if !ok {
				log.Printf("warning: no enrichment result for %s", id)
				continue
			}
			p["ai_summary"] = res.AISummary
			p["sentiment"] = res.Sentiment
			p["cuisine_classification"] = res.CuisineClassification
			p["dining_occasions"] = res.DiningOccasions
		}
		log.Printf("enriched %d/%d", end, len(todo))
	}

	out, err := json.MarshalIndent(pois, "", "  ")
	if err != nil {
		log.Fatalf("marshal: %v", err)
	}
	if err := os.WriteFile(kbPath, out, 0o644); err != nil {
		log.Fatalf("write %s: %v", kbPath, err)
	}
	log.Printf("wrote %s", kbPath)
}

func hasSummary(p map[string]any) bool {
	s, ok := p["ai_summary"].(string)
	return ok && s != ""
}

type enrichResult struct {
	AISummary             string         `json:"ai_summary"`
	Sentiment             map[string]any `json:"sentiment"`
	CuisineClassification string         `json:"cuisine_classification"`
	DiningOccasions       []string       `json:"dining_occasions"`
}

// enrichBatch asks the LLM for one JSON object keyed by POI id, covering
// every POI in the batch, to keep call count low (30 POIs / 5 per call = 6
// calls) while keeping each individual response small enough to parse
// reliably.
func enrichBatch(batch []map[string]any) (map[string]enrichResult, error) {
	raw, err := llmclient.ChatText([]llmclient.ChatMessage{
		llmclient.TextMessage("system", enrichSystemPrompt),
		llmclient.TextMessage("user", buildEnrichPrompt(batch)),
	})
	if err != nil {
		return nil, err
	}
	var out map[string]enrichResult
	if err := json.Unmarshal([]byte(llmclient.ExtractJSON(raw)), &out); err != nil {
		return nil, fmt.Errorf("parse enrich response: %w\nraw: %s", err, raw)
	}
	return out, nil
}

const enrichSystemPrompt = `Bạn là biên tập viên ẩm thực cho Tasco Maps. Với mỗi quán trong DANH SÁCH, dựa CHỈ vào thông tin cung cấp (review, điểm mạnh/yếu, món ăn), sinh:
- ai_summary: 2-3 câu tiếng Việt tóm tắt quán, không bịa số liệu không có trong dữ liệu.
- sentiment: {"pos":0.0,"neu":0.0,"neg":0.0,"aspects":["..."]} tổng hợp từ review (3 số cộng lại xấp xỉ 1.0).
- cuisine_classification: ví dụ "Việt Nam - Miền Bắc" (suy từ city/cuisine_type).
- dining_occasions: tập con của ["Family","Business","Romantic","Casual","FastFood"].
Trả lời DUY NHẤT một JSON object, key là "id" của từng quán, value là {"ai_summary":...,"sentiment":...,"cuisine_classification":...,"dining_occasions":[...]}. Không thêm giải thích.`

func buildEnrichPrompt(batch []map[string]any) string {
	var b strings.Builder
	b.WriteString("DANH SÁCH:\n")
	for _, p := range batch {
		enc, _ := json.Marshal(p)
		fmt.Fprintf(&b, "- %s\n", string(enc))
	}
	return b.String()
}
