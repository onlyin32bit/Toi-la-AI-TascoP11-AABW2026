package httpserver

import (
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"tascop11/engine/internal/compare"
	"tascop11/engine/internal/model"
	"tascop11/engine/internal/rerank"
	"tascop11/engine/internal/retrieve"
	"tascop11/engine/internal/vectordb"
	"tascop11/engine/internal/vnlang"
)

func (s *Server) handleRecommend(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	query := vnlang.NormalizeSlang(q.Get("q")) // §1.5 L2
	eval := isTruthy(q.Get("eval"))

	u := model.UserCtx{TimeMin: -1}
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
	if isTruthy(os.Getenv("MAP_ALL_POIS")) {
		limit = len(s.kb.POIs)
	}
	if l, err := strconv.Atoi(q.Get("limit")); err == nil && l > 0 {
		limit = l
	}

	f := retrieve.ParseQuery(query)
	f.Dish = retrieve.DetectDish(s.kb, query)

	// §5.3 CTX inputs — optional, absent by default (renormalized away).
	if m := q.Get("mode"); m == "repeat" || m == "explore" {
		f.Mode = m
	}
	if dm, ok := parseFloat(q.Get("detour_min")); ok {
		f.DetourMin = &dm
	}
	if occ, ok := parseFloat(q.Get("occupancy")); ok {
		f.Occupancy = &occ
	}

	// Optional Qdrant semantic layer (internal/vectordb). Inert unless
	// QDRANT_URL is set; any failure (down, unconfigured key, timeout) is
	// logged and ignored — recommend must never fail because of it.
	if vectordb.Enabled() && query != "" {
		if scores, err := vectordb.Search(query, 20); err != nil {
			log.Printf("vector search skipped: %v", err)
		} else {
			f.VectorScores = scores
		}
	}

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
		now := time.Now().In(s.hcmLoc)
		u.TimeMin = now.Hour()*60 + now.Minute()
	}

	// §1.5 L4: for vague, filterless free-text queries, nudge recall toward
	// Vietnamese meal-time dishes (sáng phở, tối nhậu...).
	if query != "" && len(f.Dish) == 0 && len(f.Tokens) <= 2 {
		f.Tokens = append(f.Tokens, vnlang.MealTimeTokens(u.TimeMin)...)
	}

	// Optional: an authenticated user selecting a saved context (Postgres)
	// injects §5.3 S_behavior. Absent (no DB, no auth, no context_id, or the
	// context has no learned data) => factor renormalizes away, unchanged.
	s.injectBehavior(r, q.Get("context_id"), &u)

	// Anti-hallucination: a named restaurant absent from the KB => honest not_found.
	if _, missing := retrieve.NamedEntities(s.kb, query); len(missing) > 0 {
		writeJSON(w, r, http.StatusOK, model.NotFound{
			Status:      "not_found",
			Reason:      "Không tìm thấy “" + missing[0] + "” trong dữ liệu",
			QueryEntity: missing[0],
			Suggestions: []string{"Kiểm tra lại tên quán", "Thử tìm theo món ăn hoặc khu vực"},
		})
		return
	}

	// Candidate pool: eval mode excludes UGC so the 15 benchmark answers are pure.
	pool := s.kb.POIs
	if eval {
		pool = s.benchmarkPool()
	}

	survivors, nf := retrieve.RecallPool(pool, f)
	if nf != nil {
		writeJSON(w, r, http.StatusOK, nf)
		return
	}

	results := rerank.Rerank(survivors, f, u, limit)
	writeJSON(w, r, http.StatusOK, model.RecommendResponse{
		Results:   results,
		Meta:      model.RecommendMeta{Query: query, Filters: f, Count: len(results)},
		RequestID: reqID(r),
	})
}

// injectBehavior loads the caller's saved context (if authenticated, DB
// enabled, and context_id given) and folds its learned data into u.Behavior.
func (s *Server) injectBehavior(r *http.Request, contextID string, u *model.UserCtx) {
	if s.db == nil || contextID == "" {
		return
	}
	user, err := s.currentUser(r)
	if err != nil || user == nil {
		return
	}
	sc, err := s.db.GetContext(r.Context(), user.ID, contextID)
	if err != nil || sc == nil {
		return
	}
	repeatIDs, affinity := sc.BehaviorSignal()
	if len(repeatIDs) > 0 || len(affinity) > 0 {
		u.Behavior = &model.BehaviorSignal{RepeatPOIIDs: repeatIDs, CuisineAffinity: affinity}
	}
}

func (s *Server) handlePOI(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	p := s.kb.Get(id)
	if p == nil {
		writeError(w, r, http.StatusNotFound, "not_found", "Không tìm thấy quán với id đã cho", map[string]string{"id": id})
		return
	}
	writeJSON(w, r, http.StatusOK, p)
}

func (s *Server) handleCompare(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	raw := q.Get("ids")
	if raw == "" {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "Thiếu tham số ids", nil)
		return
	}
	var ids []string
	for _, part := range strings.Split(raw, ",") {
		if part = strings.TrimSpace(part); part != "" {
			ids = append(ids, part)
		}
	}
	u := model.UserCtx{TimeMin: -1}
	if lat, ok := parseFloat(q.Get("lat")); ok {
		u.Lat = &lat
	}
	if lon, ok := parseFloat(q.Get("lon")); ok {
		u.Lon = &lon
	}
	resp := compare.Compare(s.kb, ids, u)
	resp.RequestID = reqID(r)
	writeJSON(w, r, http.StatusOK, resp)
}
