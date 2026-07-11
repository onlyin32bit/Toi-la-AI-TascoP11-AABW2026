// Package assistant implements the RAG Q&A endpoint (§5.7): grounded
// answers with citations, and an anti-hallucination guard that reuses
// internal/retrieve's NamedEntities/DetectDish verbatim so /v1/recommend and
// /v1/assistant share one honesty mechanism.
package assistant

import (
	"fmt"
	"strings"

	"tascop11/engine/internal/kb"
	"tascop11/engine/internal/llmclient"
	"tascop11/engine/internal/retrieve"
)

type Source struct {
	Field  string `json:"field"`
	Source string `json:"source"`
}

type Response struct {
	Answer  string   `json:"answer"`
	Sources []Source `json:"sources"`
	POIID   string   `json:"poi_id,omitempty"`
}

// NotFound is the exact §5.7 not_found shape — distinct from model.NotFound
// (recommend/recall), never fabricated.
type NotFound struct {
	Answer  string `json:"answer"` // always "not_found"
	Message string `json:"message"`
}

const systemPrompt = `Bạn là trợ lý ẩm thực của Tasco Maps. CHỈ trả lời dựa trên THÔNG TIN QUÁN được cung cấp bên dưới. Không suy diễn, không bịa số liệu, món ăn, hay đánh giá không có trong thông tin đó. Nếu thông tin không đủ để trả lời, hãy nói rõ là không có dữ liệu về điều đó. Trả lời ngắn gọn bằng tiếng Việt có dấu.`

// Ask answers a natural-language question, grounded in the KB. Returns
// (Response, nil, nil) on success, (nil, *NotFound, nil) for the honest
// empty-answer path (never an LLM call), or (nil, nil, err) on LLM failure.
func Ask(k *kb.KB, q string) (*Response, *NotFound, error) {
	found, missing := retrieve.NamedEntities(k, q)
	if len(missing) > 0 {
		return nil, &NotFound{
			Answer:  "not_found",
			Message: "Không tìm thấy “" + missing[0] + "” trong dữ liệu",
		}, nil
	}

	target := resolveTarget(k, q, found)
	if target == nil {
		return nil, &NotFound{
			Answer:  "not_found",
			Message: "Không xác định được quán bạn muốn hỏi. Hãy nêu rõ tên quán hoặc món ăn.",
		}, nil
	}

	raw, err := llmclient.ChatText([]llmclient.ChatMessage{
		llmclient.TextMessage("system", systemPrompt),
		llmclient.TextMessage("user", buildPrompt(target, q)),
	})
	if err != nil {
		return nil, nil, err
	}

	return &Response{
		Answer:  strings.TrimSpace(raw),
		Sources: buildSources(target),
		POIID:   target.ID,
	}, nil, nil
}

// resolveTarget picks the POI the question is about: a directly named
// restaurant first, else the restaurant serving a named dish.
func resolveTarget(k *kb.KB, q string, found []*kb.POI) *kb.POI {
	if len(found) > 0 {
		return found[0]
	}
	for _, dish := range retrieve.DetectDish(k, q) {
		for _, p := range k.POIs {
			if _, ok := p.DishSet()[kb.Norm(dish)]; ok {
				return p
			}
		}
	}
	return nil
}

// buildPrompt renders a deterministic Vietnamese context block from the
// POI's own data, then appends the user's question.
func buildPrompt(p *kb.POI, q string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "THÔNG TIN QUÁN:\n")
	fmt.Fprintf(&b, "- Tên: %s (%s, %s)\n", p.Name, p.CuisineType, p.City)
	if p.AISummary != nil && *p.AISummary != "" {
		fmt.Fprintf(&b, "- Tóm tắt: %s\n", *p.AISummary)
	}
	if len(p.Strengths) > 0 {
		fmt.Fprintf(&b, "- Điểm mạnh: %s\n", strings.Join(p.Strengths, ", "))
	}
	if len(p.Weaknesses) > 0 {
		fmt.Fprintf(&b, "- Điểm yếu: %s\n", strings.Join(p.Weaknesses, ", "))
	}
	if len(p.Dishes) > 0 {
		b.WriteString("- Menu:\n")
		for _, d := range p.Dishes {
			fmt.Fprintf(&b, "  + %s: %s đ\n", d.Name, formatVND(d.PriceVND))
		}
	}
	if len(p.Reviews) > 0 {
		b.WriteString("- Đánh giá khách hàng:\n")
		for _, rv := range p.Reviews {
			fmt.Fprintf(&b, "  + (%s) %s\n", rv.Sentiment, rv.Text)
		}
	}
	fmt.Fprintf(&b, "\nCÂU HỎI: %s", q)
	return b.String()
}

// buildSources only cites fields actually present on the POI.
func buildSources(p *kb.POI) []Source {
	var sources []Source
	if len(p.Dishes) > 0 {
		sources = append(sources, Source{Field: "menu", Source: "tasco_csv"})
	}
	if len(p.Reviews) > 0 {
		sources = append(sources, Source{Field: "reviews", Source: "tasco_csv"})
	}
	if p.AISummary != nil && *p.AISummary != "" {
		sources = append(sources, Source{Field: "ai_summary", Source: "tasco_csv"})
	}
	if len(sources) == 0 {
		sources = append(sources, Source{Field: "profile", Source: "tasco_csv"})
	}
	return sources
}

func formatVND(v int) string {
	s := fmt.Sprintf("%d", v)
	n := len(s)
	if n <= 3 {
		return s
	}
	var b strings.Builder
	pre := n % 3
	if pre > 0 {
		b.WriteString(s[:pre])
	}
	for i := pre; i < n; i += 3 {
		if b.Len() > 0 {
			b.WriteString(".")
		}
		b.WriteString(s[i : i+3])
	}
	return b.String()
}
