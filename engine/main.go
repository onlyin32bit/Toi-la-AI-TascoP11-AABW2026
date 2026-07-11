package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

// Package-level state (single process, loaded once at start).
var (
	kb      *KB
	contrib *ContribStore
	hcmLoc  *time.Location
)

type ctxKey string

const reqIDKey ctxKey = "reqid"

func main() {
	port := envOr("PORT", "8000")
	kbDir := envOr("KB_DIR", "build")
	uiDist := os.Getenv("UI_DIST")

	var err error
	hcmLoc, err = time.LoadLocation("Asia/Ho_Chi_Minh")
	if err != nil {
		hcmLoc = time.FixedZone("ICT", 7*3600)
	}

	kb, err = LoadKB(kbDir, true)
	if err != nil {
		log.Fatalf("load kb: %v", err)
	}
	contrib = NewContribStore(kbDir, kb)
	log.Printf("loaded %d POIs (%d benchmark, %d ugc) from %s", len(kb.POIs), countSource("tasco_csv"), countSource("user_contributed"), kbDir)

	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/v1/recommend", handleRecommend)
	mux.HandleFunc("/v1/poi", handlePOI)
	mux.HandleFunc("/v1/compare", handleCompare)
	mux.HandleFunc("/v1/contribute", methodPost(contrib.HandleContribute))
	mux.HandleFunc("/v1/contribute/menu", methodPost(contrib.HandleContributeMenu))
	mux.HandleFunc("/v1/assistant", handleNotImplemented)
	mux.HandleFunc("/v1/dishes/recognize", handleNotImplemented)

	// Static UI at "/" if provided; otherwise a tiny root banner.
	if uiDist != "" {
		mux.Handle("/", http.FileServer(http.Dir(uiDist)))
	} else {
		mux.HandleFunc("/", handleRoot)
	}

	handler := recoverMiddleware(corsMiddleware(requestIDMiddleware(mux)))
	log.Printf("listening on :%s", port)
	if err := http.ListenAndServe(":"+port, handler); err != nil {
		log.Fatal(err)
	}
}

// --- Handlers ---

func handleRoot(w http.ResponseWriter, r *http.Request) {
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

func handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, r, http.StatusOK, map[string]any{
		"status": "ok",
		"pois":   countSource("tasco_csv"),
		"ugc":    countSource("user_contributed"),
	})
}

func handleRecommend(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	query := q.Get("q")
	eval := isTruthy(q.Get("eval"))

	u := UserCtx{TimeMin: -1}
	if lat, ok := parseFloat(q.Get("lat")); ok {
		u.Lat = &lat
	}
	if lon, ok := parseFloat(q.Get("lon")); ok {
		u.Lon = &lon
	}
	u.Segment = q.Get("segment")
	u.Diet = q.Get("diet")
	u.Price = q.Get("price")

	limit := 12
	if l, err := strconv.Atoi(q.Get("limit")); err == nil && l > 0 {
		limit = l
	}

	f := ParseQuery(query)
	f.Dish = DetectDish(kb, query)

	// Time handling: explicit time param becomes a HARD open constraint;
	// otherwise use "now" (Asia/Ho_Chi_Minh) only for reasoning text.
	if t := q.Get("time"); t != "" {
		if mins, ok := parseHHMM(t); ok {
			u.TimeMin = mins
			if f.OpenAfter < 0 {
				f.OpenAfter = mins
			}
		}
	} else {
		now := time.Now().In(hcmLoc)
		u.TimeMin = now.Hour()*60 + now.Minute()
	}

	// Anti-hallucination: a named restaurant absent from the KB => honest not_found.
	if _, missing := NamedEntities(kb, query); len(missing) > 0 {
		writeJSON(w, r, http.StatusOK, NotFound{
			Status:      "not_found",
			Reason:      "Không tìm thấy “" + missing[0] + "” trong dữ liệu",
			QueryEntity: missing[0],
			Suggestions: []string{"Kiểm tra lại tên quán", "Thử tìm theo món ăn hoặc khu vực"},
		})
		return
	}

	// Candidate pool: eval mode excludes UGC so the 15 benchmark answers are pure.
	pool := kb.POIs
	if eval {
		pool = benchmarkPool()
	}

	survivors, nf := recallPool(pool, f)
	if nf != nil {
		writeJSON(w, r, http.StatusOK, nf)
		return
	}

	results := Rerank(survivors, f, u, limit)
	writeJSON(w, r, http.StatusOK, RecommendResponse{
		Results:   results,
		Meta:      RecommendMeta{Query: query, Filters: f, Count: len(results)},
		RequestID: reqID(r),
	})
}

func handlePOI(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	p := kb.Get(id)
	if p == nil {
		writeError(w, r, http.StatusNotFound, "not_found", "Không tìm thấy quán với id đã cho", map[string]string{"id": id})
		return
	}
	writeJSON(w, r, http.StatusOK, p)
}

func handleCompare(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	raw := q.Get("ids")
	if raw == "" {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "Thiếu tham số ids", nil)
		return
	}
	var ids []string
	for _, part := range strings.Split(raw, ",") {
		if s := strings.TrimSpace(part); s != "" {
			ids = append(ids, s)
		}
	}
	u := UserCtx{TimeMin: -1}
	if lat, ok := parseFloat(q.Get("lat")); ok {
		u.Lat = &lat
	}
	if lon, ok := parseFloat(q.Get("lon")); ok {
		u.Lon = &lon
	}
	resp := Compare(kb, ids, u)
	resp.RequestID = reqID(r)
	writeJSON(w, r, http.StatusOK, resp)
}

func handleNotImplemented(w http.ResponseWriter, r *http.Request) {
	writeError(w, r, http.StatusNotImplemented, "not_implemented", "DEV3 chưa nối", nil)
}

// --- Middleware ---

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

// --- Helpers ---

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
	writeJSON(w, r, status, ErrorResponse{
		Error:     ErrorDetail{Code: code, Message: msg, Details: details},
		RequestID: reqID(r),
	})
}

func reqID(r *http.Request) string {
	if v, ok := r.Context().Value(reqIDKey).(string); ok {
		return v
	}
	return ""
}

func benchmarkPool() []*POI {
	out := make([]*POI, 0, len(kb.POIs))
	for _, p := range kb.POIs {
		if p.Source == "tasco_csv" {
			out = append(out, p)
		}
	}
	return out
}

func countSource(src string) int {
	n := 0
	for _, p := range kb.POIs {
		if p.Source == src {
			n++
		}
	}
	return n
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
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
