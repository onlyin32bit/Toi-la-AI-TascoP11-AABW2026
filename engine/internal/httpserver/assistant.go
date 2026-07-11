package httpserver

import (
	"net/http"
	"strings"

	"tascop11/engine/internal/assistant"
)

func (s *Server) handleAssistant(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "Thiếu tham số q", nil)
		return
	}

	resp, notFound, err := assistant.Ask(s.kb, q)
	if err != nil {
		writeError(w, r, http.StatusServiceUnavailable, "llm_unavailable", "Trợ lý AI tạm thời không khả dụng", err.Error())
		return
	}
	if notFound != nil {
		writeJSON(w, r, http.StatusOK, notFound)
		return
	}
	writeJSON(w, r, http.StatusOK, resp)
}
