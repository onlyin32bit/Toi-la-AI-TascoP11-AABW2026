package httpserver

import (
	"encoding/json"
	"net/http"
)

type saveContextReq struct {
	Name    string          `json:"name"`
	Stated  json.RawMessage `json:"stated"`
	CTX     json.RawMessage `json:"ctx"`
	Learned json.RawMessage `json:"learned"`
}

// handleContexts dispatches GET (list) / POST (save) — both require auth.
// "Saved injected contexts" (SYSTEM_FLOW.md §2): a named stated/ctx/learned
// profile a user can save once and later select via /v1/recommend's
// context_id param to inject as CTX (feeds §5.3 S_behavior).
func (s *Server) handleContexts(w http.ResponseWriter, r *http.Request) {
	if s.dbUnavailable(w, r) {
		return
	}
	user, err := s.requireUser(w, r)
	if err != nil {
		return
	}

	switch r.Method {
	case http.MethodGet:
		contexts, err := s.db.ListContexts(r.Context(), user.ID)
		if err != nil {
			writeError(w, r, http.StatusInternalServerError, "internal", "Không tải được contexts", err.Error())
			return
		}
		writeJSON(w, r, http.StatusOK, map[string]any{"contexts": contexts})

	case http.MethodPost:
		var req saveContextReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" {
			writeError(w, r, http.StatusBadRequest, "invalid_request", "Thiếu name", nil)
			return
		}
		sc, err := s.db.SaveContext(r.Context(), user.ID, req.Name, req.Stated, req.CTX, req.Learned)
		if err != nil {
			writeError(w, r, http.StatusInternalServerError, "internal", "Không lưu được context", err.Error())
			return
		}
		writeJSON(w, r, http.StatusCreated, sc)

	default:
		writeError(w, r, http.StatusMethodNotAllowed, "invalid_request", "Chỉ hỗ trợ GET/POST", nil)
	}
}
