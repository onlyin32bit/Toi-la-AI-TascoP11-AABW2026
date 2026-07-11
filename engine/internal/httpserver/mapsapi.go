// Map-service surface compatible with
// resources/data/tasco_maps_hackathon_api_documentation.md: search,
// autocomplete, POI-by-path, reverse-geocoding, nearby-search, geocoding,
// route. This engine's domain is restaurants only (30-537 POIs, no street/
// address database, no road-network routing graph) — every handler here is
// honest about that scope rather than fabricating capability we don't have:
//   - search/autocomplete/nearby-search/POI detail: fully real, backed by
//     the same kb/retrieve/rerank pipeline as /v1/recommend.
//   - geocoding/reverse-geocoding: best-effort against our POI corpus's own
//     address/name/coordinates (not a general street geocoder) — a query for
//     an address nowhere near a known restaurant legitimately returns no
//     results, never an invented coordinate.
//   - route: an honest haversine straight-line distance/duration estimate
//     (Route.Approximate=true), never fabricated turn-by-turn directions or
//     street names — there is no routing engine behind this API.
package httpserver

import (
	"encoding/json"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"tascop11/engine/internal/kb"
	"tascop11/engine/internal/model"
	"tascop11/engine/internal/rerank"
	"tascop11/engine/internal/retrieve"
	"tascop11/engine/internal/vnlang"
)

// --- 1. GET /v1/search (+ /search, /v1/geocode-search) ---------------------

func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	query := strings.TrimSpace(q.Get("q"))
	if query == "" {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "q is required", map[string]string{"field": "q"})
		return
	}
	query = vnlang.NormalizeSlang(query)
	limit := intOr(q.Get("limit"), 10)
	lang := stringOr(q.Get("lang"), "vi")

	f := retrieve.ParseQuery(query)
	f.Dish = retrieve.DetectDish(s.kb, query)

	u := model.UserCtx{TimeMin: -1}
	var lat, lon float64
	haveLoc := false
	if v, ok := parseFloat(q.Get("lat")); ok {
		lat = v
		u.Lat = &v
	}
	if v, ok := parseFloat(q.Get("lon")); ok {
		lon = v
		u.Lon = &v
	}
	haveLoc = u.Lat != nil && u.Lon != nil

	pool := s.kb.POIs
	if radius, ok := parseFloat(q.Get("radiusMeters")); ok && haveLoc {
		pool = filterWithinRadius(pool, lat, lon, radius)
	} else if bb, ok := parseBBox(q.Get("bbox")); ok {
		pool = filterWithinBBox(pool, bb)
	}
	if cat := q.Get("category"); cat != "" {
		pool = filterByCategory(pool, cat)
	}

	survivors, _ := retrieve.RecallPool(pool, f) // doc's /v1/search has no not_found envelope — empty results is the honest "nothing matched" here
	results := rerank.Rerank(survivors, f, u, limit)

	writeJSON(w, r, http.StatusOK, model.SearchResponse{
		Query:   query,
		Results: results,
		Meta:    model.SearchMeta{Limit: limit, Lang: lang},
	})
}

// --- 2. GET /v1/autocomplete (+ /autocomplete) ------------------------------

func (s *Server) handleAutocomplete(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	query := strings.TrimSpace(q.Get("q"))
	if query == "" {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "q is required", map[string]string{"field": "q"})
		return
	}
	limit := intOr(q.Get("limit"), 5)

	var lat, lon *float64
	if v, ok := parseFloat(q.Get("lat")); ok {
		lat = &v
	}
	if v, ok := parseFloat(q.Get("lon")); ok {
		lon = &v
	}

	prefix := kb.Norm(query)
	matches := retrieve.Autocomplete(s.kb, query, limit)
	suggestions := make([]model.PlaceResult, 0, len(matches))
	for _, p := range matches {
		score := 0.8
		if strings.HasPrefix(p.NameNorm(), prefix) {
			score = 0.98
		}
		var distPtr *int
		if lat != nil && lon != nil {
			d := int(math.Round(kb.Haversine(*lat, *lon, p.Lat, p.Lon)))
			distPtr = &d
		}
		suggestions = append(suggestions, poiToPlaceResult(p, distPtr, score))
	}

	writeJSON(w, r, http.StatusOK, model.AutocompleteResponse{
		Query:       query,
		Suggestions: suggestions,
		Meta:        model.AutocompleteMeta{Limit: limit, SessionID: q.Get("sessionId")},
	})
}

// --- 3. GET /v1/poi/{id} (+ /poi/{id}) --------------------------------------

func (s *Server) handlePOIByPath(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "id is required", map[string]string{"field": "id"})
		return
	}
	p := s.kb.Get(id)
	if p == nil {
		writeError(w, r, http.StatusNotFound, "not_found", "POI not found", map[string]string{"id": id})
		return
	}
	writeJSON(w, r, http.StatusOK, model.POIDetailResponse{POI: poiToDetail(p)})
}

func poiToDetail(p *kb.POI) model.POIDetail {
	summary := ""
	if p.AISummary != nil {
		summary = *p.AISummary
	}
	return model.POIDetail{
		ID:           p.ID,
		Type:         "poi",
		Name:         p.Name,
		Label:        p.Name, // matches the doc's own /v1/poi/{id} example (label == name)
		Address:      p.Address,
		Category:     p.CuisineType,
		Coordinates:  model.Coordinates{Lat: p.Lat, Lon: p.Lon},
		Rating:       p.Rating,
		OpeningHours: p.Opening.Raw,
		AISummary:    summary,
		Source:       p.Source,
	}
}

// --- 4. GET /v1/reverse-geocoding (+ /reverse-geocoding, /v1/reverse) -------

func (s *Server) handleReverseGeocoding(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	latStr := firstNonEmptyStr(q.Get("lat"), q.Get("point.lat"))
	lonStr := firstNonEmptyStr(q.Get("lon"), q.Get("point.lon"))
	lat, latOK := parseFloat(latStr)
	lon, lonOK := parseFloat(lonStr)
	if !latOK || !lonOK {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "lat/lon (or point.lat/point.lon) are required", nil)
		return
	}
	radius := 5000.0
	if v, ok := parseFloat(q.Get("radiusMeters")); ok {
		radius = v
	}

	nearest, dist := nearestPOI(s.kb, lat, lon, radius)
	if nearest == nil {
		writeJSON(w, r, http.StatusOK, model.ReverseGeocodingResponse{Results: []model.PlaceResult{}})
		return
	}
	d := int(math.Round(dist))
	writeJSON(w, r, http.StatusOK, model.ReverseGeocodingResponse{
		Results: []model.PlaceResult{poiToPlaceResult(nearest, &d, 1.0)},
	})
}

// --- 5. GET /v1/nearby-search (+ /nearby-search) ----------------------------

func (s *Server) handleNearbySearch(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	lat, latOK := parseFloat(q.Get("lat"))
	lon, lonOK := parseFloat(q.Get("lon"))
	if !latOK || !lonOK {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "lat and lon are required", nil)
		return
	}
	radius := 1000.0
	if v, ok := parseFloat(q.Get("radiusMeters")); ok {
		radius = v
	}
	limit := intOr(q.Get("limit"), 10)

	pool := filterWithinRadius(s.kb.POIs, lat, lon, radius)
	if cat := q.Get("category"); cat != "" {
		pool = filterByCategory(pool, cat)
	}

	f := model.FilterSpec{OpenAfter: -1}
	if isTruthy(q.Get("openNow")) {
		now := time.Now().In(s.hcmLoc)
		f.OpenAfter = now.Hour()*60 + now.Minute()
	}
	u := model.UserCtx{Lat: &lat, Lon: &lon, TimeMin: -1}

	survivors, _ := retrieve.RecallPool(pool, f)
	results := rerank.Rerank(survivors, f, u, limit)

	writeJSON(w, r, http.StatusOK, model.NearbySearchResponse{
		Center:  model.Coordinates{Lat: lat, Lon: lon},
		Results: results,
		Meta:    model.NearbySearchMeta{RadiusMeters: radius, Limit: limit},
	})
}

// --- 6. GET /v1/geocoding (+ /geocoding) ------------------------------------

func (s *Server) handleGeocoding(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	address := strings.TrimSpace(q.Get("address"))
	if address == "" {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "address is required", map[string]string{"field": "address"})
		return
	}
	limit := intOr(q.Get("limit"), 5)
	city := q.Get("city")

	// Token-overlap match, not a substring check: stored addresses are
	// comma-punctuated ("2 Trần Phú, Hoàn Kiếm, Hà Nội") while a realistic
	// query is space-separated ("Tran Phu Hoan Kiem") — an exact substring
	// match would fail on the punctuation alone despite every word matching.
	needleTokens := kb.Tokenize(address)
	type scoredPOI struct {
		p    *kb.POI
		hits int
	}
	var candidates []scoredPOI
	for _, p := range s.kb.POIs {
		if city != "" && !strings.Contains(kb.Norm(p.City), kb.Norm(city)) {
			continue
		}
		addrTokens := kb.Tokenize(p.Address)
		hits := countMatchingTokens(needleTokens, addrTokens)
		if hits == 0 {
			continue
		}
		candidates = append(candidates, scoredPOI{p, hits})
	}
	sort.SliceStable(candidates, func(i, j int) bool { return candidates[i].hits > candidates[j].hits })
	if len(candidates) > limit {
		candidates = candidates[:limit]
	}

	results := make([]model.PlaceResult, 0, len(candidates))
	for _, c := range candidates {
		score := round1(float64(c.hits) / float64(len(needleTokens)))
		results = append(results, poiToPlaceResult(c.p, nil, score))
	}
	writeJSON(w, r, http.StatusOK, model.GeocodingResponse{Query: address, Results: results})
}

func countMatchingTokens(needle, haystack []string) int {
	set := make(map[string]struct{}, len(haystack))
	for _, t := range haystack {
		set[t] = struct{}{}
	}
	n := 0
	for _, t := range needle {
		if _, ok := set[t]; ok {
			n++
		}
	}
	return n
}

// --- 7. POST /v1/route (+ /route) -------------------------------------------

// handleRoute returns an honest straight-line (haversine) distance/duration
// estimate between the given locations. There is no road-network routing
// engine (no Valhalla/OSRM graph) behind this API, so geometry is a direct
// LineString between the input points and the single maneuver says exactly
// that — never a fabricated turn-by-turn route. Route.Approximate=true flags
// this explicitly for any caller that cares (additive field, doesn't break
// the doc's base shape).
func (s *Server) handleRoute(w http.ResponseWriter, r *http.Request) {
	var req model.RouteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Locations) < 2 {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "locations must include at least origin and destination", nil)
		return
	}
	mode := stringOr(req.Mode, "auto")

	coords := make([][2]float64, 0, len(req.Locations))
	var totalDist float64
	for i, loc := range req.Locations {
		coords = append(coords, [2]float64{loc.Lon, loc.Lat})
		if i > 0 {
			prev := req.Locations[i-1]
			totalDist += kb.Haversine(prev.Lat, prev.Lon, loc.Lat, loc.Lon)
		}
	}
	duration := totalDist / speedForMode(mode)

	route := model.Route{
		RouteID:     "route:approx-0",
		SourceIndex: 0,
		Summary:     model.RouteSummary{DistanceMeters: round1(totalDist), DurationSeconds: round1(duration)},
		Geometry:    model.RouteGeometry{Type: "LineString", Coordinates: coords},
		Maneuvers: []model.Maneuver{{
			Instruction:     "Di chuyển thẳng tới điểm đến (ước lượng đường chim bay, không theo mạng lưới đường).",
			DistanceMeters:  round1(totalDist),
			DurationSeconds: round1(duration),
			BeginShapeIndex: 0,
			EndShapeIndex:   len(coords) - 1,
			StreetNames:     []string{},
		}},
		Approximate: true,
	}
	writeJSON(w, r, http.StatusOK, model.RouteResponse{
		Routes: []model.Route{route},
		Meta:   model.RouteMeta{Mode: mode, Alternates: req.Alternates},
	})
}

func speedForMode(mode string) float64 {
	switch mode {
	case "pedestrian":
		return 1.25 // ~4.5 km/h
	case "bicycle":
		return 4.2 // ~15 km/h
	default:
		return 9.7 // ~35 km/h, urban VN traffic estimate ("auto")
	}
}

// --- shared helpers ----------------------------------------------------------

func poiToPlaceResult(p *kb.POI, distMeters *int, score float64) model.PlaceResult {
	tags := append([]string{}, p.Segments...)
	tags = append(tags, p.Amenities...)
	return model.PlaceResult{
		ID:             p.ID,
		Type:           "poi",
		Name:           p.Name,
		Label:          p.Category,
		Address:        p.Address,
		Category:       p.CuisineType,
		Coordinates:    model.Coordinates{Lat: p.Lat, Lon: p.Lon},
		DistanceMeters: distMeters,
		Score:          score,
		Source:         p.Source,
		Tags:           tags,
	}
}

func nearestPOI(k *kb.KB, lat, lon, maxRadius float64) (*kb.POI, float64) {
	var best *kb.POI
	bestDist := maxRadius
	for _, p := range k.POIs {
		d := kb.Haversine(lat, lon, p.Lat, p.Lon)
		if d <= bestDist {
			best, bestDist = p, d
		}
	}
	return best, bestDist
}

func filterWithinRadius(pool []*kb.POI, lat, lon, radiusMeters float64) []*kb.POI {
	out := make([]*kb.POI, 0, len(pool))
	for _, p := range pool {
		if kb.Haversine(lat, lon, p.Lat, p.Lon) <= radiusMeters {
			out = append(out, p)
		}
	}
	return out
}

type bbox struct{ minLon, minLat, maxLon, maxLat float64 }

func parseBBox(s string) (bbox, bool) {
	parts := strings.Split(s, ",")
	if len(parts) != 4 {
		return bbox{}, false
	}
	vals := make([]float64, 4)
	for i, p := range parts {
		v, err := strconv.ParseFloat(strings.TrimSpace(p), 64)
		if err != nil {
			return bbox{}, false
		}
		vals[i] = v
	}
	return bbox{minLon: vals[0], minLat: vals[1], maxLon: vals[2], maxLat: vals[3]}, true
}

func filterWithinBBox(pool []*kb.POI, bb bbox) []*kb.POI {
	out := make([]*kb.POI, 0, len(pool))
	for _, p := range pool {
		if p.Lon >= bb.minLon && p.Lon <= bb.maxLon && p.Lat >= bb.minLat && p.Lat <= bb.maxLat {
			out = append(out, p)
		}
	}
	return out
}

// filterByCategory is a best-effort match — this engine's domain is
// restaurants only, so "category" is matched against cuisine_type/category/
// segments rather than a general POI-category taxonomy (office, hotel, ...).
func filterByCategory(pool []*kb.POI, category string) []*kb.POI {
	needle := kb.Norm(category)
	out := make([]*kb.POI, 0, len(pool))
	for _, p := range pool {
		if strings.Contains(kb.Norm(p.CuisineType), needle) || strings.Contains(kb.Norm(p.Category), needle) || kb.ContainsStr(p.Segments, needle) {
			out = append(out, p)
		}
	}
	return out
}

func intOr(s string, def int) int {
	if v, err := strconv.Atoi(s); err == nil && v > 0 {
		return v
	}
	return def
}

func stringOr(s, def string) string {
	if s != "" {
		return s
	}
	return def
}

func firstNonEmptyStr(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

func round1(v float64) float64 {
	return math.Round(v*10) / 10
}
