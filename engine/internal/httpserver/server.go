// Package httpserver wires every internal package into HTTP handlers +
// middleware (§8 API contract). It is the only package that knows about
// net/http status codes and JSON wire encoding for responses — every other
// package (retrieve, rerank, assistant, vision, contribute, db) returns
// plain Go values/errors and stays transport-agnostic.
package httpserver

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"tascop11/engine/internal/contribute"
	"tascop11/engine/internal/db"
	"tascop11/engine/internal/kb"
	"tascop11/engine/internal/model"
)

// Deps bundles every dependency the HTTP layer needs. DB is nil when
// Postgres isn't configured (DATABASE_URL unset) — every DB-backed handler
// degrades to a clear "feature_disabled" response in that case, never a panic.
type Deps struct {
	KB      *kb.KB
	Contrib *contribute.Store
	DB      *db.DB
	HCMLoc  *time.Location
	UIDist  string
}

type Server struct {
	kb      *kb.KB
	contrib *contribute.Store
	db      *db.DB
	hcmLoc  *time.Location
}

// New builds the full route table + middleware chain as an http.Handler.
func New(deps Deps) http.Handler {
	s := &Server{kb: deps.KB, contrib: deps.Contrib, db: deps.DB, hcmLoc: deps.HCMLoc}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.handleHealth)
	mux.HandleFunc("/v1/recommend", s.handleRecommend)
	mux.HandleFunc("/v1/poi", s.handlePOI)
	mux.HandleFunc("/v1/compare", s.handleCompare)
	mux.HandleFunc("/v1/contribute", methodPost(s.handleContribute))
	mux.HandleFunc("/v1/contribute/menu", methodPost(s.handleContributeMenu))
	mux.HandleFunc("/v1/assistant", s.handleAssistant)
	mux.HandleFunc("/v1/dishes/recognize", methodPost(s.handleDishesRecognize))
	mux.HandleFunc("/v1/auth/signup", methodPost(s.handleSignup))
	mux.HandleFunc("/v1/auth/login", methodPost(s.handleLogin))
	mux.HandleFunc("/v1/auth/logout", methodPost(s.handleLogout))
	mux.HandleFunc("/v1/me", s.handleMe)
	mux.HandleFunc("/v1/contexts", s.handleContexts)

	if deps.UIDist != "" {
		mux.Handle("/", http.FileServer(http.Dir(deps.UIDist)))
	} else {
		mux.HandleFunc("/", s.handleRoot)
	}

	return recoverMiddleware(corsMiddleware(requestIDMiddleware(mux)))
}

// --- misc handlers ---

func (s *Server) handleRoot(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		writeError(w, r, http.StatusNotFound, "not_found", "Không tìm thấy đường dẫn", nil)
		return
	}
	writeJSON(w, r, http.StatusOK, map[string]any{
		"service": "tascop11/engine",
		"docs":    "PLAN.md §8",
		"health":  "/health",
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, r, http.StatusOK, map[string]any{
		"status": "ok",
		"pois":   s.countSource("tasco_csv"),
		"ugc":    s.countSource("user_contributed"),
		"db":     s.db != nil,
	})
}

func (s *Server) benchmarkPool() []*kb.POI {
	out := make([]*kb.POI, 0, len(s.kb.POIs))
	for _, p := range s.kb.POIs {
		if p.Source == "tasco_csv" {
			out = append(out, p)
		}
	}
	return out
}

func (s *Server) countSource(src string) int {
	n := 0
	for _, p := range s.kb.POIs {
		if p.Source == src {
			n++
		}
	}
	return n
}

// --- Middleware ---

type ctxKey string

const reqIDKey ctxKey = "reqid"

func requestIDMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := randHex(8)
		w.Header().Set("X-Request-Id", id)
		w.Header().Set("X-Locale", "vi-VN")
		w.Header().Set("X-Timezone", "Asia/Ho_Chi_Minh")
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), reqIDKey, id)))
	})
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "*")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func recoverMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				log.Printf("panic: %v", rec)
				writeError(w, r, http.StatusInternalServerError, "internal", "Lỗi máy chủ", nil)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func methodPost(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeError(w, r, http.StatusMethodNotAllowed, "invalid_request", "Chỉ hỗ trợ POST", nil)
			return
		}
		h(w, r)
	}
}

// --- Response helpers ---

func writeJSON(w http.ResponseWriter, r *http.Request, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false) // keep Vietnamese diacritics readable
	if err := enc.Encode(body); err != nil {
		log.Printf("encode: %v", err)
	}
}

func writeError(w http.ResponseWriter, r *http.Request, status int, code, msg string, details any) {
	writeJSON(w, r, status, model.ErrorResponse{
		Error:     model.ErrorDetail{Code: code, Message: msg, Details: details},
		RequestID: reqID(r),
	})
}

func reqID(r *http.Request) string {
	if v, ok := r.Context().Value(reqIDKey).(string); ok {
		return v
	}
	return ""
}

func randHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return hex.EncodeToString([]byte(time.Now().Format(time.RFC3339Nano)))
	}
	return hex.EncodeToString(b)
}

func parseFloat(s string) (float64, bool) {
	if s == "" {
		return 0, false
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0, false
	}
	return v, true
}

func parseHHMM(s string) (int, bool) {
	parts := strings.Split(strings.TrimSpace(s), ":")
	if len(parts) != 2 {
		return 0, false
	}
	h, err1 := strconv.Atoi(parts[0])
	m, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil || h < 0 || h > 23 || m < 0 || m > 59 {
		return 0, false
	}
	return h*60 + m, true
}

func isTruthy(s string) bool {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}
