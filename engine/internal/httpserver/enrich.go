// Handler for /v1/enrich: proxies a POI hint to internal/enrich (which calls
// Apify Google Places) and returns a UI-shaped EnrichmentResult. When
// APIFY_TOKEN is unset, s.enrich is nil and the route degrades to a clear
// 503 feature_disabled instead of panicking — mirrors the DB-optional path.
package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"

	"tascop11/engine/internal/enrich"
)

func (s *Server) handleEnrich(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, r, http.StatusMethodNotAllowed, "invalid_request", "Chỉ hỗ trợ POST", nil)
		return
	}
	if s.enrich == nil {
		writeError(w, r, http.StatusServiceUnavailable, "service_unavailable",
			"APIFY_TOKEN chưa được cấu hình — enrich không khả dụng", nil)
		return
	}

	var req enrich.Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "Body JSON không hợp lệ",
			map[string]string{"parse_error": err.Error()})
		return
	}
	if req.Name == "" {
		writeError(w, r, http.StatusBadRequest, "invalid_request",
			"Trường 'name' là bắt buộc", map[string]string{"field": "name"})
		return
	}

	result, err := s.enrich.Enrich(r.Context(), req)
	if err != nil {
		switch {
		case errors.Is(err, enrich.ErrNoMatch):
			writeError(w, r, http.StatusNotFound, "not_found",
				"Không tìm thấy quán khớp trên Google Places",
				map[string]string{"query": req.Name})
		case errors.Is(err, enrich.ErrNoName):
			writeError(w, r, http.StatusBadRequest, "invalid_request",
				"Trường 'name' là bắt buộc", nil)
		default:
			writeError(w, r, http.StatusBadGateway, "upstream_error",
				"Apify upstream lỗi: "+err.Error(), nil)
		}
		return
	}
	writeJSON(w, r, http.StatusOK, result)
}
